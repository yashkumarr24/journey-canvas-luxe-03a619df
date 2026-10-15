"""Hotel booking lifecycle: Book (instant / hold), Booking Details, Confirm Hold,
Cancel — TripJack Hotel API v3.

Rules enforced here, never in the browser:
  * The payable amount is the server-held Review total. A fresh Review runs
    immediately before Book (TripJack requirement); if its total differs from
    what the customer agreed, Book is refused.
  * Every state change is a compare-and-set, so a double click / retry can
    never produce two provider bookings or two confirmations.
  * A booking belongs to one identity (verified user or hashed guest token).
  * Provider handles (bookingId, correlationId, reviewHash), PAN and passport
    numbers never leave the server. PAN/passport are scrubbed after Book.
  * Hold deadlines come only from TripJack. None is ever invented.
  * INSTANT booking and hold CONFIRMATION spend money. In production they are
    refused until server-side payment verification exists.
"""

from __future__ import annotations

import asyncio
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

from fastapi import status

from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import get_logger, log_extra
from app.integrations.tripjack import hotel_booking as wire
from app.integrations.tripjack import hotels as tripjack_hotels
from app.integrations.tripjack.client import get_hotel_booker_client
from app.integrations.tripjack.config import build_hotel_booker_config
from app.integrations.tripjack.exceptions import TripJackBadRequestError, TripJackTimeoutError
from app.integrations.tripjack.hotel_wire import HOTEL_REVIEW_PATH, build_review_payload
from app.repositories.hotel_bookings import HotelBookingRepository
from app.repositories.hotels import hash_token

logger = get_logger(__name__)

# ------------------------------------------------------------------ states --

DRAFT = "DRAFT"
REVIEWED = "REVIEWED"
BOOKING_IN_PROGRESS = "BOOKING_IN_PROGRESS"
CONFIRMED = "CONFIRMED"
ON_HOLD = "ON_HOLD"
CONFIRMING = "CONFIRMING"
FAILED = "FAILED"
ABORTED = "ABORTED"
CANCELLATION_REQUESTED = "CANCELLATION_REQUESTED"
CANCELLATION_PENDING = "CANCELLATION_PENDING"
CANCELLED = "CANCELLED"

TRANSITIONS: dict[str, set[str]] = {
    DRAFT: {REVIEWED, FAILED},
    REVIEWED: {BOOKING_IN_PROGRESS, DRAFT, FAILED},
    BOOKING_IN_PROGRESS: {CONFIRMED, ON_HOLD, FAILED, ABORTED, CANCELLED},
    ON_HOLD: {CONFIRMING, CANCELLATION_REQUESTED, CANCELLED, ABORTED, FAILED},
    CONFIRMING: {CONFIRMED, ON_HOLD, FAILED, ABORTED, CANCELLED},
    CONFIRMED: {CANCELLATION_REQUESTED, CANCELLED},
    CANCELLATION_REQUESTED: {CANCELLATION_PENDING, CANCELLED, CONFIRMED, ON_HOLD},
    CANCELLATION_PENDING: {CANCELLED, CONFIRMED},
    FAILED: set(),
    ABORTED: set(),
    CANCELLED: set(),
}
TERMINAL = {FAILED, ABORTED, CANCELLED}

# TripJack order.status -> our state.
PROVIDER_TO_STATE = {
    "SUCCESS": CONFIRMED,
    "ON_HOLD": ON_HOLD,
    "ABORTED": ABORTED,
    "FAILED": FAILED,
    "CANCELLED": CANCELLED,
    "CANCELLATION_PENDING": CANCELLATION_PENDING,
}

POLL_INTERVAL = 5.0
POLL_MAX = 180.0
HOLD_RECHECK = timedelta(minutes=5)
CANCELLATION_PENDING_RECHECK = timedelta(minutes=30)  # documented: do not poll continuously


def can_transition(frm: str, to: str) -> bool:
    return to in TRANSITIONS.get(frm, set())


# ------------------------------------------------------------------ errors --


class HotelBookingNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "HOTEL_BOOKING_NOT_FOUND"
    message = "We couldn't find this booking in your current session."


class HotelBookingStateError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "HOTEL_BOOKING_STATE"
    message = "This booking can't do that right now. Please refresh to see its latest status."


class HotelBookingDuplicateError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "HOTEL_BOOKING_DUPLICATE"
    message = "This booking is already being processed."


