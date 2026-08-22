"""Flight selection, fare review and traveller capture (PHASE 7).

Flow owned by this module:

    select   -> resolve fare server-side, re-price with TripJack, open session
    review   -> replay the stored session (no provider call, no re-price)
    submit   -> validate travellers against the session, create a DRAFT booking

Hard rules enforced here, not in the browser:

  * The payable amount is read from `search_result_refs` / the review session.
    A client-sent amount is impossible: `extra="forbid"` rejects the field.
  * Passenger counts come from the original search row, not from the payload.
  * A session belongs to one identity (verified user id, or a hashed
    server-issued guest token). Anyone else gets 404 — never 403, which would
    confirm the token exists.
  * An expired or non-sellable fare cannot progress, and a price increase
    cannot progress without explicit consent.
  * Nothing in this module confirms a booking or holds money. The draft stops
    at `awaiting_payment`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import Request, status

from app.core.auth import AuthContext
from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import get_logger, log_extra
from app.core.rate_limit import SlidingWindowLimiter, client_identity
from app.integrations.tripjack import review as tripjack_review
from app.integrations.tripjack.client import get_client
from app.integrations.tripjack.config import build_config
from app.integrations.tripjack.exceptions import (
    TripJackAuthError,
    TripJackBadRequestError,
    TripJackNetworkError,
    TripJackNotConfiguredError,
    TripJackRateLimitError,
    TripJackTimeoutError,
    TripJackUpstreamError,
)
from app.repositories.bookings import BookingRepository
from app.repositories.reviews import (
    ReviewRepository,
    ReviewSession,
    hash_token,
    new_token,
)
from app.repositories.supabase_rest import SupabaseUnavailableError
from app.schemas.flights import FlightItinerary, Money, PassengerCounts
from app.schemas.review import (
    ContactInput,
    FlightReviewResponse,
    FlightSelectionRequest,
    PriceChange,
    ReviewFare,
    TravellerDetailsRequest,
    TravellerDetailsResponse,
    TravellerInput,
    TravellerRequirements,
)

logger = get_logger(__name__)

# Review hits provider inventory, so it is throttled harder than search.
review_limiter = SlidingWindowLimiter(limit=8, window_seconds=60.0)
traveller_limiter = SlidingWindowLimiter(limit=10, window_seconds=60.0)

SELECT_SCOPE = "flight_select"
TRAVELLER_SCOPE = "flight_travellers"


# -- user-safe errors --------------------------------------------------------


class ReviewUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "REVIEW_UNAVAILABLE"
    message = "We couldn't confirm this fare just now. Please try again in a moment."


class ReviewTimeoutError(AppError):
    status_code = status.HTTP_504_GATEWAY_TIMEOUT
    code = "REVIEW_TIMEOUT"
    message = "Confirming this fare is taking longer than expected. Please try again."


class FareUnavailableError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "FARE_UNAVAILABLE"
    message = "This fare is no longer available. Please search again to see current options."


class FareExpiredError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "FARE_EXPIRED"
    message = "This fare has expired. Please search again to see current prices."


class ReviewNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "REVIEW_NOT_FOUND"
    message = "We couldn't find this booking session. Please start a new search."


class PriceChangedError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "PRICE_CHANGED"
    message = "The price of this fare changed. Please review the new total before continuing."


class TravellerMismatchError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "TRAVELLER_MISMATCH"
    message = "Traveller details don't match the passengers in this search."


class TravellerDetailsIncompleteError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "TRAVELLER_DETAILS_INCOMPLETE"
    message = "Some required traveller details are missing for this flight."


# -- select ------------------------------------------------------------------


async def select_flight(
    *,
    request: Request,
    payload: FlightSelectionRequest,
    auth: AuthContext,
    settings: Settings,
) -> FlightReviewResponse:
    review_limiter.check(client_identity(request, auth.user_id))

    reviews = ReviewRepository(settings)
    if not reviews.enabled:
        logger.error("review_requires_database")
        raise ReviewUnavailableError()

    # Idempotency: a double-submit must not burn a second provider pre-book.
    replay_token: Optional[str] = None
    if payload.idempotency_key:
        replay_token = await _claim(
            reviews,
            scope=SELECT_SCOPE,
            key=payload.idempotency_key,
            subject=payload.search_id,
        )
        if replay_token:
            existing = await reviews.get_session(replay_token)
            if existing and _owns(existing, auth, payload.guest_token) and not existing.expired:
                return _to_response(existing, guest_token=None)

    search = await reviews.get_search(payload.search_id)
    if not search:
        raise ReviewNotFoundError()
    # A signed-in user may not select against another account's search.
    if search.user_id and search.user_id != auth.user_id:
        raise ReviewNotFoundError()

    # THE price lookup. `fare_id` only identifies a row; it never carries money.
    fare_ref = await reviews.get_fare_ref(payload.search_id, payload.fare_id)
    if not fare_ref:
        raise FareUnavailableError()
    if fare_ref.expired:
        raise FareExpiredError()

    outcome = await _review_with_provider(fare_ref.provider_ref, fare_ref.currency, settings)
    if not outcome.sellable:
        raise FareUnavailableError()

    guest_token = None if auth.is_authenticated else new_token()
    review_token = new_token()

    itinerary_snapshot = {
        "itineraries": [i.model_dump(mode="json", by_alias=True, exclude_none=True) for i in outcome.itineraries],
        "fare": outcome.fare.model_dump(mode="json", by_alias=True, exclude_none=True),
        "alerts": outcome.alerts,
    }

    status_value = "price_changed" if outcome.total != fare_ref.total_amount else "reviewed"

    session = await reviews.create_session(
        {
            "review_token": review_token,
            "guest_token_hash": hash_token(guest_token) if guest_token else None,
            # Ownership from the verified token only.
            "user_id": auth.user_id,
            "flight_search_id": search.search_id,
            "search_result_ref_id": fare_ref.id,
            "provider_price_ref": fare_ref.provider_ref,
            "provider_booking_ref": outcome.provider_booking_ref,
            "searched_amount": str(fare_ref.total_amount),
            "total_amount": str(outcome.total),
            "base_amount": str(outcome.base) if outcome.base is not None else None,
            "tax_amount": str(outcome.taxes) if outcome.taxes is not None else None,
            "currency": fare_ref.currency,
            "adults": search.adults,
            "children": search.children,
            "infants": search.infants,
            "status": status_value,
            "itinerary": itinerary_snapshot,
            "requirements": outcome.requirements.model_dump(mode="json", by_alias=True),
            "expires_at": outcome.expires_at.isoformat(),
        }
    )
    if not session:
        raise ReviewUnavailableError()

    if payload.idempotency_key:
        await _complete(reviews, scope=SELECT_SCOPE, key=payload.idempotency_key, result_ref=review_token)

    logger.info(
        "flight_fare_reviewed",
        extra=log_extra(
            status=status_value,
            price_changed=status_value == "price_changed",
            authenticated=auth.is_authenticated,
        ),
    )
    return _to_response(session, guest_token=guest_token)


async def get_review(
    *,
    review_token: str,
    guest_token: Optional[str],
    auth: AuthContext,
    settings: Settings,
) -> FlightReviewResponse:
    """Replay a stored session. No provider call, so no re-price and no cost."""
    reviews = ReviewRepository(settings)
    if not reviews.enabled:
        raise ReviewUnavailableError()

    session = await _load_session(reviews, review_token, guest_token, auth)
    if session.expired:
        raise FareExpiredError()
    return _to_response(session, guest_token=None)


# -- traveller details -------------------------------------------------------


async def submit_travellers(
    *,
    request: Request,
    payload: TravellerDetailsRequest,
    auth: AuthContext,
    settings: Settings,
) -> TravellerDetailsResponse:
    traveller_limiter.check(client_identity(request, auth.user_id))

    reviews = ReviewRepository(settings)
    bookings = BookingRepository(settings)
    if not (reviews.enabled and bookings.enabled):
        raise ReviewUnavailableError()

    session = await _load_session(reviews, payload.review_token, payload.guest_token, auth)
    if session.expired:
        await reviews.update_session(session.id, {"status": "expired"})
        raise FareExpiredError()

    # A price increase needs explicit consent, and consent is only meaningful
    # for the amount already stored server-side.
    if session.status == "price_changed" and not payload.accept_price_change:
        raise PriceChangedError()

    requirements = TravellerRequirements.model_validate(session.requirements or {})
    _validate_travellers(payload.travellers, session, requirements)

    traveller_ids = await _resolve_travellers(bookings, payload.travellers, auth)

    booking = await bookings.create_draft(
        user_id=auth.user_id,
        contact_email=payload.contact.email,
        contact_phone=payload.contact.phone,
        # Server-resolved. The request could not have influenced this value.
        total_amount=session.total_amount,
        currency=session.currency,
    )
    if not booking:
        raise ReviewUnavailableError()

    await bookings.replace_items(
        booking.id,
        provider_reference=session.provider_booking_ref,
        details=session.itinerary,
        amount=session.total_amount,
        currency=session.currency,
    )
    await bookings.replace_travellers(
        booking.id,
        [
            {
                "booking_id": booking.id,
                "traveller_id": traveller_id,
                "passenger_type": traveller.type,
                "is_lead": index == 0,
            }
            for index, (traveller, traveller_id) in enumerate(zip(payload.travellers, traveller_ids))
        ],
    )

    await reviews.update_session(
        session.id,
        {
            "status": "travellers_submitted",
            "booking_id": booking.id,
            "price_accepted_at": datetime.now(timezone.utc).isoformat()
            if session.status == "price_changed"
            else None,
        },
    )

    await bookings.record_event(
        booking.id,
        "traveller_details_submitted",
        message="Traveller and contact details captured; awaiting payment.",
        # Counts and amounts only — no names, passports or contact details.
        metadata={
            "traveller_count": len(payload.travellers),
            "amount": str(session.total_amount),
            "currency": session.currency,
        },
    )

    if payload.idempotency_key:
        await _complete(
            reviews,
            scope=TRAVELLER_SCOPE,
            key=payload.idempotency_key,
            result_ref=booking.booking_reference,
        )

    logger.info(
        "flight_travellers_submitted",
        extra=log_extra(traveller_count=len(payload.travellers), authenticated=auth.is_authenticated),
    )

    return TravellerDetailsResponse(
        booking_reference=booking.booking_reference,
        status="awaiting_payment",
        total_price=Money(amount=float(session.total_amount), currency=session.currency),
        passengers=PassengerCounts(
            adults=session.adults, children=session.children, infants=session.infants
        ),
        traveller_count=len(payload.travellers),
        contact_email=payload.contact.email,
        expires_at=session.expires_at.isoformat() if session.expires_at else "",
    )


# -- internals ---------------------------------------------------------------


async def _review_with_provider(price_ref: str, currency: str, settings: Settings):
    config = build_config(settings)
    if not config.is_configured:
        logger.error("tripjack_not_configured")
        raise ReviewUnavailableError()
    if settings.is_production is False and config.targets_production:
        logger.error("tripjack_production_url_in_non_production")
        raise ReviewUnavailableError()

    client = get_client(config)
    try:
        return await tripjack_review.review_fare(client, price_id=price_ref, currency=currency)
    except TripJackTimeoutError:
        raise ReviewTimeoutError() from None
    except TripJackBadRequestError:
        # The provider rejecting a priceId means the fare is gone, not that the
        # customer did anything wrong.
        raise FareUnavailableError() from None
    except TripJackAuthError:
        logger.error("tripjack_auth_failure")
        raise ReviewUnavailableError() from None
    except (TripJackNetworkError, TripJackUpstreamError, TripJackRateLimitError):
        raise ReviewUnavailableError() from None
    except TripJackNotConfiguredError:
        raise ReviewUnavailableError() from None


def _owns(session: ReviewSession, auth: AuthContext, guest_token: Optional[str]) -> bool:
    if session.user_id:
        return auth.user_id == session.user_id
    if session.guest_token_hash:
        return bool(guest_token) and hash_token(guest_token or "") == session.guest_token_hash
    return False


async def _load_session(
    reviews: ReviewRepository,
    review_token: str,
    guest_token: Optional[str],
    auth: AuthContext,
) -> ReviewSession:
    try:
        session = await reviews.get_session(review_token)
    except SupabaseUnavailableError:
        raise ReviewUnavailableError() from None

    # Unknown token and wrong owner return the SAME error, so the response
    # cannot be used to probe which tokens exist.
    if not session or not _owns(session, auth, guest_token):
        raise ReviewNotFoundError()
    return session


async def _claim(reviews: ReviewRepository, *, scope: str, key: str, subject: str) -> Optional[str]:
    try:
        return await reviews.claim_idempotency(scope=scope, key=key, subject=subject)
    except SupabaseUnavailableError:
        # Idempotency is an optimisation; losing it must not block the customer.
        return None


async def _complete(reviews: ReviewRepository, *, scope: str, key: str, result_ref: str) -> None:
    try:
        await reviews.complete_idempotency(scope=scope, key=key, result_ref=result_ref)
    except SupabaseUnavailableError:
        logger.warning("idempotency_not_recorded", extra=log_extra(scope=scope))


def _validate_travellers(
    travellers: list[TravellerInput],
    session: ReviewSession,
    requirements: TravellerRequirements,
) -> None:
    counts = {"adult": 0, "child": 0, "infant": 0}
    for traveller in travellers:
        counts[traveller.type] += 1

    # Counts come from the SEARCH row, so a client cannot add passengers to a
    # fare that was priced for fewer.
    if (
        counts["adult"] != session.adults
        or counts["child"] != session.children
        or counts["infant"] != session.infants
    ):
        raise TravellerMismatchError()

    for traveller in travellers:
        if requirements.date_of_birth_required or traveller.type in ("child", "infant"):
            if not traveller.date_of_birth:
                raise TravellerDetailsIncompleteError()
        if requirements.passport_required:
            if not (
                traveller.passport_number
                and traveller.passport_issuing_country
                and (traveller.passport_expiry or not requirements.passport_expiry_required)
            ):
                raise TravellerDetailsIncompleteError()
        if requirements.nationality_required and not traveller.nationality:
            raise TravellerDetailsIncompleteError()


async def _resolve_travellers(
    bookings: BookingRepository,
    travellers: list[TravellerInput],
    auth: AuthContext,
) -> list[Optional[str]]:
    """Return the traveller row id for each passenger (None for guests).

    A `savedTravellerId` is re-checked against the verified user id, so a
    request naming someone else's traveller resolves to nothing and the
    submitted details are used instead of another customer's data.
    """
    resolved: list[Optional[str]] = []
    for traveller in travellers:
        traveller_id: Optional[str] = None

        if auth.is_authenticated:
            values = _traveller_row(traveller, auth.user_id)
            try:
                if traveller.saved_traveller_id:
                    owned = await bookings.get_owned_traveller(
                        traveller.saved_traveller_id, auth.user_id or ""
                    )
                    if owned:
                        traveller_id = str(owned["id"])
                        await bookings.update_traveller(traveller_id, auth.user_id or "", values)
                if traveller_id is None and traveller.save_to_profile:
                    traveller_id = await bookings.create_traveller(values)
            except SupabaseUnavailableError:
                # Saving to the profile is a convenience; never fail the booking.
                logger.warning("traveller_profile_not_saved")

        resolved.append(traveller_id)
    return resolved


def _traveller_row(traveller: TravellerInput, user_id: Optional[str]) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "title": traveller.title,
        "first_name": traveller.first_name,
        "last_name": traveller.last_name,
        "date_of_birth": traveller.date_of_birth.isoformat() if traveller.date_of_birth else None,
        "gender": traveller.gender,
        "nationality": traveller.nationality,
        "passport_number": traveller.passport_number,
        "passport_expiry": traveller.passport_expiry.isoformat() if traveller.passport_expiry else None,
        "passport_issuing_country": traveller.passport_issuing_country,
    }


def _to_response(session: ReviewSession, *, guest_token: Optional[str]) -> FlightReviewResponse:
    snapshot = session.itinerary or {}
    itineraries = [
        FlightItinerary.model_validate(raw)
        for raw in snapshot.get("itineraries", [])
        if isinstance(raw, dict)
    ]
    fare = ReviewFare.model_validate(
        snapshot.get("fare")
        or {"totalPrice": {"amount": float(session.total_amount), "currency": session.currency}}
    )

    price_change = None
    if session.total_amount != session.searched_amount:
        difference = abs(session.total_amount - session.searched_amount)
        price_change = PriceChange(
            previous=Money(amount=float(session.searched_amount), currency=session.currency),
            current=Money(amount=float(session.total_amount), currency=session.currency),
            difference=Money(amount=float(difference), currency=session.currency),
            direction="increase" if session.total_amount > session.searched_amount else "decrease",
        )

    expires_at = session.expires_at or datetime.now(timezone.utc)
    remaining = int((expires_at - datetime.now(timezone.utc)).total_seconds())

    return FlightReviewResponse(
        review_token=session.review_token,
        guest_token=guest_token,
        status="price_changed" if price_change and price_change.direction == "increase" else "reviewed",
        itineraries=itineraries,
        fare=fare,
        price_change=price_change,
        passengers=PassengerCounts(
            adults=session.adults, children=session.children, infants=session.infants
        ),
        requirements=TravellerRequirements.model_validate(session.requirements or {}),
        expires_at=expires_at.isoformat(),
        valid_for_seconds=max(remaining, 0),
    )


_ = Decimal  # money stays Decimal end-to-end; imported for type clarity
