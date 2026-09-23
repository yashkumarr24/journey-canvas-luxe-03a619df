"""Hotel use cases: search -> detail -> select/review -> guest details.

Responsibilities (mirrors `flight_search` / `flight_booking`):
  * throttle abusive traffic before any provider quota is spent
  * call the TripJack hotel adapter
  * translate provider failures into safe, correctly-statused app errors whose
    codes the existing frontend already branches on
  * keep every amount server-side: the browser only ever echoes opaque handles

Scope stops at a DRAFT booking awaiting payment. No payment, no provider
booking, no voucher — those are marked PENDING in `hotel_wire.py`.
"""

from __future__ import annotations

from typing import Optional

from fastapi import Request, status

from app.core.auth import AuthContext
from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import get_logger, log_extra
from app.core.rate_limit import (
    client_identity,
    hotel_search_limiter,
    hotel_session_limiter,
)
from app.integrations.tripjack import hotel_directory
from app.integrations.tripjack import hotels as tripjack_hotels
from app.integrations.tripjack.client import get_hotel_client
from app.integrations.tripjack.config import build_hotel_config
from app.integrations.tripjack.exceptions import (
    TripJackAuthError,
    TripJackBadRequestError,
    TripJackNetworkError,
    TripJackNotConfiguredError,
    TripJackRateLimitError,
    TripJackTimeoutError,
    TripJackUpstreamError,
)
from app.schemas.flights import Money
from app.schemas.hotels import (
    FareBreakdownLine,
    HotelDetailRequest,
    HotelDetailResponse,
    HotelGuestDetailsRequest,
    HotelGuestDetailsResponse,
    HotelGuestRequirements,
    HotelOccupancy,
    HotelReviewResponse,
    HotelRoomOption,
    HotelSearchRequest,
    HotelSearchResponse,
    HotelSelectionRequest,
    HotelStay,
    HotelSummary,
)
from app.schemas.review import PriceChange
from app.services import hotel_sessions as sessions

logger = get_logger(__name__)


# -- user-safe application errors -------------------------------------------


class HotelProviderUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "PROVIDER_UNAVAILABLE"
    message = "Hotel search is temporarily unavailable. Please try again."


class HotelProviderTimeoutError(AppError):
    status_code = status.HTTP_504_GATEWAY_TIMEOUT
    code = "PROVIDER_TIMEOUT"
    message = "The hotel search is taking longer than expected. Please try again."


class HotelSearchRejectedError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "SEARCH_REJECTED"
    message = "We couldn't search with those details. Please review your search and try again."


class HotelSearchNotConfiguredError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "SEARCH_NOT_CONFIGURED"
    message = "Hotel search is being configured. Please check back shortly."


class HotelSearchExpiredError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "HOTEL_SEARCH_EXPIRED"
    message = "This search has expired. Please search again for current rates."


class HotelReviewExpiredError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "HOTEL_REVIEW_EXPIRED"
    message = "This room was only held for a short time. Please search again to pick a room."


class HotelRoomUnavailableError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "HOTEL_ROOM_UNAVAILABLE"
    message = "The hotel has just sold this room. Please choose another room or property."


class HotelNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "HOTEL_NOT_FOUND"
    message = "We couldn't find this hotel in your current search. Please search again."


class HotelPriceChangeNotAcceptedError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "HOTEL_PRICE_CHANGE_NOT_ACCEPTED"
    message = "The price for this room changed. Please confirm the updated total before continuing."


class HotelGuestDetailsIncompleteError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "GUEST_DETAILS_INCOMPLETE"
    message = "Some guest details are missing or do not match the rooms you selected."


def _provider(settings: Settings):
    config = build_config(settings)
    if not config.is_configured:
        logger.error("tripjack_hotels_not_configured")
        raise HotelSearchNotConfiguredError()
    if settings.is_production is False and config.targets_production:
        # Guard rail: a non-production deployment must never bill live inventory.
        logger.error("tripjack_hotel_production_url_in_non_production")
        raise HotelSearchNotConfiguredError()
    return get_client(config), config


