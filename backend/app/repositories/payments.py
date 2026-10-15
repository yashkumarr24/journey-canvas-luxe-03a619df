"""Payments persistence (service-role only).

Status changes are compare-and-set (UPDATE filtered on the expected status), and
the multi-row steps that must be atomic run inside Postgres functions from
migration 0024:

* payu_capture        - capture + booking status + fulfilment job, one transaction
* payu_claim_jobs     - FOR UPDATE SKIP LOCKED job claiming with lock expiry
* payu_reserve_refund - refund balance check under a payment row lock
"""

from __future__ import annotations

from typing import Any, Optional

from app.core.config import Settings
from app.repositories.supabase_rest import SupabaseRest

PAYMENTS = "payments"
BOOKINGS = "bookings"
HOTEL_BOOKINGS = "hotel_bookings"
REFUNDS = "payment_refunds"
WEBHOOKS = "payment_webhook_events"
JOBS = "payment_fulfilment_jobs"
EVENTS = "booking_events"

LIVE = "in.(created,pending,captured)"


def subject_kind(reference: str) -> Optional[str]:
    if reference.startswith("FF-"):
        return "flight"
    if reference.startswith("FNFH"):
        return "hotel"
    return None


def _flight(row: dict[str, Any]) -> dict[str, Any]:
    return {"kind": "flight", "id": str(row["id"]), "reference": row.get("booking_reference"),
            "user_id": row.get("user_id"), "guest_token_hash": row.get("guest_token_hash"),
            "status": row.get("status"), "currency": row.get("currency") or "INR",
            "amount": row.get("total_amount"), "email": row.get("contact_email") or "",
            "phone": row.get("contact_phone") or ""}


def _hotel(row: dict[str, Any]) -> dict[str, Any]:
    contact = row.get("contact") or {}
    return {"kind": "hotel", "id": str(row["id"]), "reference": row.get("booking_reference"),
            "user_id": row.get("user_id"), "guest_token_hash": row.get("guest_token_hash"),
            "status": row.get("status"), "currency": row.get("currency") or "INR",
            "amount": row.get("total_amount"), "email": contact.get("email") or "",
            "phone": contact.get("phone") or contact.get("mobile") or ""}


