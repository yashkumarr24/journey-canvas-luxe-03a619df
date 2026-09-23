"""Server-side hotel search / review session store (durable, migration 0011).

Storage
-------
Sessions live in `hotel_search_sessions` / `hotel_review_sessions`, the hotel
mirror of `flight_review_sessions` (0007). That matters because these rows hold
the only trustworthy copy of the rate and the payable total between "customer
picked a room" and "customer pays": a process restart must not lose them, and a
second app instance must see them.

When the database is not configured (local development, offline UAT dry-runs)
the same interface falls back to an in-process TTL store. The fallback is
correct but not durable, so a restart asks the customer to search again rather
than showing a stale price.

In both backends:
  * the browser only ever holds opaque CSPRNG tokens
  * guest continuity is stored as a token HASH, never the token
  * the v3 identity chain (searchId -> optionId -> reviewHash) and every amount
    stay server-side
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from app.core.config import Settings
from app.core.logging import get_logger
from app.repositories.hotels import HotelSessionRepository, hash_token
from app.schemas.hotels import (
    HotelOccupancy,
    HotelResult,
    HotelRoomOption,
    HotelStay,
    HotelSummary,
)

logger = get_logger(__name__)

# TripJack hotel quotes are short-lived; we advertise a slightly shorter window
# than any provider hold so a dead quote is never presented as live.
SEARCH_TTL = timedelta(minutes=20)
REVIEW_TTL = timedelta(minutes=12)

MAX_SESSIONS = 2000
MAX_STORED_RESULTS = 240


def _token() -> str:
    # 48 hex chars: inside the 32..128 opaque-token bound the schema enforces.
    return secrets.token_hex(24)


def new_booking_reference() -> str:
    """Draft reference. Human-readable, no user data encoded in it."""
    return "FNFH" + secrets.token_hex(3).upper()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def _parse_dt(raw: Any) -> Optional[datetime]:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# ------------------------------------------------------------- session types --


@dataclass
class SearchSession:
    """Everything the later steps need about "what was searched"."""

    id: str  # opaque search_token handed to the browser
    row_id: Optional[str]
    destination: str
    check_in: str
    check_out: str
    nights: int
    rooms: List[HotelOccupancy]
    nationality: Optional[str]
    currency: str
    results: Dict[str, HotelResult]
    provider_search_id: Optional[str]
    expires_at: datetime
    user_id: Optional[str] = None

    @property
    def is_expired(self) -> bool:
        return _now() >= self.expires_at


@dataclass
class ReviewSession:
    token: str
    row_id: Optional[str]
    search_id: str
    hotel: HotelSummary
    room: HotelRoomOption
    stay: HotelStay
    currency: str
    expires_at: datetime
    provider_search_id: Optional[str]
    provider_hotel_id: str
    provider_option_id: str
    provider_review_hash: Optional[str] = None
    user_id: Optional[str] = None
    guest_token_hash: Optional[str] = None
    previous_total: Optional[float] = None
    booking_reference: Optional[str] = None
    guest_count: int = 0
    contact_email: Optional[str] = None
    requirements: dict = field(default_factory=dict)

    @property
    def is_expired(self) -> bool:
        return _now() >= self.expires_at


# ------------------------------------------------------------ memory fallback --


class _MemoryStore:
    def __init__(self) -> None:
        self.searches: Dict[str, SearchSession] = {}
        self.reviews: Dict[str, ReviewSession] = {}

    def sweep(self) -> None:
        for key in [k for k, v in self.searches.items() if v.is_expired]:
            self.searches.pop(key, None)
        for key in [k for k, v in self.reviews.items() if v.is_expired]:
            self.reviews.pop(key, None)
        # Hard cap so a flood cannot grow memory without bound.
        while len(self.searches) > MAX_SESSIONS:
            self.searches.pop(next(iter(self.searches)), None)
        while len(self.reviews) > MAX_SESSIONS:
            self.reviews.pop(next(iter(self.reviews)), None)


_memory = _MemoryStore()


def _repo(settings: Settings) -> Optional[HotelSessionRepository]:
    repo = HotelSessionRepository(settings)
    return repo if repo.enabled else None


# -------------------------------------------------------------------- search --


async def create_search_session(
    *,
    settings: Settings,
    destination: str,
    check_in: str,
    check_out: str,
    nights: int,
    rooms: List[HotelOccupancy],
    nationality: Optional[str],
    results: List[HotelResult],
    provider_search_id: Optional[str],
    currency: str,
    user_id: Optional[str],
) -> SearchSession:
    session = SearchSession(
        id=_token(),
        row_id=None,
        destination=destination,
        check_in=check_in,
        check_out=check_out,
        nights=nights,
        rooms=list(rooms),
        nationality=nationality,
        currency=currency,
        results={result.id: result for result in results[:MAX_STORED_RESULTS]},
        provider_search_id=provider_search_id,
        expires_at=_now() + SEARCH_TTL,
        user_id=user_id,
    )

    repo = _repo(settings)
    if repo is not None:
        try:
            row = await repo.create_search(
                {
                    "search_token": session.id,
                    "user_id": user_id,
                    "provider_search_id": provider_search_id,
                    "destination": destination,
                    "check_in": check_in,
                    "check_out": check_out,
                    "nights": nights,
                    "currency": currency,
                    "room_info": [room.model_dump(by_alias=True) for room in session.rooms],
                    "results": [
                        result.model_dump(by_alias=True, exclude_none=True)
                        for result in session.results.values()
                    ],
                    "result_count": len(session.results),
                    "expires_at": _iso(session.expires_at),
                }
            )
            if row:
                session.row_id = str(row.get("id"))
                return session
        except Exception:  # noqa: BLE001
            # Search is a read: degrade to memory rather than fail the customer.
            logger.warning("hotel_search_session_persist_failed")

    _memory.sweep()
    _memory.searches[session.id] = session
    return session


async def get_search_session(
    *, settings: Settings, search_id: str
) -> Optional[SearchSession]:
    repo = _repo(settings)
    if repo is not None:
        try:
            row = await repo.get_search(search_id)
        except Exception:  # noqa: BLE001
            logger.warning("hotel_search_session_read_failed")
            row = None
        if row is not None:
            session = _search_from_row(row)
            if session is not None and not session.is_expired:
                return session
            return None

    session = _memory.searches.get(search_id)
    if session is None:
        return None
    if session.is_expired:
        _memory.searches.pop(search_id, None)
        return None
    return session


def _search_from_row(row: dict[str, Any]) -> Optional[SearchSession]:
    expires_at = _parse_dt(row.get("expires_at"))
    if expires_at is None:
        return None

    results: Dict[str, HotelResult] = {}
    for raw in row.get("results") or []:
        if not isinstance(raw, dict):
            continue
        try:
            result = HotelResult.model_validate(raw)
        except Exception:  # noqa: BLE001 - one bad row never breaks the page
            continue
        results[result.id] = result

    rooms: List[HotelOccupancy] = []
    for raw in row.get("room_info") or []:
        if not isinstance(raw, dict):
            continue
        try:
            rooms.append(HotelOccupancy.model_validate(raw))
        except Exception:  # noqa: BLE001
            continue

    return SearchSession(
        id=str(row.get("search_token") or ""),
        row_id=str(row.get("id")) if row.get("id") else None,
        destination=str(row.get("destination") or ""),
        check_in=str(row.get("check_in") or ""),
        check_out=str(row.get("check_out") or ""),
        nights=int(row.get("nights") or 1),
        rooms=rooms or [HotelOccupancy()],
        nationality=None,
        currency=str(row.get("currency") or "INR"),
        results=results,
        provider_search_id=row.get("provider_search_id"),
        expires_at=expires_at,
        user_id=row.get("user_id"),
    )


# -------------------------------------------------------------------- review --


async def create_review_session(
    *,
    settings: Settings,
    search: SearchSession,
    hotel: HotelSummary,
    room: HotelRoomOption,
    stay: HotelStay,
    currency: str,
    provider_hotel_id: str,
    provider_option_id: str,
    provider_review_hash: Optional[str],
    requirements: dict,
    user_id: Optional[str],
    guest_token: Optional[str],
    issue_guest_token: bool,
    previous_total: Optional[float],
) -> tuple[ReviewSession, Optional[str]]:
    """Returns (session, guest_token_to_return_once).

    A guest token is returned to the browser exactly once, at creation; only its
    hash is ever stored.
    """
    issued: Optional[str] = None
    if guest_token:
        token_hash = hash_token(guest_token)
    elif issue_guest_token:
        issued = _token()
        token_hash = hash_token(issued)
    else:
        token_hash = None

    session = ReviewSession(
        token=_token(),
        row_id=None,
        search_id=search.id,
        hotel=hotel,
        room=room,
        stay=stay,
        currency=currency,
        expires_at=_now() + REVIEW_TTL,
        provider_search_id=search.provider_search_id,
        provider_hotel_id=provider_hotel_id,
        provider_option_id=provider_option_id,
        provider_review_hash=provider_review_hash,
        user_id=user_id,
        guest_token_hash=token_hash,
        previous_total=previous_total,
        requirements=requirements,
    )

    repo = _repo(settings)
    if repo is not None:
        try:
            row = await repo.create_review(
                {
                    "review_token": session.token,
                    "guest_token_hash": token_hash,
                    "user_id": user_id,
                    "hotel_search_id": search.row_id,
                    "provider_search_id": search.provider_search_id,
                    "provider_hotel_id": provider_hotel_id,
                    "provider_option_id": provider_option_id,
                    "provider_review_hash": provider_review_hash,
                    "searched_amount": previous_total,
                    "total_amount": room.total_price.amount,
                    "base_amount": room.base_price.amount if room.base_price else None,
                    "tax_amount": room.taxes.amount if room.taxes else None,
                    "management_fee": room.management_fee.amount if room.management_fee else None,
                    "management_fee_tax": room.management_fee_tax.amount
                    if room.management_fee_tax
                    else None,
                    "currency": currency,
                    "option_type": room.option_type,
                    "rate_plan_type": room.rate_plan_type,
                    "status": "price_changed"
                    if previous_total is not None and previous_total != room.total_price.amount
                    else "reviewed",
                    "hotel": hotel.model_dump(by_alias=True, exclude_none=True),
                    "room": room.model_dump(by_alias=True, exclude_none=True),
                    "stay": stay.model_dump(by_alias=True, exclude_none=True),
                    "requirements": requirements,
                    "expires_at": _iso(session.expires_at),
                }
            )
            if row:
                session.row_id = str(row.get("id"))
                return session, issued
        except Exception:  # noqa: BLE001
            logger.warning("hotel_review_session_persist_failed")

    _memory.sweep()
    _memory.reviews[session.token] = session
    return session, issued


async def get_review_session(
    *, settings: Settings, review_token: str
) -> Optional[ReviewSession]:
    repo = _repo(settings)
    if repo is not None:
        try:
            row = await repo.get_review(review_token)
        except Exception:  # noqa: BLE001
            logger.warning("hotel_review_session_read_failed")
            row = None
        if row is not None:
            session = _review_from_row(row)
            if session is not None and not session.is_expired:
                return session
            return None

    session = _memory.reviews.get(review_token)
    if session is None:
        return None
    if session.is_expired:
        _memory.reviews.pop(review_token, None)
        return None
    return session


def _review_from_row(row: dict[str, Any]) -> Optional[ReviewSession]:
    expires_at = _parse_dt(row.get("expires_at"))
    if expires_at is None:
        return None
    try:
        hotel = HotelSummary.model_validate(row.get("hotel") or {})
        room = HotelRoomOption.model_validate(row.get("room") or {})
        stay = HotelStay.model_validate(row.get("stay") or {})
    except Exception:  # noqa: BLE001 - unusable row is treated as expired
        return None

    searched = row.get("searched_amount")
    return ReviewSession(
        token=str(row.get("review_token") or ""),
        row_id=str(row.get("id")) if row.get("id") else None,
        search_id="",
        hotel=hotel,
        room=room,
        stay=stay,
        currency=str(row.get("currency") or "INR"),
        expires_at=expires_at,
        provider_search_id=row.get("provider_search_id"),
        provider_hotel_id=str(row.get("provider_hotel_id") or ""),
        provider_option_id=str(row.get("provider_option_id") or ""),
        provider_review_hash=row.get("provider_review_hash"),
        user_id=row.get("user_id"),
        guest_token_hash=row.get("guest_token_hash"),
        previous_total=float(searched) if searched is not None else None,
        booking_reference=row.get("booking_reference"),
        guest_count=int(row.get("guest_count") or 0),
        contact_email=row.get("contact_email"),
        requirements=row.get("requirements") if isinstance(row.get("requirements"), dict) else {},
    )


async def record_guest_details(
    *,
    settings: Settings,
    session: ReviewSession,
    booking_reference: str,
    guest_count: int,
    contact_email: Optional[str],
) -> None:
    session.booking_reference = booking_reference
    session.guest_count = guest_count
    session.contact_email = contact_email

    repo = _repo(settings)
    if repo is not None and session.row_id:
        try:
            await repo.update_review(
                session.row_id,
                {
                    "booking_reference": booking_reference,
                    "guest_count": guest_count,
                    "contact_email": contact_email,
                    "status": "guests_submitted",
                },
            )
        except Exception:  # noqa: BLE001
            logger.warning("hotel_review_session_update_failed")


def owns(
    session: ReviewSession, *, user_id: Optional[str], guest_token: Optional[str]
) -> bool:
    """A session belongs either to a verified user or to the guest token."""
    if session.user_id:
        return bool(user_id) and user_id == session.user_id
    if session.guest_token_hash:
        return bool(guest_token) and secrets.compare_digest(
            hash_token(guest_token), session.guest_token_hash
        )
    # Sessions are always created with one owner or the other.
    return False


def expires_at_iso(session: SearchSession | ReviewSession) -> str:
    return _iso(session.expires_at)


def seconds_left(session: SearchSession | ReviewSession) -> int:
    return max(int((session.expires_at - _now()).total_seconds()), 0)
