"""PayU payment lifecycle (test mode first; production stays gated).

Rules enforced here, never in the browser:
- The payable amount comes from the booking row (flight `bookings` or
  `hotel_bookings`). Decimal strings only, never floats.
- Only the booking owner (verified user id, or the hashed guest token) can
  create a payment or read its status. A booking reference alone grants nothing.
- Capture requires BOTH the documented reverse hash AND PayU's server-to-server
  verify_payment reporting success for the same txnid and amount. The webhook
  URL being hard to guess is NOT authentication; every callback goes through
  the same verification.
- Capture is atomic in the database (payu_capture): payment -> captured, flight
  booking -> payment_processing and exactly one durable fulfilment job, in one
  transaction. Concurrent return/webhook/reconcile calls cannot double-capture.
- A captured payment is never downgraded by a later failure callback. A late
  success after a failure is still verified and captured (money was taken).
- One live payable attempt per booking: repeat or concurrent order requests
  return the same txnid.
- Refunds: admin only, PayU must still report the capture, the booking must be
  reconciled as not fulfilled/cancelled, the balance is checked under a row lock,
  and an unresolved refund blocks new ones until check_action_status settles it.
  A refund is never re-sent after an ambiguous answer.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Awaitable, Callable, Mapping, Optional, Protocol

from app.core.auth import AuthContext
from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import get_logger, log_extra
from app.integrations.payu.client import PayUClient, PayUError, format_amount
from app.repositories.reviews import hash_token

logger = get_logger(__name__)

OPEN = ("created", "pending")
FAILURE_STATUSES = ("failure", "failed", "usercancelled", "dropped", "bounced")
FLIGHT_PAYABLE = ("pending", "payment_pending")
HOTEL_PAYABLE = ("DRAFT",)
ABANDON_AFTER = timedelta(minutes=60)


class PaymentsDisabledError(AppError):
    status_code = 503
    code = "PAYMENTS_DISABLED"
    message = "Payments temporarily unavailable."


class PaymentBookingNotFound(AppError):
    status_code = 404
    code = "BOOKING_NOT_FOUND"
    message = "We couldn't find this booking."


class PaymentNotPayable(AppError):
    status_code = 409
    code = "BOOKING_NOT_PAYABLE"
    message = "This booking can't be paid for right now."


class RefundNotAllowed(AppError):
    status_code = 409
    code = "REFUND_NOT_ALLOWED"
    message = "This payment can't be refunded in its current state."


class Repo(Protocol):  # implemented by PaymentsRepo; faked in tests
    async def subject_by_reference(self, ref: str) -> Optional[dict]: ...
    async def subject_for_payment(self, payment: dict) -> Optional[dict]: ...
    async def open_payment_for(self, subject: dict) -> Optional[dict]: ...
    async def latest_payment_for(self, subject: dict) -> Optional[dict]: ...
    async def payment_by_txnid(self, txnid: str) -> Optional[dict]: ...
    async def payment_by_id(self, payment_id: str) -> Optional[dict]: ...
    async def create_payment(self, subject: dict, values: dict) -> Optional[dict]: ...
    async def transition(self, payment_id: str, expected: tuple, values: dict) -> bool: ...
    async def capture(self, payment_id: str, expected: tuple, *, mihpayid: str, source: str,
                      raw_status: str) -> bool: ...
    async def set_flight_status(self, booking_id: str, expected: tuple, status: str) -> bool: ...
    async def stale_payments(self, older_than_iso: str, limit: int = 50) -> list: ...
    async def add_refunded(self, payment_id: str, previous: str, new_total: str, status: str) -> bool: ...
    async def record_webhook(self, dedupe_key: str) -> bool: ...
    async def job_for_payment(self, payment_id: str) -> Optional[dict]: ...
    async def refund_by_token(self, token: str) -> Optional[dict]: ...
    async def reserve_refund(self, *, payment_id: str, amount: str, token: str, reason: str,
                             staff_id: Optional[str]) -> dict: ...
    async def update_refund(self, refund_id: str, values: dict) -> None: ...
    async def refunds_to_check(self, limit: int = 50) -> list: ...
    async def record_event(self, subject: dict, event_type: str, message: str,
                           status: Optional[str] = None) -> None: ...


# ------------------------------------------------------------------ gates --

def _is_uat_host(url: str) -> bool:
    return "apitest" in (url or "").lower()


def _tripjack_hosts(settings: Settings) -> list[str]:
    return [h for h in (getattr(settings, "tripjack_base_url", ""),
                        getattr(settings, "tripjack_hotel_base_url", ""),
                        getattr(settings, "tripjack_hotel_booker_url", "")) if h]


def payments_allowed(settings: Settings) -> bool:
    if not settings.payments_enabled:
        return False
    if not (settings.payu_merchant_key and settings.payu_merchant_salt and settings.payu_return_base_url):
        return False
    if settings.payu_env == "production":
        return bool(settings.payu_production_approved)
    # Test credentials are never used on the production site.
    return settings.payu_env == "test" and not settings.is_production


def fulfilment_allowed(settings: Settings) -> bool:
    """Whether a verified payment may create a TripJack booking.

    PayU test money may only ever book against TripJack UAT, and production
    PayU may only ever book against production TripJack."""
    if not payments_allowed(settings) or not getattr(settings, "payment_fulfilment_enabled", False):
        return False
    hosts = _tripjack_hosts(settings)
    if not hosts:
        return False
    if settings.payu_env == "test":
        return all(_is_uat_host(h) for h in hosts)
    return bool(settings.payu_production_approved) and not any(_is_uat_host(h) for h in hosts)


def build_client(settings: Settings) -> PayUClient:
    if not payments_allowed(settings):
        raise PaymentsDisabledError()
    return PayUClient(key=settings.payu_merchant_key, salt=settings.payu_merchant_salt,
                      env=settings.payu_env, timeout=settings.payu_timeout)


def owns(subject: Mapping[str, Any], auth: AuthContext, guest_token: Optional[str]) -> bool:
    if subject.get("user_id"):
        return bool(auth.user_id) and secrets.compare_digest(str(auth.user_id), str(subject["user_id"]))
    stored = subject.get("guest_token_hash")
    return bool(stored and guest_token) and secrets.compare_digest(hash_token(guest_token), stored)


def to_amount(value: Any) -> str:
    """Decimal string with two places; rejects floats-as-text garbage."""
    try:
        return format_amount(value)
    except (InvalidOperation, ValueError, TypeError):
        raise PaymentNotPayable() from None


def _new_txnid(ref: str) -> str:
    # PayU txnid: unique, alphanumeric, <= 25 chars.
    return (ref.replace("-", "") + "T" + secrets.token_hex(5)).upper()[:25]


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ order --

@dataclass
class CheckoutForm:
    action: str
    fields: dict[str, str]
    booking_reference: str
    txnid: str
    amount: str
    currency: str


async def create_order(repo: Repo, client: PayUClient, settings: Settings, *,
                       booking_reference: str, auth: AuthContext,
                       guest_token: Optional[str]) -> CheckoutForm:
    subject = await repo.subject_by_reference(booking_reference)
    if not subject or not owns(subject, auth, guest_token):
        raise PaymentBookingNotFound()
    payable = FLIGHT_PAYABLE if subject["kind"] == "flight" else HOTEL_PAYABLE
    if subject.get("status") not in payable or subject.get("currency", "INR") != "INR":
        raise PaymentNotPayable()
    amount = to_amount(subject["amount"])
    if Decimal(amount) <= 0:
        raise PaymentNotPayable()

    payment = await repo.open_payment_for(subject)
    if payment is None:
        values = {"provider": "payu", "status": "created", "amount": amount, "currency": "INR",
                  "txnid": _new_txnid(booking_reference)}
        values["provider_order_id"] = values["txnid"]
        payment = await repo.create_payment(subject, values)
        if payment is None:  # lost a race: the winner's attempt is the one to pay
            payment = await repo.open_payment_for(subject)
            if payment is None:
                raise PaymentNotPayable()
        else:
            if subject["kind"] == "flight":
                await repo.set_flight_status(subject["id"], ("pending",), "payment_pending")
            await repo.record_event(subject, "payment_initiated", "PayU checkout created.", "payment_pending")

    if payment["status"] == "captured":
        raise PaymentNotPayable()
    if to_amount(payment["amount"]) != amount:
        # The booking total changed under an open attempt: never sign a second
        # amount for the same booking. Staff reconcile the old attempt first.
        raise PaymentNotPayable()

    return_url = settings.payu_return_base_url.rstrip("/") + "/api/v1/payments/payu/return"
    fields = {
        "key": client.key, "txnid": payment["txnid"], "amount": amount,
        "productinfo": f"FNF {subject['kind']} booking",
        "firstname": "Traveller", "email": subject.get("email") or "",
        "phone": subject.get("phone") or "",
        "udf1": booking_reference, "udf2": "", "udf3": "", "udf4": "", "udf5": "",
        "surl": return_url, "furl": return_url,
    }
    fields["hash"] = client.sign(fields)
    return CheckoutForm(client.payment_url, fields, booking_reference, payment["txnid"], amount, "INR")


# ----------------------------------------------------------------- settle --

@dataclass
class Outcome:
    booking_reference: Optional[str]
    booking_type: Optional[str]
    status: str  # captured | failed | pending | rejected


async def settle(repo: Repo, client: PayUClient, fields: Mapping[str, str], *,
                 source: str) -> Outcome:
    """Shared path for surl/furl, webhook and reconciliation."""
    txnid = (fields.get("txnid") or "").strip()
    payment = await repo.payment_by_txnid(txnid) if txnid else None
    if not payment:
        return Outcome(None, None, "rejected")
    subject = await repo.subject_for_payment(payment) or {}
    ref, kind = subject.get("reference"), subject.get("kind")

    if source != "reconcile" and not client.verify_response(fields):
        logger.warning("payu_hash_mismatch", extra=log_extra(source=source))
        return Outcome(ref, kind, "rejected")

    if payment["status"] in ("captured", "partially_refunded", "refunded"):
        return Outcome(ref, kind, "captured")  # never downgraded by any later callback

    try:
        verified = await client.verify_payment(txnid)
    except PayUError:
        await repo.transition(payment["id"], ("created",), {"status": "pending"})
        return Outcome(ref, kind, "pending")

    expected_amount = to_amount(payment["amount"])
    if verified.status == "success" and verified.amount == expected_amount and verified.mihpayid:
        expected = OPEN
        if payment["status"] == "failed":
            other = await repo.open_payment_for(subject) if subject else None
            if other and other["id"] != payment["id"]:
                # Money arrived on an older attempt while a newer one is live.
                await repo.transition(payment["id"], ("failed",), {"raw_status": "late_success_conflict"})
                await repo.record_event(subject, "note", "Late PayU success on a superseded attempt; staff review.")
                return Outcome(ref, kind, "pending")
            expected = ("failed",)
        won = await repo.capture(payment["id"], expected, mihpayid=verified.mihpayid,
                                 source=source, raw_status=verified.status)
        if won:
            await repo.record_event(subject, "payment_succeeded",
                                    f"PayU payment verified via {source}.", "payment_processing")
        return Outcome(ref, kind, "captured")

    if verified.status == "success":  # amount mismatch: never capture, flag for staff
        await repo.transition(payment["id"], OPEN, {"status": "pending", "raw_status": "amount_mismatch"})
        await repo.record_event(subject, "note", "PayU amount mismatch; held for reconciliation.")
        return Outcome(ref, kind, "pending")

    if payment["status"] == "failed":
        return Outcome(ref, kind, "failed")

    if verified.status in FAILURE_STATUSES:
        won = await repo.transition(payment["id"], OPEN, {
            "status": "failed", "raw_status": verified.status, "verified_at": _now().isoformat(),
            "verification_source": source, "failure_reason": verified.status})
        if won and kind == "flight":
            await repo.set_flight_status(subject["id"], ("payment_pending",), "pending")
        if won:
            await repo.record_event(subject, "payment_failed", "PayU payment not completed.", "pending")
        return Outcome(ref, kind, "failed")

    if verified.status == "not_found" and source == "reconcile":
        created = _parse_ts(payment.get("created_at"))
        if created and _now() - created > ABANDON_AFTER:
            await repo.transition(payment["id"], OPEN, {"status": "failed", "failure_reason": "abandoned",
                                                        "raw_status": "not_found"})
            return Outcome(ref, kind, "failed")

    await repo.transition(payment["id"], ("created",), {"status": "pending", "raw_status": verified.status})
    return Outcome(ref, kind, "pending")


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def webhook_dedupe_key(fields: Mapping[str, str]) -> str:
    raw = "|".join(fields.get(k, "") for k in ("txnid", "mihpayid", "status", "hash"))
    return hashlib.sha256(raw.encode()).hexdigest()


async def handle_webhook(repo: Repo, client: PayUClient, fields: Mapping[str, str]) -> Outcome:
    # Recorded for audit; processing still runs on redelivery because settle is
    # idempotent and a crash after recording must not lose the event.
    await repo.record_webhook(webhook_dedupe_key(fields))
    return await settle(repo, client, fields, source="webhook")


async def reconcile(repo: Repo, client: PayUClient, *, older_than_minutes: int = 15) -> list[Outcome]:
    cutoff = (_now() - timedelta(minutes=older_than_minutes)).isoformat()
    return [await settle(repo, client, {"txnid": p["txnid"]}, source="reconcile")
            for p in await repo.stale_payments(cutoff)]


# ---------------------------------------------------------------- refunds --

RefundEligibility = Callable[[dict, dict], Awaitable[bool]]


async def refund(repo: Repo, client: PayUClient, *, payment_id: str, amount: Any, reason: str,
                 staff_id: str, request_token: str, eligible: RefundEligibility) -> dict[str, Any]:
    prior = await repo.refund_by_token(request_token)
    if prior:
        return prior  # idempotent retry: never a second PayU call for the same token
    payment = await repo.payment_by_id(payment_id)
    if not payment or payment.get("provider") != "payu" or payment["status"] not in (
            "captured", "partially_refunded"):
        raise RefundNotAllowed()
    subject = await repo.subject_for_payment(payment)
    if not subject or not await eligible(payment, subject):
        raise RefundNotAllowed("The booking is not reconciled as failed or cancelled; refund not sent.")
    # Reconcile with PayU before money moves.
    verified = await client.verify_payment(payment["txnid"])
    if verified.status != "success" or verified.mihpayid != payment.get("provider_mihpayid"):
        raise RefundNotAllowed("Payment could not be reconciled with PayU; refund not sent.")
    amt = to_amount(amount)
    try:
        row = await repo.reserve_refund(payment_id=payment_id, amount=amt, token=request_token,
                                        reason=reason, staff_id=staff_id)
    except ValueError as exc:
        raise RefundNotAllowed({
            "refund_unresolved": "An earlier refund is still unresolved; check its status first.",
            "refund_exceeds_balance": "Refund amount exceeds the refundable balance.",
        }.get(str(exc), "This payment can't be refunded in its current state.")) from None
    if row.get("status") != "requested" or row.get("provider_request_id"):
        return row  # reservation returned an existing row
    try:
        resp = await client.refund(payment["provider_mihpayid"], request_token, amt)
    except PayUError:
        # Ambiguous: PayU may have accepted it. Never re-send; reconcile instead.
        await repo.update_refund(row["id"], {"status": "unknown"})
        return {**row, "status": "unknown"}
    ok = str(resp.get("status")) == "1"
    values = {"status": "queued" if ok else "rejected",
              "provider_request_id": str(resp.get("request_id") or "") or None}
    await repo.update_refund(row["id"], values)
    if ok:
        await repo.record_event(subject, "refund_initiated", "PayU refund queued.")
    return {**row, **values}


async def reconcile_refunds(repo: Repo, client: PayUClient) -> list[str]:
    """Settle queued/unknown refunds via check_action_status; never re-sends."""
    out = []
    for r in await repo.refunds_to_check():
        rid = r.get("provider_request_id")
        if not rid:
            out.append("manual")  # no PayU handle: staff check the PayU dashboard
            continue
        try:
            body = await client.refund_status(rid)
        except PayUError:
            out.append("unknown")
            continue
        details = (body.get("transaction_details") or {}).get(rid) or {}
        if isinstance(details, dict) and len(details) == 1 and isinstance(next(iter(details.values())), dict):
            details = next(iter(details.values()))
        status = str((details or {}).get("status") or "").lower()
        now = _now().isoformat()
        if status == "success":
            await repo.update_refund(r["id"], {"status": "success", "last_checked_at": now})
            payment = await repo.payment_by_id(r["payment_id"])
            if payment:
                prev = to_amount(payment.get("amount_refunded") or 0)
                total = to_amount(Decimal(prev) + Decimal(to_amount(r["amount"])))
                full = Decimal(total) >= Decimal(to_amount(payment["amount"]))
                await repo.add_refunded(payment["id"], prev, total, "refunded" if full else "partially_refunded")
            out.append("success")
        elif status in ("failure", "failed"):
            await repo.update_refund(r["id"], {"status": "failed", "last_checked_at": now})
            out.append("failed")
        else:
            await repo.update_refund(r["id"], {"last_checked_at": now})
            out.append("pending")
    return out