def _map_provider_error(exc: Exception) -> AppError:
    if isinstance(exc, TripJackTimeoutError):
        return HotelProviderTimeoutError()
    if isinstance(exc, TripJackAuthError):
        # Credential / IP-whitelist problem. The customer must never see that.
        logger.error("tripjack_hotel_auth_failure")
        return HotelProviderUnavailableError()
    if isinstance(exc, TripJackBadRequestError):
        return HotelSearchRejectedError(exc.safe_message) if exc.safe_message else HotelSearchRejectedError()
    if isinstance(exc, TripJackNotConfiguredError):
        return HotelSearchNotConfiguredError()
    if isinstance(exc, (TripJackNetworkError, TripJackUpstreamError, TripJackRateLimitError)):
        return HotelProviderUnavailableError()
    return HotelProviderUnavailableError()


# ================================ search ===================================


async def search_hotels(
    *,
    request: Request,
    payload: HotelSearchRequest,
    auth: AuthContext,
    settings: Settings,
) -> HotelSearchResponse:
    hotel_search_limiter.check(client_identity(request, auth.user_id))
    client, config = _provider(settings)

    logger.info(
        "hotel_search_started",
        extra=log_extra(
            nights=payload.nights,
            rooms=len(payload.rooms),
            authenticated=auth.is_authenticated,
        ),
    )

    try:
        results, provider_search_id, currency = await tripjack_hotels.search_hotels(
            client, config, payload
        )
    except Exception as exc:  # narrowed inside _map_provider_error
        raise _map_provider_error(exc) from None

    session = sessions.create_search_session(
        request=payload,
        results=results,
        provider_search_id=provider_search_id,
        currency=currency,
        user_id=auth.user_id,
    )

    amenities = sorted({a for r in results for a in (r.amenities or [])})[:40]
    property_types = sorted({r.property_type for r in results if r.property_type})

    logger.info("hotel_search_completed", extra=log_extra(result_count=len(results)))

    return HotelSearchResponse(
        search_id=session.id,
        results=results,
        currency=currency,
        expires_at=sessions.expires_at_iso(session),
        nights=payload.nights,
        amenities=amenities or None,
        property_types=property_types or None,
    )


# ================================ detail ===================================


async def hotel_detail(
    *,
    request: Request,
    payload: HotelDetailRequest,
    auth: AuthContext,
    settings: Settings,
) -> HotelDetailResponse:
    hotel_session_limiter.check(client_identity(request, auth.user_id))

    session = sessions.get_search_session(payload.search_id)
    if session is None:
        raise HotelSearchExpiredError()

    summary = session.results.get(payload.hotel_id)
    if summary is None:
        raise HotelNotFoundError()

    client, config = _provider(settings)
    try:
        detail = await tripjack_hotels.hotel_detail(
            client,
            config,
            provider_hotel_id=payload.hotel_id,
            provider_search_id=session.provider_search_id,
            currency=session.currency,
            fallback=summary,
        )
    except ValueError:
        raise HotelNotFoundError() from None
    except Exception as exc:
        raise _map_provider_error(exc) from None

    if not detail.rooms:
        raise HotelRoomUnavailableError()

    return HotelDetailResponse(
        search_id=session.id,
        hotel=detail,
        check_in=session.request.check_in.isoformat(),
        check_out=session.request.check_out.isoformat(),
        nights=session.request.nights,
        currency=session.currency,
        expires_at=sessions.expires_at_iso(session),
    )


# ========================= select / review =================================


