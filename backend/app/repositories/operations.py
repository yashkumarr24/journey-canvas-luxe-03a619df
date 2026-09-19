"""Operations persistence (PHASE 11).

Covers the Phase 11 tables from `0009_operations.sql` plus ownership-scoped
reads of the existing bookings tables.

Ownership is ALWAYS part of the query predicate: a customer read carries
`user_id=eq.<verified id>` (or, for a guest, both the booking reference and the
contact email). The service-role key bypasses RLS at the transport level, so the
predicate here is the actual protection — swapping an id or a reference in a
request matches zero rows.

No passport value, card value or provider credential is selected or logged.
"""

from __future__ import annotations

from typing import Any, Optional

from app.core.config import Settings
from app.core.logging import get_logger
from app.repositories.supabase_rest import SupabaseRest

logger = get_logger(__name__)

BOOKINGS = "bookings"
BOOKING_ITEMS = "booking_items"
BOOKING_EVENTS = "booking_events"
CANCELLATIONS = "cancellation_requests"
SUPPORT = "support_requests"
SUPPORT_MESSAGES = "support_messages"
NOTES = "booking_internal_notes"
NOTIFICATIONS = "notification_events"
NOTIFICATION_DELIVERIES = "notification_deliveries"

# Notification columns safe for any response: references and copy only.
NOTIFICATION_COLUMNS = (
    "id,event_type,audience,title,body,channels,dispatched,read_at,created_at,"
    "booking_id,request_id,payload"
)
DELIVERY_COLUMNS = "notification_id,channel,state,attempts,provider_id,mode,error,updated_at"

# Booking columns safe for a customer response.
BOOKING_COLUMNS = (
    "id,booking_reference,booking_type,status,provider,total_amount,currency,"
    "status_message,created_at,updated_at"
)
# Admin needs contact details for operational work; still no passport/card data.
ADMIN_BOOKING_COLUMNS = BOOKING_COLUMNS + ",user_id,contact_email,contact_phone"


