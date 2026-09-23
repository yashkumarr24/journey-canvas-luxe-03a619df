"""Server-side hotel search / review session store.

Why in-process
--------------
Flights persist review sessions in `flight_review_sessions` (migration 0007).
There is no hotel equivalent table yet, and inventing one before the hotel
booking contract is confirmed would bake in the wrong shape. So hotel sessions
live in process memory with a TTL, exactly like `app.core.rate_limit`:

  * correct for the single-VPS deployment we run today
  * the price the customer pays is still resolved SERVER-SIDE only — the
    browser holds nothing but opaque tokens
  * a restart invalidates sessions, and the customer is asked to search again
    rather than being shown a stale price

PENDING: a `hotel_review_sessions` migration (mirroring 0007) once the hotel
booking contract is confirmed. The interface below is deliberately narrow so
only the storage swaps.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from app.schemas.hotels import (
    HotelResult,
    HotelRoomOption,
    HotelSearchRequest,
    HotelStay,
    HotelSummary,
)

# TripJack hotel quotes are short-lived; we advertise a slightly shorter window
# than any provider hold so a dead quote is never presented as live.
SEARCH_TTL = timedelta(minutes=20)
REVIEW_TTL = timedelta(minutes=12)

MAX_SESSIONS = 2000


def _token() -> str:
    # 48 hex chars: inside the 32..128 opaque-token bound the API validates.
    return secrets.token_hex(24)


def _now() -> float:
    return time.time()


@dataclass
class SearchSession:
    id: str
    request: HotelSearchRequest
    results: Dict[str, HotelResult]
    provider_search_id: Optional[str]
    currency: str
    expires_at: float
    user_id: Optional[str] = None

    @property
    def is_expired(self) -> bool:
        return _now() >= self.expires_at


@dataclass
class ReviewSession:
    token: str
    search_id: str
    hotel: HotelSummary
    room: HotelRoomOption
    stay: HotelStay
    currency: str
    expires_at: float
    provider_hotel_id: str
    provider_rate_id: str
    user_id: Optional[str] = None
    guest_token: Optional[str] = None
    previous_total: Optional[float] = None
    booking_reference: Optional[str] = None
    guest_count: int = 0
    contact_email: Optional[str] = None
    extra: dict = field(default_factory=dict)

    @property
    def is_expired(self) -> bool:
        return _now() >= self.expires_at


class _Store:
    def __init__(self) -> None:
        self.searches: Dict[str, SearchSession] = {}
        self.reviews: Dict[str, ReviewSession] = {}

    def _sweep(self) -> None:
        for key in [k for k, v in self.searches.items() if v.is_expired]:
            self.searches.pop(key, None)
        for key in [k for k, v in self.reviews.items() if v.is_expired]:
            self.reviews.pop(key, None)
        # Hard cap so a flood cannot grow memory without bound.
        while len(self.searches) > MAX_SESSIONS:
            self.searches.pop(next(iter(self.searches)), None)
        while len(self.reviews) > MAX_SESSIONS:
            self.reviews.pop(next(iter(self.reviews)), None)


_store = _Store()


# ------------------------------------------------------------------ search --


def create_search_session(
    *,
    request: HotelSearchRequest,
    results: list[HotelResult],
    provider_search_id: Optional[str],
    currency: str,
    user_id: Optional[str],
) -> SearchSession:
    _store._sweep()
    session = SearchSession(
        id=_token(),
        request=request,
        results={result.id: result for result in results},
        provider_search_id=provider_search_id,
        currency=currency,
        expires_at=_now() + SEARCH_TTL.total_seconds(),
        user_id=user_id,
    )
    _store.searches[session.id] = session
    return session


def get_search_session(search_id: str) -> Optional[SearchSession]:
    session = _store.searches.get(search_id)
    if session is None:
        return None
    if session.is_expired:
        _store.searches.pop(search_id, None)
        return None
    return session


# ------------------------------------------------------------------ review --


def create_review_session(
    *,
    search_id: str,
    hotel: HotelSummary,
    room: HotelRoomOption,
    stay: HotelStay,
    currency: str,
    provider_hotel_id: str,
    provider_rate_id: str,
    user_id: Optional[str],
    issue_guest_token: bool,
    previous_total: Optional[float],
) -> tuple[ReviewSession, Optional[str]]:
    """Returns (session, guest_token_to_return_once)."""
    _store._sweep()
    guest_token = _token() if issue_guest_token else None
    session = ReviewSession(
        token=_token(),
        search_id=search_id,
        hotel=hotel,
        room=room,
        stay=stay,
        currency=currency,
        expires_at=_now() + REVIEW_TTL.total_seconds(),
        provider_hotel_id=provider_hotel_id,
        provider_rate_id=provider_rate_id,
        user_id=user_id,
        guest_token=guest_token,
        previous_total=previous_total,
    )
    _store.reviews[session.token] = session
    return session, guest_token


def get_review_session(review_token: str) -> Optional[ReviewSession]:
    session = _store.reviews.get(review_token)
    if session is None:
        return None
    if session.is_expired:
        _store.reviews.pop(review_token, None)
        return None
    return session


def owns(session: ReviewSession, *, user_id: Optional[str], guest_token: Optional[str]) -> bool:
    """A session belongs either to a verified user or to the guest token."""
    if session.user_id:
        return bool(user_id) and user_id == session.user_id
    if session.guest_token:
        return bool(guest_token) and secrets.compare_digest(guest_token, session.guest_token)
    # Sessions are always created with one owner or the other.
    return False


def expires_at_iso(session: SearchSession | ReviewSession) -> str:
    return datetime.fromtimestamp(session.expires_at, tz=timezone.utc).isoformat(timespec="seconds")


def seconds_left(session: SearchSession | ReviewSession) -> int:
    return max(int(session.expires_at - _now()), 0)


def new_booking_reference() -> str:
    """Draft reference. Human-readable, no user data encoded in it."""
    return "FNFH" + secrets.token_hex(3).upper()