async def select_room(
    *,
    request: Request,
    payload: HotelSelectionRequest,
    auth: AuthContext,
    settings: Settings,
) -> HotelReviewResponse:
    hotel_session_limiter.check(client_identity(request, auth.user_id))

    session = sessions.get_search_session(payload.search_id)
    if session is None:
        raise HotelSearchExpiredError()

    summary = session.results.get(payload.hotel_id)
    if summary is None:
        raise HotelNotFoundError()

    client, config = _provider(settings)

    # Re-read the rooms so the rate we price is one the provider still sells,
    # not one the browser claims exists.
    try:
        detail = await tripjack_hotels.hotel_detail(
            client,
            config,
            provider_hotel_id=payload.hotel_id,
            provider_search_id=session.provider_search_id,
            currency=session.currency,
            fallback=summary,
        )
    except ValueError:
        raise HotelNotFoundError() from None
    except Exception as exc:
        raise _map_provider_error(exc) from None

    selected = next((room for room in detail.rooms if room.id == payload.rate_id), None)
    if selected is None:
        raise HotelRoomUnavailableError()

    previous_total = selected.total_price.amount

    # Final provider re-price. If it produces nothing usable we treat the rate
    # as gone rather than selling the older, cheaper quote.
    try:
        repriced = await tripjack_hotels.review_rate(
            client,
            config,
            provider_rate_id=payload.rate_id,
            provider_hotel_id=payload.hotel_id,
            currency=session.currency,
        )
    except Exception as exc:
        raise _map_provider_error(exc) from None

    room = repriced or selected

    stay = HotelStay(
        check_in=session.request.check_in.isoformat(),
        check_out=session.request.check_out.isoformat(),
        nights=session.request.nights,
        rooms=list(session.request.rooms),
    )

    hotel_summary = HotelSummary(
        id=detail.id,
        name=detail.name,
        star_rating=detail.star_rating,
        property_type=detail.property_type,
        location=detail.location,
        thumbnail_url=detail.thumbnail_url,
        images=detail.images,
    )

    review_session, guest_token = sessions.create_review_session(
        search_id=session.id,
        hotel=hotel_summary,
        room=room,
        stay=stay,
        currency=session.currency,
        provider_hotel_id=payload.hotel_id,
        provider_rate_id=room.id,
        user_id=auth.user_id,
        # Guests get a continuity token; signed-in users are identified by token.
        issue_guest_token=not auth.is_authenticated and payload.guest_token is None,
        previous_total=previous_total,
    )
    if auth.is_authenticated is False and payload.guest_token:
        # Resume an existing guest session in the same browser.
        review_session.guest_token = payload.guest_token
        guest_token = None

    logger.info(
        "hotel_room_selected",
        extra=log_extra(price_changed=previous_total != room.total_price.amount),
    )

    return _review_response(review_session, guest_token=guest_token)


def get_review(
    *,
    review_token: str,
    guest_token: Optional[str],
    auth: AuthContext,
) -> HotelReviewResponse:
    session = sessions.get_review_session(review_token)
    if session is None:
        raise HotelReviewExpiredError()
    if not sessions.owns(session, user_id=auth.user_id, guest_token=guest_token):
        # Same response as "not found": never confirm someone else's session.
        raise HotelReviewExpiredError()
    return _review_response(session, guest_token=None)


def _breakdown(room: HotelRoomOption, currency: str) -> list[FareBreakdownLine]:
    """Server-produced lines only. Never summed in the browser."""
    lines: list[FareBreakdownLine] = []
    if room.base_price:
        lines.append(FareBreakdownLine(label="Room charges", amount=room.base_price, kind="base"))
    if room.taxes:
        lines.append(FareBreakdownLine(label="Taxes", amount=room.taxes, kind="tax"))
    if room.fees_and_charges:
        lines.append(
            FareBreakdownLine(label="Fees and charges", amount=room.fees_and_charges, kind="fee")
        )
    if not lines:
        lines.append(FareBreakdownLine(label="Stay total", amount=room.total_price, kind="base"))
    return lines


def _requirements(session: sessions.ReviewSession) -> HotelGuestRequirements:
    country = (session.hotel.location.country if session.hotel.location else None) or ""
    international = bool(country) and country.strip().lower() not in {"india", "in"}
    return HotelGuestRequirements(
        # Provider-driven flags are only set when the provider actually says so.
        pan_required=False,
        passport_required=international,
        nationality_required=international,
        date_of_birth_required=False,
        all_guest_names_required=True,
        international=international,
    )


