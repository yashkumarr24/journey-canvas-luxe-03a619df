"""Payments persistence (service-role). Status changes are compare-and-set:
an UPDATE filtered on the expected current status, so two concurrent
callbacks (return + webhook) can never both capture the same payment."""

from __future__ import annotations

from typing import Any, Optional

from app.core.config import Settings
from app.repositories.supabase_rest import SupabaseRest

PAYMENTS = "payments"
BOOKINGS = "bookings"
REFUNDS = "payment_refunds"
WEBHOOKS = "payment_webhook_events"
EVENTS = "booking_events"


class PaymentsRepo:
    def __init__(self, settings: Settings) -> None:
        self._db = SupabaseRest(settings)

    async def booking_by_reference(self, ref: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(BOOKINGS, filters={"booking_reference": f"eq.{ref}"})
        return rows[0] if rows else None

    async def booking_by_id(self, booking_id: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(BOOKINGS, filters={"id": f"eq.{booking_id}"})
        return rows[0] if rows else None

    async def open_payment_for_booking(self, booking_id: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(
            PAYMENTS,
            filters={"booking_id": f"eq.{booking_id}", "provider": "eq.payu",
                     "status": "in.(created,pending,captured)"},
            order="created_at.desc",
        )
        return rows[0] if rows else None

    async def payment_by_txnid(self, txnid: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(PAYMENTS, filters={"txnid": f"eq.{txnid}"})
        return rows[0] if rows else None

    async def payment_by_id(self, payment_id: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(PAYMENTS, filters={"id": f"eq.{payment_id}"})
        return rows[0] if rows else None

    async def create_payment(self, values: dict[str, Any]) -> dict[str, Any]:
        rows = await self._db.insert(PAYMENTS, values)
        return rows[0]

    async def transition(self, payment_id: str, expected: tuple[str, ...],
                         values: dict[str, Any]) -> bool:
        rows = await self._db.update(
            PAYMENTS, values,
            filters={"id": f"eq.{payment_id}", "status": f"in.({','.join(expected)})"},
            returning=True,
        )
        return bool(rows)

    async def set_booking_status(self, booking_id: str, expected: tuple[str, ...], status: str) -> bool:
        rows = await self._db.update(
            BOOKINGS, {"status": status},
            filters={"id": f"eq.{booking_id}", "status": f"in.({','.join(expected)})"},
            returning=True,
        )
        return bool(rows)

    async def stale_payments(self, older_than_iso: str, limit: int = 50) -> list[dict[str, Any]]:
        return await self._db.select(
            PAYMENTS,
            filters={"provider": "eq.payu", "status": "in.(created,pending)",
                     "created_at": f"lt.{older_than_iso}"},
            limit=limit,
        )

    async def claim_webhook(self, dedupe_key: str) -> bool:
        """True only for the first delivery of this event."""
        existing = await self._db.select(WEBHOOKS, filters={"dedupe_key": f"eq.{dedupe_key}"})
        if existing:
            return False
        try:
            await self._db.insert(WEBHOOKS, {"dedupe_key": dedupe_key}, returning=False)
        except Exception:  # unique violation from a concurrent delivery
            return False
        return True

    async def refund_by_token(self, token: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(REFUNDS, filters={"request_token": f"eq.{token}"})
        return rows[0] if rows else None

    async def create_refund(self, values: dict[str, Any]) -> dict[str, Any]:
        rows = await self._db.insert(REFUNDS, values)
        return rows[0]

    async def update_refund(self, refund_id: str, values: dict[str, Any]) -> None:
        await self._db.update(REFUNDS, values, filters={"id": f"eq.{refund_id}"})

    async def record_event(self, booking_id: str, event_type: str, message: str,
                           status: Optional[str] = None) -> None:
        await self._db.insert(
            EVENTS,
            {"booking_id": booking_id, "event_type": event_type, "message": message,
             "status": status, "actor": "system"},
            returning=False,
        )
