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
from app.repositories.hotel_catalogue import HotelCatalogueRepository
from app.schemas.hotels import HotelImage, HotelLocation


def _merge_static(result, row):
    """Fill static gaps only. Live listing values (and all prices) win."""
    if not row:
        return result
    updates: dict = {}
    if result.star_rating is None and row.get("star_rating") is not None:
        updates["star_rating"] = float(row["star_rating"])
    if not result.property_type and row.get("property_type"):
        updates["property_type"] = row["property_type"]
    imgs = sorted(row.get("hotel_images") or [], key=lambda i: i.get("position", 0))
    if not result.images and imgs:
        updates["images"] = [HotelImage(url=i["url"], caption=i.get("caption")) for i in imgs[:15]]
        updates["thumbnail_url"] = result.thumbnail_url or imgs[0]["url"]
    if not result.amenities and row.get("hotel_amenities"):
        updates["amenities"] = [a["name"] for a in row["hotel_amenities"]][:40]
    loc = result.location or HotelLocation()
    loc_updates = {k: row.get(s) for k, s in (("address", "address"), ("city", "city"), ("country", "country"),
                   ("latitude", "latitude"), ("longitude", "longitude")) if getattr(loc, k) is None and row.get(s) is not None}
    if loc_updates:
        updates["location"] = loc.model_copy(update=loc_updates)
    return result.model_copy(update=updates) if updates else result

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


class HotelDestinationUnsupportedError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = "SEARCH_REJECTED"
    message = "We don't cover hotels in that destination yet. Please try a nearby city."


