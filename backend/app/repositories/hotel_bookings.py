"""Hotel booking lifecycle persistence (migration 0018). service_role only."""

from __future__ import annotations

from typing import Any, Optional

from app.core.config import Settings
from app.repositories.supabase_rest import SupabaseRest

HOTEL_BOOKINGS = "hotel_bookings"
HOTEL_BOOKING_EVENTS = "hotel_booking_events"
HOTEL_CERT_RUNS = "hotel_certification_runs"


class HotelBookingRepository:
    def __init__(self, settings: Settings) -> None:
        self._db = SupabaseRest(settings)

    @property
    def enabled(self) -> bool:
        return self._db.enabled

    async def insert(self, values: dict[str, Any]) -> Optional[dict[str, Any]]:
        rows = await self._db.insert(HOTEL_BOOKINGS, values)
        return rows[0] if rows else None

    async def by_reference(self, reference: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(HOTEL_BOOKINGS, columns="*",
                                     filters={"booking_reference": f"eq.{reference}"})
        return rows[0] if rows else None

    async def by_review_token(self, token: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(HOTEL_BOOKINGS, columns="*",
                                     filters={"review_token": f"eq.{token}"})
        return rows[0] if rows else None

    async def transition(self, row_id: str, expected: str, values: dict[str, Any]) -> bool:
        """Compare-and-set on status: the row changes only if it is still `expected`."""
        rows = await self._db.update(
            HOTEL_BOOKINGS, values, filters={"id": f"eq.{row_id}", "status": f"eq.{expected}"},
            returning=True,
        )
        return bool(rows)

    async def update(self, row_id: str, values: dict[str, Any]) -> None:
        await self._db.update(HOTEL_BOOKINGS, values, filters={"id": f"eq.{row_id}"})

    async def event(self, values: dict[str, Any]) -> None:
        await self._db.insert(HOTEL_BOOKING_EVENTS, values)

    async def search_nationality(self, review_row_id: str) -> Optional[str]:
        rows = await self._db.select("hotel_review_sessions", columns="hotel_search_id",
                                     filters={"id": f"eq.{review_row_id}"})
        sid = rows[0].get("hotel_search_id") if rows else None
        if not sid:
            return None
        rows = await self._db.select("hotel_search_sessions", columns="nationality",
                                     filters={"id": f"eq.{sid}"})
        return rows[0].get("nationality") if rows else None

    async def record_certification(self, values: dict[str, Any]) -> None:
        await self._db.insert(HOTEL_CERT_RUNS, values)