class HotelHoldNotAllowedError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "HOTEL_HOLD_NOT_ALLOWED"
    message = "This room can't be held. Please book it now instead."


class HotelHoldExpiredError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "HOTEL_HOLD_EXPIRED"
    message = "The hold on this room has ended, so it can no longer be confirmed."


class HotelBookingPriceChangedError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "HOTEL_BOOKING_PRICE_CHANGED"
    message = "The hotel changed the price just now. Please pick the room again to see the new total."


class HotelBookingValidationError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "HOTEL_BOOKING_INVALID"
    message = "Some guest or contact details don't meet the hotel's requirements."


class HotelPaymentRequiredError(AppError):
    status_code = status.HTTP_402_PAYMENT_REQUIRED
    code = "HOTEL_PAYMENT_NOT_VERIFIED"
    message = "Payment must be confirmed before this booking can be completed."


class HotelBookingUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "HOTEL_BOOKING_UNAVAILABLE"
    message = "Hotel booking is temporarily unavailable. No booking was made. Please try again."


# ------------------------------------------------------------------ record --


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(v: Optional[datetime]) -> Optional[str]:
    return v.isoformat() if v else None


def _dt(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    # TripJack deadlines carry no offset; they are IST.
    return d if d.tzinfo else d.replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))


@dataclass
class HotelBooking:
    booking_reference: str
    review_token: str
    provider_hotel_id: str
    provider_option_id: str
    total_amount: float
    currency: str = "INR"
    status: str = DRAFT
    row_id: Optional[str] = None
    user_id: Optional[str] = None
    guest_token_hash: Optional[str] = None
    previous_status: Optional[str] = None
    mode: Optional[str] = None
    idempotency_key: Optional[str] = None
    provider_search_id: Optional[str] = None
    provider_booking_id: Optional[str] = None
    provider_status: Optional[str] = None
    provider_order_amount: Optional[float] = None
    nationality: Optional[str] = None
    hotel: dict = field(default_factory=dict)
    room: dict = field(default_factory=dict)
    stay: dict = field(default_factory=dict)
    requirements: dict = field(default_factory=dict)
    guests: list = field(default_factory=list)
    contact: dict = field(default_factory=dict)
    special_requests: Optional[str] = None
    hold_deadline: Optional[str] = None
    hotel_confirmation_number: Optional[str] = None
    cancellation: Optional[dict] = None
    status_message: Optional[str] = None
    booked_at: Optional[str] = None
    last_checked_at: Optional[str] = None
    confirmed_at: Optional[str] = None
    cancelled_at: Optional[str] = None

    COLUMNS = (
        "booking_reference", "review_token", "user_id", "guest_token_hash", "status",
        "previous_status", "mode", "idempotency_key", "provider_search_id", "provider_hotel_id",
        "provider_option_id", "provider_booking_id", "provider_status", "nationality", "currency",
        "total_amount", "provider_order_amount", "hotel", "room", "stay", "requirements", "guests",
        "contact", "special_requests", "hold_deadline", "hotel_confirmation_number", "cancellation",
        "status_message", "booked_at", "last_checked_at", "confirmed_at", "cancelled_at",
    )

    def row(self) -> dict[str, Any]:
        return {k: getattr(self, k) for k in self.COLUMNS}

    @classmethod
    def from_row(cls, r: dict[str, Any]) -> "HotelBooking":
        kw = {k: r.get(k) for k in cls.COLUMNS if k in r}
        for k in ("hotel", "room", "stay", "requirements", "contact"):
            kw[k] = kw.get(k) or {}
        kw["guests"] = kw.get("guests") or []
        kw["total_amount"] = float(kw.get("total_amount") or 0)
        if kw.get("provider_order_amount") is not None:
            kw["provider_order_amount"] = float(kw["provider_order_amount"])
        b = cls(**kw)
        b.row_id = str(r["id"]) if r.get("id") else None
        return b


def owns(b: HotelBooking, *, user_id: Optional[str], guest_token: Optional[str]) -> bool:
    if b.user_id:
        return bool(user_id) and user_id == b.user_id
    if b.guest_token_hash:
        return bool(guest_token) and secrets.compare_digest(hash_token(guest_token), b.guest_token_hash)
    return False


# ------------------------------------------------------------------- store --