def _provider(settings: Settings):
    """Hotel API v3 client. Hotels run on their OWN host, not the flight host."""
    config = build_hotel_config(settings)
    if not config.is_configured:
        logger.error("tripjack_hotels_not_configured")
        raise HotelSearchNotConfiguredError()
    if settings.is_production is False and config.targets_production:
        # Guard rail: a non-production deployment must never bill live inventory.
        logger.error("tripjack_hotel_production_url_in_non_production")
        raise HotelSearchNotConfiguredError()
    return get_hotel_client(config), config


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

    # Hotel API v3 searches by hotel ids (hids); cityCode no longer exists. We
    # resolve the destination server-side and never invent an id.
    # Primary: local TripJack static catalogue (migration 0012). Fallback: the
    # legacy directory file. Static data only picks ids; price/availability
    # always come from the live v3 listing below.
    catalogue = HotelCatalogueRepository(settings)
    hids: list[str] = []
    if catalogue.enabled:
        try:
            hids = await catalogue.resolve_hids(payload.destination)
        except Exception:
            logger.warning("hotel_catalogue_lookup_failed")
    if not hids:
        entry = hotel_directory.resolve(
            payload.destination, directory_path=settings.tripjack_hotel_directory_path
        )
        hids = list(entry.hids) if entry else []
    if not hids:
        logger.warning("hotel_destination_unresolved")
        raise HotelDestinationUnsupportedError()
    static: dict = {}
    if catalogue.enabled:
        try:
            static = await catalogue.static_for(hids)
        except Exception:
            logger.warning("hotel_catalogue_static_failed")
    names_token = tripjack_hotels.STATIC_NAMES.set(
        {k: v["name"] for k, v in static.items() if v.get("name")}
    )

    logger.info(
        "hotel_search_started",
        extra=log_extra(
            nights=payload.nights,
            rooms=len(payload.rooms),
            hotel_ids=len(hids),
            authenticated=auth.is_authenticated,
        ),
    )

    try:
        results, provider_search_id, currency = await tripjack_hotels.search_hotels(
            client, config, payload, hids=hids
        )
    except Exception as exc:  # narrowed inside _map_provider_error
        raise _map_provider_error(exc) from None
    finally:
        tripjack_hotels.STATIC_NAMES.reset(names_token)
    results = [_merge_static(r, static.get(r.id)) for r in results]

    session = await sessions.create_search_session(
        settings=settings,
        destination=payload.destination,
        check_in=payload.check_in.isoformat(),
        check_out=payload.check_out.isoformat(),
        nights=payload.nights,
        rooms=list(payload.rooms),
        nationality=payload.nationality,
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

    session = await sessions.get_search_session(
        settings=settings, search_id=payload.search_id
    )
    if session is None:
        raise HotelSearchExpiredError()

    summary = session.results.get(payload.hotel_id)
    if summary is None:
        raise HotelNotFoundError()

    detail = await _priced_hotel(
        settings=settings,
        session=session,
        provider_hotel_id=payload.hotel_id,
        fallback=summary,
    )

    return HotelDetailResponse(
        search_id=session.id,
        hotel=detail,
        check_in=session.check_in,
        check_out=session.check_out,
        nights=session.nights,
        currency=session.currency,
        expires_at=sessions.expires_at_iso(session),
    )


async def _priced_hotel(
    *,
    settings: Settings,
    session: sessions.SearchSession,
    provider_hotel_id: str,
    fallback,
):
    """/hms/v3/hotel/pricing for one hotel inside this searchId."""
    if not session.provider_search_id:
        # v3 pricing is only meaningful inside a live searchId.
        raise HotelSearchExpiredError()

    client, config = _provider(settings)
    try:
        detail = await tripjack_hotels.hotel_pricing(
            client,
            config,
            search_id=session.provider_search_id,
            provider_hotel_id=provider_hotel_id,
            currency=session.currency,
            fallback=fallback,
        )
    except ValueError:
        raise HotelNotFoundError() from None
    except Exception as exc:
        raise _map_provider_error(exc) from None

    if not detail.rooms:
        raise HotelRoomUnavailableError()
    return detail


# ========================= select / review =================================


async def select_room(
    *,
    request: Request,
    payload: HotelSelectionRequest,
    auth: AuthContext,
    settings: Settings,
) -> HotelReviewResponse:
    hotel_session_limiter.check(client_identity(request, auth.user_id))

    session = await sessions.get_search_session(
        settings=settings, search_id=payload.search_id
    )
    if session is None:
        raise HotelSearchExpiredError()

    summary = session.results.get(payload.hotel_id)
    if summary is None:
        raise HotelNotFoundError()

    # Re-price so the option we sell is one the provider still sells, not one
    # the browser claims exists.
    detail = await _priced_hotel(
        settings=settings,
        session=session,
        provider_hotel_id=payload.hotel_id,
        fallback=summary,
    )

    selected = next((room for room in detail.rooms if room.id == payload.rate_id), None)
    if selected is None:
        raise HotelRoomUnavailableError()

    previous_total = selected.total_price.amount

    # Final v3 review. If it produces nothing usable we treat the rate as gone
    # rather than selling the older, cheaper quote.
    client, config = _provider(settings)
    try:
        repriced, review_hash = await tripjack_hotels.review_option(
            client,
            config,
            search_id=session.provider_search_id or "",
            provider_hotel_id=payload.hotel_id,
            option_id=payload.rate_id,
            currency=session.currency,
        )
    except Exception as exc:
        raise _map_provider_error(exc) from None

    room = repriced or selected

    stay = HotelStay(
        check_in=session.check_in,
        check_out=session.check_out,
        nights=session.nights,
        rooms=list(session.rooms),
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

    requirements = _requirements_for(room, hotel_summary)

    review_session, guest_token = await sessions.create_review_session(
        settings=settings,
        search=session,
        hotel=hotel_summary,
        room=room,
        stay=stay,
        currency=session.currency,
        provider_hotel_id=payload.hotel_id,
        provider_option_id=room.id,
        provider_review_hash=review_hash,
        requirements=requirements.model_dump(by_alias=True),
        user_id=auth.user_id,
        # Resume an existing guest session in the same browser when offered.
        guest_token=payload.guest_token if not auth.is_authenticated else None,
        issue_guest_token=not auth.is_authenticated and payload.guest_token is None,
        previous_total=previous_total,
    )

    logger.info(
        "hotel_room_selected",
        extra=log_extra(
            price_changed=previous_total != room.total_price.amount,
            rate_plan=room.rate_plan_type,
            option_type=room.option_type,
            review_hash_present=bool(review_hash),
        ),
    )

    return _review_response(review_session, guest_token=guest_token)


async def get_review(
    *,
    review_token: str,
    guest_token: Optional[str],
    auth: AuthContext,
    settings: Settings,
) -> HotelReviewResponse:
    session = await sessions.get_review_session(
        settings=settings, review_token=review_token
    )
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
    # v3 management fee + its tax are payable, so the customer sees them itemised.
    if room.management_fee:
        lines.append(
            FareBreakdownLine(label="Service fee", amount=room.management_fee, kind="fee")
        )
    if room.management_fee_tax:
        lines.append(
            FareBreakdownLine(label="Service fee tax", amount=room.management_fee_tax, kind="tax")
        )
    if not lines:
        lines.append(FareBreakdownLine(label="Stay total", amount=room.total_price, kind="base"))
    return lines


def _requirements_for(
    room: HotelRoomOption, hotel: HotelSummary
) -> HotelGuestRequirements:
    """Driven by the provider's flags on THIS rate plan, never inferred.

    A rate plan tagged PAN_NOT_REQUIRED sets pan_required False; otherwise we
    only ask for PAN/passport when TripJack says the rate needs it.
    """
    country = (hotel.location.country if hotel.location else None) or ""
    international = bool(country) and country.strip().lower() not in {"india", "in"}
    passport_required = bool(room.passport_required)
    return HotelGuestRequirements(
        pan_required=bool(room.pan_required),
        passport_required=passport_required,
        nationality_required=passport_required or international,
        date_of_birth_required=False,
        all_guest_names_required=True,
        international=international,
    )


def _requirements(session: sessions.ReviewSession) -> HotelGuestRequirements:
    """Requirements captured at review time, replayed exactly."""
    try:
        return HotelGuestRequirements.model_validate(session.requirements or {})
    except Exception:  # noqa: BLE001
        return _requirements_for(session.room, session.hotel)


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


async def submit_guests(
    *,
    request: Request,
    payload: HotelGuestDetailsRequest,
    auth: AuthContext,
    settings: Settings,
) -> HotelGuestDetailsResponse:
    hotel_session_limiter.check(client_identity(request, auth.user_id))

    session = await sessions.get_review_session(
        settings=settings, review_token=payload.review_token
    )
    if session is None:
        raise HotelReviewExpiredError()
    if not sessions.owns(session, user_id=auth.user_id, guest_token=payload.guest_token):
        raise HotelReviewExpiredError()

    if session.previous_total is not None and session.previous_total != session.room.total_price.amount:
        if not payload.accept_price_change:
            raise HotelPriceChangeNotAcceptedError()

    _validate_guests(payload, session)

    booking_reference = session.booking_reference or sessions.new_booking_reference()
    await sessions.record_guest_details(
        settings=settings,
        session=session,
        booking_reference=booking_reference,
        guest_count=len(payload.guests),
        contact_email=payload.contact.email,
    )

    logger.info(
        "hotel_guests_submitted",
        extra=log_extra(guest_count=len(payload.guests), authenticated=auth.is_authenticated),
    )

    return HotelGuestDetailsResponse(
        booking_reference=booking_reference,
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

    for guest in payload.guests:
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
    if requirements.pan_required and not getattr(lead, "pan_number", None):
        raise HotelGuestDetailsIncompleteError()
