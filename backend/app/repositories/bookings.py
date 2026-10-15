"""Draft booking, traveller and lifecycle-event persistence (PHASE 7).

Nothing here confirms a booking. A row created by this module is a DRAFT:
status stays `pending` until a payment phase (PHASE 8) and a provider
confirmation move it forward. The `bookings_confirmed_ref_chk` constraint in
the schema makes a premature 'confirmed' write impossible anyway.

Passport values pass through `upsert_traveller` into the `travellers` table.
They are never written to a log record, an event payload or a response.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional

from app.core.config import Settings
from app.core.logging import get_logger, log_extra
from app.repositories.supabase_rest import SupabaseRest, SupabaseUnavailableError

logger = get_logger(__name__)

BOOKINGS = "bookings"
BOOKING_ITEMS = "booking_items"
BOOKING_TRAVELLERS = "booking_travellers"
BOOKING_EVENTS = "booking_events"
TRAVELLERS = "travellers"

# Columns safe to return for a saved traveller. Passport data is deliberately
# NOT selected — it is written, and read only by the provider call that needs it.
TRAVELLER_SAFE_COLUMNS = "id,user_id,first_name,last_name,date_of_birth,gender,nationality"


@dataclass(frozen=True)
class DraftBooking:
    id: str
    booking_reference: str
    status: str
    total_amount: Decimal
    currency: str


class BookingRepository:
    def __init__(self, settings: Settings) -> None:
        self._db = SupabaseRest(settings)

    @property
    def enabled(self) -> bool:
        return self._db.enabled

    # -- travellers --------------------------------------------------------

    async def get_owned_traveller(self, traveller_id: str, user_id: str) -> Optional[dict[str, Any]]:
        """Fetch a saved traveller ONLY when it belongs to this user.

        `user_id` comes from the verified bearer token. A request naming
        another user's traveller id matches zero rows here, so User A can never
        read or reuse User B's record even though the service-role key bypasses
        RLS at the transport level.
        """
        rows = await self._db.select(
            TRAVELLERS,
            columns=TRAVELLER_SAFE_COLUMNS,
            filters={"id": f"eq.{traveller_id}", "user_id": f"eq.{user_id}"},
        )
        return rows[0] if rows else None

    async def create_traveller(self, values: dict[str, Any]) -> Optional[str]:
        """Insert a traveller. `user_id` must already come from the auth context."""
        rows = await self._db.insert(TRAVELLERS, values)
        return str(rows[0].get("id")) if rows else None

    async def update_traveller(self, traveller_id: str, user_id: str, values: dict[str, Any]) -> None:
        await self._db.update(
            TRAVELLERS,
            values,
            filters={"id": f"eq.{traveller_id}", "user_id": f"eq.{user_id}"},
        )

    # -- bookings ----------------------------------------------------------

    async def create_draft(
        self,
        *,
        user_id: Optional[str],
        contact_email: str,
        contact_phone: str,
        total_amount: Decimal,
        currency: str,
    ) -> Optional[DraftBooking]:
        rows = await self._db.insert(
            BOOKINGS,
            {
                # NULL for a guest. Never taken from the request body.
                "user_id": user_id,
                "booking_type": "flight",
                "status": "pending",
                "provider": "tripjack",
                "contact_email": contact_email,
                "contact_phone": contact_phone,
                # Server-resolved amount only.
                "total_amount": str(total_amount),
                "currency": currency,
            },
        )
        if not rows:
            return None
        row = rows[0]
        return DraftBooking(
            id=str(row.get("id")),
            booking_reference=str(row.get("booking_reference")),
            status=str(row.get("status")),
            total_amount=Decimal(str(row.get("total_amount") or "0")),
            currency=str(row.get("currency") or currency),
        )

    async def replace_items(
        self,
        booking_id: str,
        *,
        provider_reference: Optional[str],
        details: dict[str, Any],
        amount: Decimal,
        currency: str,
    ) -> None:
        await self._db.delete(BOOKING_ITEMS, filters={"booking_id": f"eq.{booking_id}"})
        await self._db.insert(
            BOOKING_ITEMS,
            {
                "booking_id": booking_id,
                "item_type": "flight_itinerary",
                "provider_reference": provider_reference,
                "details": details,
                "amount": str(amount),
                "currency": currency,
            },
            returning=False,
        )

    async def replace_travellers(self, booking_id: str, links: list[dict[str, Any]]) -> None:
        await self._db.delete(BOOKING_TRAVELLERS, filters={"booking_id": f"eq.{booking_id}"})
        if links:
            await self._db.insert(BOOKING_TRAVELLERS, links, returning=False)

    async def update_booking(self, booking_id: str, values: dict[str, Any]) -> None:
        await self._db.update(BOOKINGS, values, filters={"id": f"eq.{booking_id}"})

    # -- events ------------------------------------------------------------

    async def record_event(
        self,
        booking_id: str,
        event_type: str,
        *,
        message: str | None = None,
        metadata: dict[str, Any] | None = None,
        actor: str = "system",
    ) -> None:
        """Append a lifecycle event. Best effort — auditing must not break a flow.

        Callers pass safe metadata only (amounts, counts, status). Passport
        numbers, contact details, credentials and provider payloads are never
        included.
        """
        try:
            await self._db.insert(
                BOOKING_EVENTS,
                {
                    "booking_id": booking_id,
                    "event_type": event_type,
                    "message": message,
                    "actor": actor,
                    "metadata": metadata or {},
                },
                returning=False,
            )
        except SupabaseUnavailableError:
            logger.warning("booking_event_not_recorded", extra=log_extra(event_type=event_type))