class _MemoryStore:
    def __init__(self) -> None:
        self.by_ref: dict[str, HotelBooking] = {}
        self.lock = asyncio.Lock()
        self.events: list[dict] = []


_memory = _MemoryStore()


class BookingStore:
    """DB-backed when configured, in-process otherwise. Same CAS semantics."""

    def __init__(self, settings: Settings) -> None:
        repo = HotelBookingRepository(settings)
        self.repo = repo if repo.enabled else None

    async def create(self, b: HotelBooking) -> HotelBooking:
        if self.repo:
            existing = await self.repo.by_review_token(b.review_token)
            if existing:
                return HotelBooking.from_row(existing)
            row = await self.repo.insert(b.row())
            if row:
                return HotelBooking.from_row(row)
        async with _memory.lock:
            for x in _memory.by_ref.values():
                if x.review_token == b.review_token:
                    return x
            _memory.by_ref[b.booking_reference] = b
        return b

    async def get(self, reference: str) -> Optional[HotelBooking]:
        if self.repo:
            row = await self.repo.by_reference(reference)
            return HotelBooking.from_row(row) if row else None
        return _memory.by_ref.get(reference)

    async def transition(self, b: HotelBooking, to: str, event: str, **values: Any) -> bool:
        """Compare-and-set b.status -> to. Returns False if someone else moved it."""
        frm = b.status
        if not can_transition(frm, to):
            raise HotelBookingStateError()
        values = {**values, "status": to, "previous_status": frm}
        if self.repo and b.row_id:
            ok = await self.repo.transition(b.row_id, frm, {**values, "updated_at": _iso(_now())})
        else:
            async with _memory.lock:
                cur = _memory.by_ref.get(b.booking_reference)
                ok = cur is not None and cur.status == frm
                if ok:
                    for k, v in values.items():
                        setattr(cur, k, v)
        if ok:
            for k, v in values.items():
                setattr(b, k, v)
            await self._event(b, frm, to, event)
        return ok

    async def save(self, b: HotelBooking, **values: Any) -> None:
        for k, v in values.items():
            setattr(b, k, v)
        if self.repo and b.row_id:
            await self.repo.update(b.row_id, {**values, "updated_at": _iso(_now())})
        elif b.booking_reference in _memory.by_ref:
            cur = _memory.by_ref[b.booking_reference]
            for k, v in values.items():
                setattr(cur, k, v)

    async def _event(self, b: HotelBooking, frm: str, to: str, event: str) -> None:
        rec = {"from_status": frm, "to_status": to, "event": event}
        try:
            if self.repo and b.row_id:
                await self.repo.event({**rec, "booking_id": b.row_id})
            else:
                _memory.events.append({**rec, "booking_reference": b.booking_reference})
        except Exception:  # noqa: BLE001 — audit trail must not break booking
            logger.warning("hotel_booking_event_persist_failed")
        logger.info("hotel_booking_transition", extra=log_extra(from_status=frm, to_status=to, event=event))


# ---------------------------------------------------------------- provider --


class Provider:
    """Thin seam so tests inject fakes. hms = review host, booker = OMS host."""

    def __init__(self, hms_client, booker_client) -> None:
        self.hms = hms_client
        self.booker = booker_client


def _default_provider(settings: Settings) -> Provider:
    from app.services.hotel_search import _provider as hms_provider  # reuse guards

    hms_client, _ = hms_provider(settings)
    cfg = build_hotel_booker_config(settings)
    if not cfg.is_configured:
        raise HotelBookingUnavailableError()
    if not settings.is_production and cfg.targets_production:
        logger.error("tripjack_hotel_booker_production_url_in_non_production")
        raise HotelBookingUnavailableError()
    return Provider(hms_client, get_hotel_booker_client(cfg))


provider_factory: Callable[[Settings], Provider] = _default_provider


def _payment_gate(settings: Settings, *, payment_verified: bool) -> None:
    """INSTANT book and hold CONFIRM debit the TripJack wallet. In production that
    must follow a verified customer payment, which is not implemented yet."""
    if settings.is_production and not payment_verified:
        raise HotelPaymentRequiredError()


# ------------------------------------------------------------------- draft --


