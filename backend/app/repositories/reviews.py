"""Fare reference + review session persistence (PHASE 7).

Two invariants this module exists to protect:

  1. The payable amount is read from the database, never from a request body.
  2. A review session can only be resumed by the identity that created it
     (verified user id, or the hash of a server-issued guest token).
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from app.core.config import Settings
from app.repositories.supabase_rest import SupabaseRest, SupabaseUnavailableError

REVIEW_SESSIONS = "flight_review_sessions"
RESULT_REFS = "search_result_refs"
FLIGHT_SEARCHES = "flight_searches"
IDEMPOTENCY = "request_idempotency"


def new_token() -> str:
    """43-char URL-safe CSPRNG token. Unpredictable, non-sequential."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _dt(raw: Any) -> Optional[datetime]:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _dec(raw: Any) -> Decimal:
    try:
        return Decimal(str(raw)).quantize(Decimal("0.01"))
    except Exception:  # noqa: BLE001 - malformed row is treated as zero, never crash
        return Decimal("0.00")


@dataclass(frozen=True)
class SearchContext:
    search_id: str
    user_id: Optional[str]
    adults: int
    children: int
    infants: int
    currency: str


@dataclass(frozen=True)
class FareRef:
    id: str
    provider_ref: str
    total_amount: Decimal
    currency: str
    expires_at: Optional[datetime]

    @property
    def expired(self) -> bool:
        return self.expires_at is None or self.expires_at <= datetime.now(timezone.utc)


@dataclass(frozen=True)
class ReviewSession:
    id: str
    review_token: str
    user_id: Optional[str]
    guest_token_hash: Optional[str]
    flight_search_id: str
    provider_price_ref: str
    provider_booking_ref: Optional[str]
    searched_amount: Decimal
    total_amount: Decimal
    base_amount: Optional[Decimal]
    tax_amount: Optional[Decimal]
    currency: str
    adults: int
    children: int
    infants: int
    status: str
    itinerary: dict[str, Any]
    requirements: dict[str, Any]
    booking_id: Optional[str]
    expires_at: Optional[datetime]

    @property
    def expired(self) -> bool:
        return self.expires_at is None or self.expires_at <= datetime.now(timezone.utc)

    @property
    def passenger_total(self) -> int:
        return self.adults + self.children + self.infants


class ReviewRepository:
    def __init__(self, settings: Settings) -> None:
        self._db = SupabaseRest(settings)

    @property
    def enabled(self) -> bool:
        return self._db.enabled

    # -- search + fare reference ------------------------------------------

    async def get_search(self, search_id: str) -> Optional[SearchContext]:
        rows = await self._db.select(
            FLIGHT_SEARCHES,
            columns="id,user_id,adults,children,infants,currency",
            filters={"id": f"eq.{search_id}"},
        )
        if not rows:
            return None
        row = rows[0]
        return SearchContext(
            search_id=str(row.get("id")),
            user_id=row.get("user_id"),
            adults=int(row.get("adults") or 1),
            children=int(row.get("children") or 0),
            infants=int(row.get("infants") or 0),
            currency=str(row.get("currency") or "INR"),
        )

    async def get_fare_ref(self, search_id: str, provider_ref: str) -> Optional[FareRef]:
        """Resolve a fare token WITHIN one search. A token from another search
        simply does not match, so cross-search replay returns nothing."""
        rows = await self._db.select(
            RESULT_REFS,
            columns="id,provider_ref,total_amount,currency,expires_at",
            filters={
                "flight_search_id": f"eq.{search_id}",
                "provider_ref": f"eq.{provider_ref}",
                "search_kind": "eq.flight",
            },
            order="created_at.desc",
        )
        if not rows:
            return None
        row = rows[0]
        return FareRef(
            id=str(row.get("id")),
            provider_ref=str(row.get("provider_ref")),
            total_amount=_dec(row.get("total_amount")),
            currency=str(row.get("currency") or "INR"),
            expires_at=_dt(row.get("expires_at")),
        )

    # -- review sessions ---------------------------------------------------

    async def create_session(self, values: dict[str, Any]) -> Optional[ReviewSession]:
        rows = await self._db.insert(REVIEW_SESSIONS, values)
        return _to_session(rows[0]) if rows else None

    async def get_session(self, review_token: str) -> Optional[ReviewSession]:
        rows = await self._db.select(
            REVIEW_SESSIONS,
            columns="*",
            filters={"review_token": f"eq.{review_token}"},
        )
        return _to_session(rows[0]) if rows else None

    async def update_session(self, session_id: str, values: dict[str, Any]) -> None:
        await self._db.update(REVIEW_SESSIONS, values, filters={"id": f"eq.{session_id}"})

    # -- idempotency -------------------------------------------------------

    async def claim_idempotency(self, *, scope: str, key: str, subject: str) -> Optional[str]:
        """Reserve a client key. Returns the previous result_ref on a replay.

        Only the SHA-256 of the key is stored, and the primary key on
        (scope, key_hash) makes the insert the concurrency control.
        """
        key_hash = hash_token(key)
        existing = await self._db.select(
            IDEMPOTENCY,
            columns="result_ref",
            filters={"scope": f"eq.{scope}", "key_hash": f"eq.{key_hash}"},
        )
        if existing:
            return str(existing[0].get("result_ref") or "")

        try:
            await self._db.insert(
                IDEMPOTENCY,
                {"scope": scope, "key_hash": key_hash, "subject": subject},
                returning=False,
            )
        except SupabaseUnavailableError:
            # A racing duplicate lost the insert: re-read and treat as replay.
            again = await self._db.select(
                IDEMPOTENCY,
                columns="result_ref",
                filters={"scope": f"eq.{scope}", "key_hash": f"eq.{key_hash}"},
            )
            if again:
                return str(again[0].get("result_ref") or "")
            raise
        return None

    async def complete_idempotency(self, *, scope: str, key: str, result_ref: str) -> None:
        await self._db.update(
            IDEMPOTENCY,
            {"result_ref": result_ref},
            filters={"scope": f"eq.{scope}", "key_hash": f"eq.{hash_token(key)}"},
        )


def _to_session(row: dict[str, Any]) -> ReviewSession:
    return ReviewSession(
        id=str(row.get("id")),
        review_token=str(row.get("review_token") or ""),
        user_id=row.get("user_id"),
        guest_token_hash=row.get("guest_token_hash"),
        flight_search_id=str(row.get("flight_search_id") or ""),
        provider_price_ref=str(row.get("provider_price_ref") or ""),
        provider_booking_ref=row.get("provider_booking_ref"),
        searched_amount=_dec(row.get("searched_amount")),
        total_amount=_dec(row.get("total_amount")),
        base_amount=_dec(row["base_amount"]) if row.get("base_amount") is not None else None,
        tax_amount=_dec(row["tax_amount"]) if row.get("tax_amount") is not None else None,
        currency=str(row.get("currency") or "INR"),
        adults=int(row.get("adults") or 1),
        children=int(row.get("children") or 0),
        infants=int(row.get("infants") or 0),
        status=str(row.get("status") or "reviewed"),
        itinerary=row.get("itinerary") if isinstance(row.get("itinerary"), dict) else {},
        requirements=row.get("requirements") if isinstance(row.get("requirements"), dict) else {},
        booking_id=row.get("booking_id"),
        expires_at=_dt(row.get("expires_at")),
    )