def _review_response(
    session: sessions.ReviewSession, *, guest_token: Optional[str]
) -> HotelReviewResponse:
    room = session.room
    total = room.total_price
    price_change: Optional[PriceChange] = None
    if session.previous_total is not None and session.previous_total != total.amount:
        difference = round(abs(total.amount - session.previous_total), 2)
        price_change = PriceChange(
            previous=Money(amount=session.previous_total, currency=total.currency),
            current=total,
            difference=Money(amount=difference, currency=total.currency),
            direction="increase" if total.amount > session.previous_total else "decrease",
        )

    return HotelReviewResponse(
        review_token=session.token,
        guest_token=guest_token,
        status="price_changed" if price_change else "reviewed",
        hotel=session.hotel,
        room=room,
        stay=session.stay,
        breakdown=_breakdown(room, session.currency),
        total_payable=total,
        price_change=price_change,
        requirements=_requirements(session),
        expires_at=sessions.expires_at_iso(session),
        valid_for_seconds=sessions.seconds_left(session),
    )


# ============================ guest details ================================


def submit_guests(
    *,
    request: Request,
    payload: HotelGuestDetailsRequest,
    auth: AuthContext,
    settings: Settings,
) -> HotelGuestDetailsResponse:
    hotel_session_limiter.check(client_identity(request, auth.user_id))

    session = sessions.get_review_session(payload.review_token)
    if session is None:
        raise HotelReviewExpiredError()
    if not sessions.owns(session, user_id=auth.user_id, guest_token=payload.guest_token):
        raise HotelReviewExpiredError()

    if session.previous_total is not None and session.previous_total != session.room.total_price.amount:
        if not payload.accept_price_change:
            raise HotelPriceChangeNotAcceptedError()

    _validate_guests(payload, session)

    if session.booking_reference is None:
        session.booking_reference = sessions.new_booking_reference()
    session.guest_count = len(payload.guests)
    session.contact_email = payload.contact.email

    logger.info(
        "hotel_guests_submitted",
        extra=log_extra(guest_count=len(payload.guests), authenticated=auth.is_authenticated),
    )

    return HotelGuestDetailsResponse(
        booking_reference=session.booking_reference,
        status="awaiting_payment",
        total_price=session.room.total_price,
        guest_count=len(payload.guests),
        contact_email=payload.contact.email,
        expires_at=sessions.expires_at_iso(session),
        next_step="payment",
    )


def _validate_guests(payload: HotelGuestDetailsRequest, session: sessions.ReviewSession) -> None:
    rooms: list[HotelOccupancy] = list(session.stay.rooms)
    if not rooms:
        rooms = [session.room.occupancy]

    expected_adults = [room.adults for room in rooms]
    expected_children = [len(room.child_ages) for room in rooms]

    leads = [guest for guest in payload.guests if guest.is_lead]
    if len(leads) != 1:
        raise HotelGuestDetailsIncompleteError()

    for index, guest in enumerate(payload.guests):
        if guest.room_index > len(rooms):
            raise HotelGuestDetailsIncompleteError()

    for room_index in range(1, len(rooms) + 1):
        occupants = [g for g in payload.guests if g.room_index == room_index]
        adults = sum(1 for g in occupants if g.type == "adult")
        children = sum(1 for g in occupants if g.type == "child")
        if adults != expected_adults[room_index - 1] or children != expected_children[room_index - 1]:
            raise HotelGuestDetailsIncompleteError()

    requirements = _requirements(session)
    lead = leads[0]
    if requirements.passport_required and not lead.passport_number:
        raise HotelGuestDetailsIncompleteError()
    if requirements.nationality_required and not lead.nationality:
        raise HotelGuestDetailsIncompleteError()