async def create_draft(
    *, settings: Settings, review_session, booking_reference: str, guests: list, contact,
    special_requests: Optional[str], nationality: Optional[str],
) -> HotelBooking:
    """Called from guest capture. Guests (incl. PAN/passport) are kept server-side
    only until the Book call, then PAN/passport are scrubbed."""
    b = HotelBooking(
        booking_reference=booking_reference,
        review_token=review_session.token,
        provider_hotel_id=review_session.provider_hotel_id,
        provider_option_id=review_session.provider_option_id,
        total_amount=float(review_session.room.total_price.amount),
        currency=review_session.currency,
        user_id=review_session.user_id,
        guest_token_hash=review_session.guest_token_hash,
        provider_search_id=review_session.provider_search_id,
        nationality=nationality,
        hotel=review_session.hotel.model_dump(by_alias=True, exclude_none=True),
        room=review_session.room.model_dump(by_alias=True, exclude_none=True),
        stay=review_session.stay.model_dump(by_alias=True, exclude_none=True),
        requirements=dict(review_session.requirements or {}),
        guests=[g.model_dump(mode="json") for g in guests],
        contact=contact.model_dump(mode="json"),
        special_requests=special_requests,
    )
    return await BookingStore(settings).create(b)


# ------------------------------------------------------------------ helpers --


def _rooms(b: HotelBooking) -> list[dict[str, Any]]:
    rooms = (b.stay or {}).get("rooms") or []
    out = []
    for r in rooms:
        out.append({"adults": int(r.get("adults") or 0),
                    "childAges": list(r.get("childAges") or r.get("child_ages") or [])})
    return out


def _travellers(b: HotelBooking) -> list[wire.BookTraveller]:
    out = []
    for g in b.guests:
        out.append(wire.BookTraveller(
            room_index=int(g.get("room_index") or 1),
            type=str(g.get("type") or "adult"),
            title=str(g.get("title") or ""),
            first_name=str(g.get("first_name") or ""),
            last_name=str(g.get("last_name") or ""),
            pan=g.get("pan_number") or None,
            passport=g.get("passport_number") or None,
        ))
    return out


def _scrubbed_guests(b: HotelBooking) -> list[dict]:
    return [{k: v for k, v in g.items() if k not in ("pan_number", "passport_number")} for g in b.guests]


def _contact(b: HotelBooking) -> wire.BookContact:
    c = b.contact or {}
    return wire.BookContact(email=str(c.get("email") or ""), phone=str(c.get("phone") or ""),
                            dial_code=str(c.get("dial_code") or "+91"))


def _search_session(b: HotelBooking):
    from app.services import hotel_sessions as sessions
    from app.schemas.hotels import HotelOccupancy

    stay = b.stay or {}
    rooms = [HotelOccupancy(adults=r["adults"], child_ages=r["childAges"]) for r in _rooms(b)]
    return sessions.SearchSession(
        id="", row_id=None, destination="", check_in=str(stay.get("checkIn") or ""),
        check_out=str(stay.get("checkOut") or ""), nights=int(stay.get("nights") or 1), rooms=rooms,
        nationality=b.nationality, currency=b.currency, results={},
        provider_search_id=b.provider_search_id, expires_at=_now() + timedelta(minutes=5),
    )


async def _fresh_review(settings: Settings, provider: Provider, b: HotelBooking) -> wire.FreshReview:
    """Detail -> Review immediately before Book (TripJack requirement)."""
    from app.services import hotel_search as hs
    from app.schemas.hotels import HotelResult

    detail, review_hash = await hs._priced_hotel(
        settings=settings, session=_search_session(b), provider_hotel_id=b.provider_hotel_id,
        fallback=HotelResult(id=b.provider_hotel_id, name=str((b.hotel or {}).get("name") or "Hotel")),
    )
    selected = next((r for r in detail.rooms if r.id == b.provider_option_id), None)
    if selected is None or not review_hash or not b.provider_search_id:
        raise hs.HotelRoomUnavailableError()
    try:
        body = await provider.hms.post(
            HOTEL_REVIEW_PATH,
            build_review_payload(listing_correlation_id=b.provider_search_id, hid=b.provider_hotel_id,
                                 option_id=selected.id, review_hash=review_hash),
            retries=0, operation="hotel_review_prebook",
        )
        reviewed = tripjack_hotels.normalize_review_response(
            body, provider_hotel_id=b.provider_hotel_id, selected=selected, currency=b.currency)
    except ValueError:
        raise hs.HotelRoomUnavailableError() from None
    except TripJackBadRequestError as exc:
        if exc.provider_code in hs.REVIEW_EXPIRED_CODES:
            raise hs.HotelSearchExpiredError() from None
        raise hs.HotelRoomUnavailableError() from None
    except AppError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise hs._map_provider_error(exc) from None
    fresh = wire.parse_fresh_review(body)
    fresh.total = reviewed.room.total_price.amount  # parsed through the confirmed review parser
    return fresh