class OperationsRepository:
    def __init__(self, settings: Settings) -> None:
        self._db = SupabaseRest(settings)

    @property
    def enabled(self) -> bool:
        return self._db.enabled

    # -- bookings ----------------------------------------------------------

    async def list_bookings_for_user(
        self, user_id: str, *, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        rows = await self._db.select(
            BOOKINGS,
            columns=BOOKING_COLUMNS,
            filters={"user_id": f"eq.{user_id}", "offset": str(offset)},
            limit=limit,
            order="created_at.desc",
        )
        return rows

    async def get_booking_for_user(self, reference: str, user_id: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(
            BOOKINGS,
            columns=BOOKING_COLUMNS,
            filters={"booking_reference": f"eq.{reference}", "user_id": f"eq.{user_id}"},
        )
        return rows[0] if rows else None

    async def get_booking_for_guest(
        self, reference: str, contact_email: str
    ) -> Optional[dict[str, Any]]:
        """Guest retrieval requires BOTH the reference and the contact email."""
        rows = await self._db.select(
            BOOKINGS,
            columns=BOOKING_COLUMNS,
            filters={
                "booking_reference": f"eq.{reference}",
                "contact_email": f"eq.{contact_email.strip().lower()}",
            },
        )
        return rows[0] if rows else None

    async def get_booking_admin(self, reference: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(
            BOOKINGS,
            columns=ADMIN_BOOKING_COLUMNS,
            filters={"booking_reference": f"eq.{reference}"},
        )
        return rows[0] if rows else None

    async def list_bookings_admin(
        self, *, filters: dict[str, str], limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        return await self._db.select(
            BOOKINGS,
            columns=ADMIN_BOOKING_COLUMNS,
            filters={**filters, "offset": str(offset)},
            limit=limit,
            order="created_at.desc",
        )

    async def booking_items(self, booking_id: str) -> list[dict[str, Any]]:
        return await self._db.select(
            BOOKING_ITEMS,
            columns="id,item_type,provider_reference,details,amount,currency",
            filters={"booking_id": f"eq.{booking_id}"},
            limit=20,
        )

    async def timeline(self, booking_id: str, limit: int = 100) -> list[dict[str, Any]]:
        """The booking timeline IS booking_events — no parallel event table."""
        return await self._db.select(
            BOOKING_EVENTS,
            columns="id,event_type,message,actor,metadata,created_at",
            filters={"booking_id": f"eq.{booking_id}"},
            limit=limit,
            order="created_at.asc",
        )

    # -- cancellations -----------------------------------------------------

    async def create_cancellation(self, values: dict[str, Any]) -> Optional[dict[str, Any]]:
        rows = await self._db.insert(CANCELLATIONS, values)
        return rows[0] if rows else None

    async def cancellation_for_booking(self, booking_id: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(
            CANCELLATIONS,
            columns="*",
            filters={"booking_id": f"eq.{booking_id}"},
            order="created_at.desc",
        )
        return rows[0] if rows else None

    async def decide_cancellation(self, request_id: str, values: dict[str, Any]) -> None:
        await self._db.update(CANCELLATIONS, values, filters={"id": f"eq.{request_id}"})

    # -- support -----------------------------------------------------------

    async def create_support(self, values: dict[str, Any]) -> Optional[dict[str, Any]]:
        rows = await self._db.insert(SUPPORT, values)
        return rows[0] if rows else None

    async def list_support_for_user(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        return await self._db.select(
            SUPPORT,
            columns="*",
            filters={"user_id": f"eq.{user_id}"},
            limit=limit,
            order="created_at.desc",
        )

    async def list_support_admin(
        self, *, filters: dict[str, str], limit: int = 50
    ) -> list[dict[str, Any]]:
        return await self._db.select(
            SUPPORT, columns="*", filters=filters, limit=limit, order="created_at.desc"
        )

    async def get_support(self, request_id: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(SUPPORT, columns="*", filters={"id": f"eq.{request_id}"})
        return rows[0] if rows else None

    async def update_support(self, request_id: str, values: dict[str, Any]) -> None:
        await self._db.update(SUPPORT, values, filters={"id": f"eq.{request_id}"})

    async def support_messages(
        self, request_id: str, *, include_internal: bool
    ) -> list[dict[str, Any]]:
        filters = {"request_id": f"eq.{request_id}"}
        if not include_internal:
            # Internal replies must never reach a customer response.
            filters["internal"] = "eq.false"
        return await self._db.select(
            SUPPORT_MESSAGES,
            columns="id,author_role,author_name,body,internal,created_at",
            filters=filters,
            limit=200,
            order="created_at.asc",
        )

    async def add_support_message(self, values: dict[str, Any]) -> None:
        await self._db.insert(SUPPORT_MESSAGES, values, returning=False)

    # -- internal notes (admin only) ---------------------------------------

    async def list_notes(self, booking_id: str) -> list[dict[str, Any]]:
        return await self._db.select(
            NOTES,
            columns="id,body,author_name,created_at",
            filters={"booking_id": f"eq.{booking_id}"},
            limit=100,
            order="created_at.desc",
        )

    async def add_note(self, values: dict[str, Any]) -> Optional[dict[str, Any]]:
        rows = await self._db.insert(NOTES, values)
        return rows[0] if rows else None

    # -- notifications -----------------------------------------------------

    async def record_notification(self, values: dict[str, Any]) -> Optional[dict[str, Any]]:
        """Best effort: a notification intent must never break a customer flow.

        PHASE 13: returns the stored row so the notification service can attach
        per-channel deliveries. `dedupe_key` is uniquely indexed, so a duplicate
        emit resolves to the existing row instead of a second notification.
        """
        try:
            rows = await self._db.upsert(
                NOTIFICATIONS,
                {**values, "dispatched": False},
                on_conflict="dedupe_key",
                returning=True,
            )
            return rows[0] if rows else None
        except Exception:  # noqa: BLE001 - deliberately non-blocking
            logger.warning("notification_not_recorded")
            return None

    # -- notifications (PHASE 13) ------------------------------------------

    async def get_notification(self, notification_id: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(
            NOTIFICATIONS, columns=NOTIFICATION_COLUMNS, filters={"id": f"eq.{notification_id}"}
        )
        return rows[0] if rows else None

    async def list_notifications_for_user(
        self, user_id: str, *, limit: int = 50, unread_only: bool = False
    ) -> list[dict[str, Any]]:
        filters = {"user_id": f"eq.{user_id}", "audience": "eq.customer"}
        if unread_only:
            filters["read_at"] = "is.null"
        return await self._db.select(
            NOTIFICATIONS,
            columns=NOTIFICATION_COLUMNS,
            filters=filters,
            limit=limit,
            order="created_at.desc",
        )

    async def count_unread_for_user(self, user_id: str) -> int:
        rows = await self.list_notifications_for_user(user_id, limit=200, unread_only=True)
        return len(rows)

    async def mark_notification_read(self, notification_id: str, user_id: str) -> None:
        # The user id stays in the predicate: another user's id matches no row.
        await self._db.update(
            NOTIFICATIONS,
            {"read_at": "now()"},
            filters={"id": f"eq.{notification_id}", "user_id": f"eq.{user_id}"},
        )

    async def mark_all_notifications_read(self, user_id: str) -> None:
        await self._db.update(
            NOTIFICATIONS,
            {"read_at": "now()"},
            filters={"user_id": f"eq.{user_id}", "read_at": "is.null"},
        )

    async def list_notifications_for_admin(
        self, *, audience: Optional[str] = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        filters: dict[str, str] = {}
        if audience:
            filters["audience"] = f"eq.{audience}"
        return await self._db.select(
            NOTIFICATIONS,
            columns=NOTIFICATION_COLUMNS,
            filters=filters,
            limit=limit,
            order="created_at.desc",
        )

    async def upsert_notification_delivery(self, values: dict[str, Any]) -> None:
        try:
            await self._db.upsert(
                NOTIFICATION_DELIVERIES, values, on_conflict="notification_id,channel"
            )
        except Exception:  # noqa: BLE001
            logger.warning("notification_delivery_not_recorded")

    async def list_notification_deliveries(self, notification_id: str) -> list[dict[str, Any]]:
        return await self._db.select(
            NOTIFICATION_DELIVERIES,
            columns=DELIVERY_COLUMNS,
            filters={"notification_id": f"eq.{notification_id}"},
            limit=10,
        )

    async def list_pending_notification_deliveries(self, *, limit: int = 50) -> list[dict[str, Any]]:
        return await self._db.select(
            NOTIFICATION_DELIVERIES,
            columns=DELIVERY_COLUMNS,
            filters={"state": "in.(queued,retrying)"},
            limit=limit,
            order="updated_at.asc",
        )

    async def refresh_notification_dispatched(self, notification_id: str) -> None:
        """`dispatched` is true only when every attempted channel reported sent."""
        deliveries = await self.list_notification_deliveries(notification_id)
        if not deliveries:
            return
        done = all(d.get("state") in {"sent", "skipped"} for d in deliveries)
        await self._db.update(
            NOTIFICATIONS, {"dispatched": done}, filters={"id": f"eq.{notification_id}"}
        )