class PaymentsRepo:
    def __init__(self, settings: Settings) -> None:
        self._db = SupabaseRest(settings)

    # ---- subjects -----------------------------------------------------------
    async def subject_by_reference(self, ref: str) -> Optional[dict[str, Any]]:
        kind = subject_kind(ref)
        if kind == "flight":
            rows = await self._db.select(BOOKINGS, filters={"booking_reference": f"eq.{ref}"})
            return _flight(rows[0]) if rows else None
        if kind == "hotel":
            rows = await self._db.select(HOTEL_BOOKINGS, filters={"booking_reference": f"eq.{ref}"})
            return _hotel(rows[0]) if rows else None
        return None

    async def subject_for_payment(self, payment: dict[str, Any]) -> Optional[dict[str, Any]]:
        if payment.get("booking_id"):
            rows = await self._db.select(BOOKINGS, filters={"id": f"eq.{payment['booking_id']}"})
            return _flight(rows[0]) if rows else None
        if payment.get("hotel_booking_id"):
            rows = await self._db.select(HOTEL_BOOKINGS, filters={"id": f"eq.{payment['hotel_booking_id']}"})
            return _hotel(rows[0]) if rows else None
        return None

    @staticmethod
    def _subject_filter(subject: dict[str, Any]) -> dict[str, str]:
        col = "booking_id" if subject["kind"] == "flight" else "hotel_booking_id"
        return {col: f"eq.{subject['id']}"}

    # ---- payments -----------------------------------------------------------
    async def open_payment_for(self, subject: dict[str, Any]) -> Optional[dict[str, Any]]:
        rows = await self._db.select(
            PAYMENTS, filters={**self._subject_filter(subject), "provider": "eq.payu", "status": LIVE},
            order="created_at.desc")
        return rows[0] if rows else None

    async def latest_payment_for(self, subject: dict[str, Any]) -> Optional[dict[str, Any]]:
        rows = await self._db.select(
            PAYMENTS, filters={**self._subject_filter(subject), "provider": "eq.payu"},
            order="created_at.desc", limit=1)
        return rows[0] if rows else None

    async def payment_by_txnid(self, txnid: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(PAYMENTS, filters={"txnid": f"eq.{txnid}"})
        return rows[0] if rows else None

    async def payment_by_id(self, payment_id: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(PAYMENTS, filters={"id": f"eq.{payment_id}"})
        return rows[0] if rows else None

    async def create_payment(self, subject: dict[str, Any], values: dict[str, Any]) -> Optional[dict[str, Any]]:
        """None when the one-live-payment unique index rejected a concurrent insert."""
        col = "booking_id" if subject["kind"] == "flight" else "hotel_booking_id"
        try:
            rows = await self._db.insert(PAYMENTS, {**values, col: subject["id"]})
        except Exception:  # unique violation: another request created it first
            return None
        return rows[0] if rows else None

    async def transition(self, payment_id: str, expected: tuple[str, ...], values: dict[str, Any]) -> bool:
        rows = await self._db.update(
            PAYMENTS, values,
            filters={"id": f"eq.{payment_id}", "status": f"in.({','.join(expected)})"},
            returning=True)
        return bool(rows)

    async def capture(self, payment_id: str, expected: tuple[str, ...], *, mihpayid: str,
                      source: str, raw_status: str) -> bool:
        res = await self._db.rpc("payu_capture", {
            "p_payment_id": payment_id, "p_expected": list(expected), "p_mihpayid": mihpayid,
            "p_source": source, "p_raw_status": raw_status})
        return bool(res)

    async def set_flight_status(self, booking_id: str, expected: tuple[str, ...], status: str) -> bool:
        rows = await self._db.update(
            BOOKINGS, {"status": status},
            filters={"id": f"eq.{booking_id}", "status": f"in.({','.join(expected)})"},
            returning=True)
        return bool(rows)

    async def stale_payments(self, older_than_iso: str, limit: int = 50) -> list[dict[str, Any]]:
        return await self._db.select(
            PAYMENTS, filters={"provider": "eq.payu", "status": "in.(created,pending)",
                               "created_at": f"lt.{older_than_iso}"}, limit=limit)

    async def add_refunded(self, payment_id: str, previous: str, new_total: str, status: str) -> bool:
        rows = await self._db.update(
            PAYMENTS, {"amount_refunded": new_total, "status": status},
            filters={"id": f"eq.{payment_id}", "amount_refunded": f"eq.{previous}"}, returning=True)
        return bool(rows)

    # ---- webhooks (audit + cheap dedupe; settle itself is idempotent) -------
    async def record_webhook(self, dedupe_key: str) -> bool:
        try:
            await self._db.insert(WEBHOOKS, {"dedupe_key": dedupe_key}, returning=False)
        except Exception:
            return False
        return True

    # ---- jobs ---------------------------------------------------------------
    async def claim_jobs(self, limit: int, lock_seconds: int) -> list[dict[str, Any]]:
        return list(await self._db.rpc("payu_claim_jobs", {"p_limit": limit, "p_lock_seconds": lock_seconds}) or [])

    async def update_job(self, job_id: str, values: dict[str, Any]) -> None:
        await self._db.update(JOBS, values, filters={"id": f"eq.{job_id}"})

    async def withdraw_job(self, payment_id: str) -> bool:
        """Atomically stop a never-claimed hotel job (payu_withdraw_job)."""
        res = await self._db.rpc("payu_withdraw_job", {"p_payment_id": payment_id})
        return bool(res[0] if isinstance(res, list) and res else res)

    async def job_for_payment(self, payment_id: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(JOBS, filters={"payment_id": f"eq.{payment_id}"})
        return rows[0] if rows else None

    # ---- refunds ------------------------------------------------------------
    async def refund_by_token(self, token: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(REFUNDS, filters={"request_token": f"eq.{token}"})
        return rows[0] if rows else None

    async def reserve_refund(self, *, payment_id: str, amount: str, token: str, reason: str,
                             staff_id: Optional[str]) -> dict[str, Any]:
        """Raises ValueError(code) when the database refuses the reservation."""
        try:
            row = await self._db.rpc("payu_reserve_refund", {
                "p_payment_id": payment_id, "p_amount": amount, "p_token": token,
                "p_reason": reason, "p_staff": staff_id or None})
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            for code in ("refund_unresolved", "refund_exceeds_balance", "refund_not_allowed"):
                if code in msg:
                    raise ValueError(code) from None
            raise
        return row[0] if isinstance(row, list) else row

    async def update_refund(self, refund_id: str, values: dict[str, Any]) -> None:
        await self._db.update(REFUNDS, values, filters={"id": f"eq.{refund_id}"})

    async def refunds_to_check(self, limit: int = 50) -> list[dict[str, Any]]:
        return await self._db.select(REFUNDS, filters={"status": "in.(requested,queued,unknown)"}, limit=limit)

    # ---- audit --------------------------------------------------------------
    async def record_event(self, subject: dict[str, Any], event_type: str, message: str,
                           status: Optional[str] = None) -> None:
        if subject.get("kind") != "flight":
            return  # hotel bookings keep their own hotel_booking_events trail
        await self._db.insert(
            EVENTS, {"booking_id": subject["id"], "event_type": event_type, "message": message,
                     "status": status, "actor": "system"}, returning=False)