def _apply_details(b: HotelBooking, d: wire.BookingDetails) -> dict[str, Any]:
    vals: dict[str, Any] = {"last_checked_at": _iso(_now())}
    if d.provider_status:
        vals["provider_status"] = d.provider_status
    if d.amount is not None:
        vals["provider_order_amount"] = d.amount
    if d.hold_deadline:
        vals["hold_deadline"] = d.hold_deadline
    if d.confirmation_number:
        vals["hotel_confirmation_number"] = d.confirmation_number
    if d.refundable is not None or d.penalties:
        vals["cancellation"] = {
            "refundable": d.refundable,
            "penalties": [{"from": p.from_, "to": p.to, "amount": p.amount} for p in d.penalties],
        }
    return vals


async def _details(provider: Provider, b: HotelBooking) -> wire.BookingDetails:
    try:
        body = await provider.booker.post(
            wire.HOTEL_BOOKING_DETAILS_PATH, wire.build_details_payload(b.provider_booking_id or ""),
            retries=0, operation="hotel_booking_details")
    except Exception:  # noqa: BLE001 — a failed check is "unknown", never a state change
        logger.warning("hotel_booking_details_failed")
        return wire.BookingDetails(None, False, error_code="UNAVAILABLE")
    return wire.parse_booking_details(body)


async def _sync_from_details(store: BookingStore, provider: Provider, b: HotelBooking) -> wire.BookingDetails:
    d = await _details(provider, b)
    vals = _apply_details(b, d)
    target = PROVIDER_TO_STATE.get(d.provider_status or "") if d.known else None
    if target and target != b.status and can_transition(b.status, target):
        extra = {}
        if target == CONFIRMED:
            extra["confirmed_at"] = _iso(_now())
        if target == CANCELLED:
            extra["cancelled_at"] = _iso(_now())
        extra["status_message"] = None
        if not await store.transition(b, target, f"details:{d.provider_status}", **vals, **extra):
            fresh = await store.get(b.booking_reference)
            if fresh:
                b.__dict__.update(fresh.__dict__)
    else:
        if not d.known and d.provider_status:
            logger.warning("hotel_booking_unknown_provider_status")
        await store.save(b, **vals)
    return d


