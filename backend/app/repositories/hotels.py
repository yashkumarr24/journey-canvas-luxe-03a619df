"""Hotel search + review session persistence (migration 0011).

Same two invariants as `repositories/reviews.py`:

  1. The payable amount is read from the database, never from a request body.
  2. A session can only be resumed by the identity that created it — a verified
     user id, or the SHA-256 of a server-issued guest token.

Only FastAPI (service_role) can reach these tables; the browser holds nothing
but opaque tokens.
"""

from __future__ import annotations

from typing import Any, Optional

from app.core.config import Settings
from app.repositories.reviews import hash_token, new_token  # shared token helpers
from app.repositories.supabase_rest import SupabaseRest

HOTEL_SEARCHES = "hotel_search_sessions"
HOTEL_REVIEWS = "hotel_review_sessions"

__all__ = ["HotelSessionRepository", "hash_token", "new_token"]


class HotelSessionRepository:
    def __init__(self, settings: Settings) -> None:
        self._db = SupabaseRest(settings)

    @property
    def enabled(self) -> bool:
        return self._db.enabled

    # -- searches ----------------------------------------------------------

    async def create_search(self, values: dict[str, Any]) -> Optional[dict[str, Any]]:
        rows = await self._db.insert(HOTEL_SEARCHES, values)
        return rows[0] if rows else None

    async def get_search(self, search_token: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(
            HOTEL_SEARCHES,
            columns="*",
            filters={"search_token": f"eq.{search_token}"},
        )
        return rows[0] if rows else None

    # -- reviews -----------------------------------------------------------

    async def create_review(self, values: dict[str, Any]) -> Optional[dict[str, Any]]:
        rows = await self._db.insert(HOTEL_REVIEWS, values)
        return rows[0] if rows else None

    async def get_review(self, review_token: str) -> Optional[dict[str, Any]]:
        rows = await self._db.select(
            HOTEL_REVIEWS,
            columns="*",
            filters={"review_token": f"eq.{review_token}"},
        )
        return rows[0] if rows else None

    async def update_review(self, session_id: str, values: dict[str, Any]) -> None:
        await self._db.update(HOTEL_REVIEWS, values, filters={"id": f"eq.{session_id}"})
