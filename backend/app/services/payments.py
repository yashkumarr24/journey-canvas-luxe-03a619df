"""PayU payment lifecycle.

Rules:
- Payable amount always comes from the bookings row, never from the browser.
- A payment is captured ONLY after (a) the reverse hash checks out AND
  (b) PayU's server-to-server verify_payment confirms success with the same
  txnid and amount. A hash alone is never trusted.
- Capture is compare-and-set (created|pending -> captured) so return URL,
  webhook and reconciliation can all run without double-capturing.
- Capture moves the booking to payment_processing; provider booking is a
  separate, still-gated step (production booking stays disabled).
- Refunds are staff-initiated only, require a reconciled capture, and use a
  unique request token so retries never refund twice.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Mapping, Optional, Protocol

from app.core.auth import AuthContext
from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import get_logger, log_extra
from app.integrations.payu.client import PayUClient, PayUError, format_amount
from app.repositories.reviews import hash_token

logger = get_logger(__name__)

OPEN = ("created", "pending")


class PaymentsDisabledError(AppError):
    status_code = 503
    code = "PAYMENTS_DISABLED"
    message = "Online payment is not available yet. Please contact our travel desk."


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
    async def booking_by_reference(self, ref: str) -> Optional[dict]: ...
    async def booking_by_id(self, booking_id: str) -> Optional[dict]: ...
    async def open_payment_for_booking(self, booking_id: str) -> Optional[dict]: ...
    async def payment_by_txnid(self, txnid: str) -> Optional[dict]: ...
    async def payment_by_id(self, payment_id: str) -> Optional[dict]: ...
    async def create_payment(self, values: dict) -> dict: ...
    async def transition(self, payment_id: str, expected: tuple, values: dict) -> bool: ...
    async def set_booking_status(self, booking_id: str, expected: tuple, status: str) -> bool: ...
    async def stale_payments(self, older_than_iso: str, limit: int = 50) -> list: ...
    async def claim_webhook(self, dedupe_key: str) -> bool: ...
    async def refund_by_token(self, token: str) -> Optional[dict]: ...
    async def create_refund(self, values: dict) -> dict: ...
    async def update_refund(self, refund_id: str, values: dict) -> None: ...
    async def record_event(self, booking_id: str, event_type: str, message: str,
                           status: Optional[str] = None) -> None: ...


def payments_allowed(settings: Settings) -> bool:
    if not settings.payments_enabled:
        return False
    if not (settings.payu_merchant_key and settings.payu_merchant_salt and settings.payu_return_base_url):
        return False
    if settings.payu_env == "production":
        return bool(settings.payu_production_approved)
    # Test credentials are never used on the production site.
    return settings.payu_env == "test" and not settings.is_production


def build_client(settings: Settings) -> PayUClient:
    if not payments_allowed(settings):
        raise PaymentsDisabledError()
    return PayUClient(key=settings.payu_merchant_key, salt=settings.payu_merchant_salt,
                      env=settings.payu_env, timeout=settings.payu_timeout)


def _owns(booking: Mapping[str, Any], auth: AuthContext, guest_token: Optional[str]) -> bool:
    if booking.get("user_id"):
        return auth.user_id == booking["user_id"]
    stored = booking.get("guest_token_hash")
    return bool(stored and guest_token and hash_token(guest_token) == stored)


def _new_txnid(ref: str) -> str:
    # PayU txnid: unique, alphanumeric, <= 25 chars.
    return (ref.replace("-", "") + "T" + secrets.token_hex(5)).upper()[:25]


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
    booking = await repo.booking_by_reference(booking_reference)
    if not booking or not _owns(booking, auth, guest_token):
        raise PaymentBookingNotFound()
    if booking.get("status") not in ("pending", "payment_pending"):
        raise PaymentNotPayable()
    if (booking.get("currency") or "INR") != "INR":
        raise PaymentNotPayable()
    amount = format_amount(booking["total_amount"])
    if Decimal(amount) <= 0:
        raise PaymentNotPayable()

    existing = await repo.open_payment_for_booking(booking["id"])
    if existing and existing["status"] == "captured":
        raise PaymentNotPayable()
    if existing and existing.get("txnid") and format_amount(existing["amount"]) == amount:
        txnid = existing["txnid"]  # reuse: double-click / retry never opens two orders
    else:
        txnid = _new_txnid(booking_reference)
        await repo.create_payment({
            "booking_id": booking["id"], "provider": "payu", "status": "created",
            "amount": amount, "currency": "INR", "txnid": txnid, "provider_order_id": txnid,
        })
        await repo.set_booking_status(booking["id"], ("pending",), "payment_pending")
        await repo.record_event(booking["id"], "payment_initiated", "PayU checkout created.",
                                "payment_pending")

    return_url = settings.payu_return_base_url.rstrip("/") + "/api/v1/payments/payu/return"
    fields = {
        "key": client.key, "txnid": txnid, "amount": amount,
        "productinfo": f"FNF {booking.get('booking_type', 'travel')} booking",
        "firstname": "Traveller", "email": booking.get("contact_email") or "",
        "phone": booking.get("contact_phone") or "",
        "udf1": booking_reference, "udf2": "", "udf3": "", "udf4": "", "udf5": "",
        "surl": return_url, "furl": return_url,
    }
    fields["hash"] = client.sign(fields)
    return CheckoutForm(client.payment_url, fields, booking_reference, txnid, amount, "INR")


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
    booking = await repo.booking_by_id(payment["booking_id"]) or {}
    ref, btype = booking.get("booking_reference"), booking.get("booking_type")

    if source != "reconcile" and not client.verify_response(fields):
        logger.warning("payu_hash_mismatch", extra=log_extra(source=source))
        return Outcome(ref, btype, "rejected")

    if payment["status"] == "captured":
        return Outcome(ref, btype, "captured")  # duplicate delivery; already done
    if payment["status"] not in OPEN:
        return Outcome(ref, btype, payment["status"])

    try:
        verified = await client.verify_payment(txnid)
    except PayUError:
        await repo.transition(payment["id"], ("created",), {"status": "pending"})
        return Outcome(ref, btype, "pending")

    expected_amount = format_amount(payment["amount"])
    now = datetime.now(timezone.utc).isoformat()
    if verified.status == "success" and verified.amount == expected_amount and verified.mihpayid:
        won = await repo.transition(payment["id"], OPEN, {
            "status": "captured", "provider_payment_id": verified.mihpayid,
            "provider_mihpayid": verified.mihpayid, "verified_at": now,
            "verification_source": source, "raw_status": verified.status,
        })
        if won:
            await repo.set_booking_status(payment["booking_id"],
                                          ("pending", "payment_pending"), "payment_processing")
            await repo.record_event(payment["booking_id"], "payment_succeeded",
                                    f"PayU payment verified via {source}.", "payment_processing")
        return Outcome(ref, btype, "captured")

    if verified.status == "success":  # amount mismatch: never capture, flag for staff
        await repo.transition(payment["id"], OPEN, {"status": "pending", "raw_status": "amount_mismatch"})
        await repo.record_event(payment["booking_id"], "note",
                                "PayU amount mismatch; held for reconciliation.")
        return Outcome(ref, btype, "pending")

    if verified.status in ("failure", "failed", "usercancelled", "dropped", "bounced"):
        won = await repo.transition(payment["id"], OPEN, {
            "status": "failed", "raw_status": verified.status, "verified_at": now,
            "verification_source": source, "failure_reason": verified.status,
        })
        if won:
            await repo.set_booking_status(payment["booking_id"], ("payment_pending",), "pending")
            await repo.record_event(payment["booking_id"], "payment_failed",
                                    "PayU payment not completed.", "pending")
        return Outcome(ref, btype, "failed")

    await repo.transition(payment["id"], ("created",), {"status": "pending", "raw_status": verified.status})
    return Outcome(ref, btype, "pending")


def webhook_dedupe_key(fields: Mapping[str, str]) -> str:
    raw = "|".join(fields.get(k, "") for k in ("txnid", "mihpayid", "status", "hash"))
    return hashlib.sha256(raw.encode()).hexdigest()


async def handle_webhook(repo: Repo, client: PayUClient, fields: Mapping[str, str]) -> Outcome:
    if not await repo.claim_webhook(webhook_dedupe_key(fields)):
        return Outcome(None, None, "duplicate")
    return await settle(repo, client, fields, source="webhook")


async def reconcile(repo: Repo, client: PayUClient, *, older_than_minutes: int = 15) -> list[Outcome]:
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)).isoformat()
    out = []
    for p in await repo.stale_payments(cutoff):
        out.append(await settle(repo, client, {"txnid": p["txnid"]}, source="reconcile"))
    return out


async def refund(repo: Repo, client: PayUClient, *, payment_id: str, amount: Any,
                 reason: str, staff_id: str, request_token: str) -> dict[str, Any]:
    prior = await repo.refund_by_token(request_token)
    if prior:
        return prior  # idempotent retry
    payment = await repo.payment_by_id(payment_id)
    if not payment or payment.get("provider") != "payu" or payment["status"] not in (
            "captured", "partially_refunded"):
        raise RefundNotAllowed()
    # Reconcile before refund: PayU must still report the capture.
    verified = await client.verify_payment(payment["txnid"])
    if verified.status != "success" or verified.mihpayid != payment.get("provider_mihpayid"):
        raise RefundNotAllowed("Payment could not be reconciled with PayU; refund not sent.")
    amt = format_amount(amount)
    remaining = Decimal(format_amount(payment["amount"])) - Decimal(format_amount(payment.get("amount_refunded") or 0))
    if Decimal(amt) <= 0 or Decimal(amt) > remaining:
        raise RefundNotAllowed("Refund amount exceeds the refundable balance.")
    row = await repo.create_refund({
        "payment_id": payment_id, "amount": amt, "request_token": request_token,
        "status": "requested", "reason": reason[:500], "created_by": staff_id,
    })
    try:
        resp = await client.refund(payment["provider_mihpayid"], request_token, amt)
    except PayUError:
        await repo.update_refund(row["id"], {"status": "unknown"})
        row["status"] = "unknown"
        return row
    ok = str(resp.get("status")) == "1"
    values = {"status": "queued" if ok else "rejected",
              "provider_request_id": str(resp.get("request_id") or "") or None}
    await repo.update_refund(row["id"], values)
    if ok:
        await repo.record_event(payment["booking_id"], "refund_initiated", "PayU refund queued.")
    row.update(values)
    return row