async def poll_until_terminal(
    store: BookingStore, provider: Provider, b: HotelBooking, *,
    interval: float = POLL_INTERVAL, max_seconds: float = POLL_MAX,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> HotelBooking:
    """Documented lifecycle: poll every 5s, at most 180s, stop at terminal status."""
    waited = 0.0
    while True:
        await _sync_from_details(store, provider, b)
        if b.status not in (BOOKING_IN_PROGRESS, CONFIRMING):
            return b
        if waited + interval > max_seconds:
            await store.save(b, status_message="The hotel is still confirming. We'll update you shortly.")
            return b
        await sleep(interval)
        waited += interval


# -------------------------------------------------------------------- book --


async def _load_owned(store: BookingStore, reference: str, user_id, guest_token) -> HotelBooking:
    b = await store.get(reference)
    if b is None or not owns(b, user_id=user_id, guest_token=guest_token):
        raise HotelBookingNotFoundError()
    return b


async def book(
    *, settings: Settings, reference: str, mode: str, user_id: Optional[str],
    guest_token: Optional[str], idempotency_key: Optional[str], payment_verified: bool = False,
    gst_info: Optional[dict] = None,
) -> HotelBooking:
    if mode not in ("instant", "hold"):
        raise HotelBookingValidationError()
    store = BookingStore(settings)
    b = await _load_owned(store, reference, user_id, guest_token)

    # Idempotent replay: same key returns the existing attempt, never re-books.
    if b.status != DRAFT:
        if idempotency_key and b.idempotency_key == idempotency_key:
            return b
        raise HotelBookingDuplicateError()
    if mode == "instant":
        _payment_gate(settings, payment_verified=payment_verified)

    if not await store.transition(b, REVIEWED, "prebook_review_started",
                                  mode=mode, idempotency_key=idempotency_key):
        raise HotelBookingDuplicateError()

    provider = provider_factory(settings)
    try:
        fresh = await _fresh_review(settings, provider, b)
    except AppError:
        await store.transition(b, DRAFT, "prebook_review_failed")
        raise

    if fresh.total is None or round(fresh.total, 2) != round(b.total_amount, 2):
        await store.transition(b, DRAFT, "prebook_price_changed")
        raise HotelBookingPriceChangedError()
    if not fresh.booking_id:
        await store.transition(b, DRAFT, "prebook_no_booking_id")
        from app.services.hotel_search import HotelRoomUnavailableError
        raise HotelRoomUnavailableError()
    if mode == "hold" and not fresh.onhold_allowed:
        await store.transition(b, DRAFT, "hold_not_allowed")
        raise HotelHoldNotAllowedError()

    gst_required = fresh.gst_type in ("PASSTHROUGH", "RESELLER")
    amount = None if mode == "hold" else b.total_amount  # authoritative server amount
    try:
        payload = wire.build_book_payload(
            booking_id=fresh.booking_id, rooms=_rooms(b), travellers=_travellers(b),
            contact=_contact(b), amount=amount, gst_info=gst_info)
    except ValueError:
        await store.transition(b, DRAFT, "book_payload_invalid")
        raise HotelBookingValidationError() from None
    fails = wire.validate_book_payload(
        payload, _rooms(b), hold=mode == "hold", pan_required=fresh.pan_required,
        passport_required=fresh.passport_required, gst_required=gst_required)
    if fails:
        logger.info("hotel_book_preflight_failed", extra=log_extra(rules=fails))
        await store.transition(b, DRAFT, "book_preflight_failed")
        raise HotelBookingValidationError(details={"rules": fails})

    # Persist the provider handle BEFORE sending, so a timeout can still be resolved.
    if not await store.transition(b, BOOKING_IN_PROGRESS, f"book_sent:{mode}",
                                  provider_booking_id=fresh.booking_id, booked_at=_iso(_now()),
                                  hold_deadline=fresh.hold_deadline if mode == "hold" else None):
        raise HotelBookingDuplicateError()

    try:
        body = await provider.booker.post(wire.HOTEL_BOOK_PATH, payload, retries=0, operation="hotel_book")
        ack = wire.parse_ack(body, expected_booking_id=fresh.booking_id)
    except TripJackTimeoutError:
        # Outcome unknown: the booking may exist. Stay in progress; details resolves it.
        await store.save(b, guests=_scrubbed_guests(b),
                         status_message="The hotel is still confirming. We'll update you shortly.")
        return b
    except TripJackBadRequestError:
        ack = wire.ProviderAck(False, error_code="REJECTED")
    except Exception:  # noqa: BLE001
        await store.save(b, guests=_scrubbed_guests(b),
                         status_message="The hotel is still confirming. We'll update you shortly.")
        return b
    finally:
        pass

    if not ack.accepted:
        # No booking was created: never poll, never cancel.
        await store.transition(b, FAILED, f"book_rejected:{ack.error_code}", guests=_scrubbed_guests(b),
                               status_message="The hotel couldn't confirm this booking. No booking was made.")
        return b

    await store.save(b, guests=_scrubbed_guests(b), status_message=None)
    return b


# ------------------------------------------------------------------ status --


async def get_booking(*, settings: Settings, reference: str, user_id, guest_token, refresh: bool = True) -> HotelBooking:
    """Read + at most one provider check, throttled per state (never a tight loop)."""
    store = BookingStore(settings)
    b = await _load_owned(store, reference, user_id, guest_token)
    if refresh and b.provider_booking_id and _due(b):
        try:
            await _sync_from_details(store, provider_factory(settings), b)
        except AppError:
            pass
    if b.status in (BOOKING_IN_PROGRESS, CONFIRMING) and _age(b) > POLL_MAX and not b.status_message:
        await store.save(b, status_message="The hotel is still confirming. We'll update you shortly.")
    return b


def _age(b: HotelBooking) -> float:
    started = _dt(b.booked_at)
    return (_now() - started).total_seconds() if started else 0.0


def _due(b: HotelBooking) -> bool:
    last = _dt(b.last_checked_at)
    since = (_now() - last) if last else timedelta.max
    if b.status in (BOOKING_IN_PROGRESS, CONFIRMING):
        return since >= timedelta(seconds=POLL_INTERVAL)
    if b.status == ON_HOLD:
        return since >= HOLD_RECHECK
    if b.status == CANCELLATION_PENDING:
        return since >= CANCELLATION_PENDING_RECHECK
    return False


# ----------------------------------------------------------------- confirm --


async def confirm_hold(
    *, settings: Settings, reference: str, user_id, guest_token, payment_verified: bool = False,
) -> HotelBooking:
    store = BookingStore(settings)
    b = await _load_owned(store, reference, user_id, guest_token)
    return await confirm_loaded_hold(settings=settings, store=store, b=b, payment_verified=payment_verified)


async def confirm_loaded_hold(
    *, settings: Settings, store: BookingStore, b: HotelBooking, payment_verified: bool = False,
) -> HotelBooking:
    """Confirm an ON_HOLD booking already loaded (and authorised) by the caller."""
    if b.status in (CONFIRMING, CONFIRMED):
        raise HotelBookingDuplicateError()
    if b.status != ON_HOLD:
        raise HotelBookingStateError()
    deadline = _dt(b.hold_deadline)
    if deadline is None or _now() >= deadline:
        # Unknown deadline is never assumed to be open.
        raise HotelHoldExpiredError()
    _payment_gate(settings, payment_verified=payment_verified)
    if not await store.transition(b, CONFIRMING, "confirm_sent"):
        raise HotelBookingDuplicateError()

    provider = provider_factory(settings)
    try:
        body = await provider.booker.post(
            wire.HOTEL_CONFIRM_BOOK_PATH,
            wire.build_confirm_payload(b.provider_booking_id or "", b.total_amount),
            retries=0, operation="hotel_confirm_book")
        ack = wire.parse_ack(body, expected_booking_id=b.provider_booking_id)
    except TripJackTimeoutError:
        await store.save(b, status_message="The hotel is still confirming. We'll update you shortly.")
        return b
    except TripJackBadRequestError:
        ack = wire.ProviderAck(False, error_code="REJECTED")
    except Exception:  # noqa: BLE001
        await store.save(b, status_message="The hotel is still confirming. We'll update you shortly.")
        return b
    if not ack.accepted:
        await store.transition(b, ON_HOLD, f"confirm_rejected:{ack.error_code}",
                               status_message="We couldn't confirm the hold. Your room is still on hold.")
        return b
    await store.save(b, status_message=None)
    return b


# ------------------------------------------------------------------ cancel --


async def cancel(*, settings: Settings, reference: str, user_id, guest_token) -> HotelBooking:
    store = BookingStore(settings)
    b = await _load_owned(store, reference, user_id, guest_token)
    if b.status in (CANCELLATION_REQUESTED, CANCELLATION_PENDING, CANCELLED):
        return b  # idempotent
    if b.status not in (CONFIRMED, ON_HOLD) or not b.provider_booking_id:
        raise HotelBookingStateError()
    prior = b.status
    if not await store.transition(b, CANCELLATION_REQUESTED, "cancel_sent"):
        raise HotelBookingDuplicateError()

    provider = provider_factory(settings)
    try:
        body = await provider.booker.post_no_body(wire.cancel_path(b.provider_booking_id),
                                                 operation="hotel_cancel_booking")
        ack = wire.parse_ack(body, expected_booking_id=b.provider_booking_id)
    except TripJackBadRequestError:
        ack = wire.ProviderAck(False, error_code="REJECTED")
    except Exception:  # noqa: BLE001 — outcome unknown: treat as pending, check later
        await store.transition(b, CANCELLATION_PENDING, "cancel_outcome_unknown",
                               status_message="Your cancellation is being processed.")
        return b
    if not ack.accepted:
        await store.transition(b, prior, f"cancel_rejected:{ack.error_code}",
                               status_message="We couldn't cancel this booking. Please contact support.")
        return b

    # One status check; never a continuous poll of CANCELLATION_PENDING.
    d = await _sync_from_details(store, provider, b)
    if b.status == CANCELLATION_REQUESTED:
        await store.transition(b, CANCELLATION_PENDING, f"cancel_ack:{d.provider_status or 'unknown'}",
                               status_message="Your cancellation is being processed.")
    return b
