"""TripJack hotel adapter: our request -> TripJack -> our normalized response.

Route handlers and services never touch TripJack HTTP or TripJack field names.
They call `search_hotels()`, `hotel_detail()` and `review_rate()` here and get
fully normalized domain objects back.

Normalization rules (identical to the flight adapter):
  * A field the provider omits stays `None` — nothing is invented, no price is
    defaulted, no image or rating is substituted.
  * A single malformed hotel/room is skipped, not allowed to fail the request.
  * Anything we cannot price is dropped: a room without a total cannot be sold.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger, log_extra
from app.integrations.tripjack.client import TripJackClient
from app.integrations.tripjack.config import TripJackConfig
from app.integrations.tripjack.hotel_wire import (
    DEFAULT_CURRENCY,
    HOTEL_DETAIL_PATH,
    HOTEL_RATE_REVIEW_PATH,
    HOTEL_SEARCH_PATH,
    build_detail_payload,
    build_rate_review_payload,
    build_search_payload,
    refundable_flag,
)
from app.integrations.tripjack.schemas import (
    get_int,
    get_list,
    get_map,
    get_number,
    get_str,
)
from app.schemas.flights import Money
from app.schemas.hotels import (
    HotelCancellationPolicy,
    HotelCancellationRule,
    HotelDetail,
    HotelImage,
    HotelLocation,
    HotelOccupancy,
    HotelRateSummary,
    HotelResult,
    HotelRoomOption,
    HotelSearchRequest,
)

logger = get_logger(__name__)

MAX_RESULTS = 120
MAX_ROOMS_PER_HOTEL = 40
MAX_IMAGES = 12


# ============================== search =====================================


async def search_hotels(
    client: TripJackClient,
    config: TripJackConfig,
    request: HotelSearchRequest,
) -> tuple[list[HotelResult], str | None, str]:
    """Returns (results, provider_search_id, currency)."""
    payload = build_search_payload(
        destination=request.destination,
        check_in=request.check_in.isoformat(),
        check_out=request.check_out.isoformat(),
        rooms=[{"adults": r.adults, "childAges": r.child_ages} for r in request.rooms],
        nationality=request.nationality,
        currency=request.currency,
    )

    # Search is a pure read, so a small retry budget is safe.
    body = await client.post(
        HOTEL_SEARCH_PATH,
        payload,
        retries=config.search_retries,
        operation="hotel_search",
    )

    currency = request.currency or DEFAULT_CURRENCY
    results = normalize_search_response(body, currency=currency)
    provider_search_id = get_str(body, "searchId", "id") or get_str(
        get_map(body, "searchResult"), "searchId", "id"
    )

    logger.info("tripjack_hotel_search_normalized", extra=log_extra(result_count=len(results)))
    return results, provider_search_id, currency


def normalize_search_response(body: dict[str, Any], *, currency: str) -> list[HotelResult]:
    raw_hotels = _raw_hotel_list(body)

    results: list[HotelResult] = []
    for raw in raw_hotels:
        hotel = _hotel_result(raw, currency)
        if hotel is not None:
            results.append(hotel)
        if len(results) >= MAX_RESULTS:
            break
    return results


def _raw_hotel_list(body: dict[str, Any]) -> list[Any]:
    search_result = get_map(body, "searchResult")
    for source in (search_result, body):
        for key in ("his", "hotels", "hotelList", "results"):
            items = get_list(source, key)
            if items:
                return items
    return []


def _hotel_result(raw: Any, currency: str) -> HotelResult | None:
    if not isinstance(raw, dict):
        return None

    provider_id = get_str(raw, "id", "hotelId", "code")
    name = get_str(raw, "name", "hotelName")
    if not (provider_id and name):
        # Without an id we could never re-price it; without a name we could
        # not honestly render it.
        return None

    images = _images(raw)
    return HotelResult(
        id=provider_id,
        name=name,
        star_rating=get_number(raw, "rt", "starRating", "rating"),
        property_type=get_str(raw, "pt", "propertyType", "category"),
        location=_location(raw),
        thumbnail_url=images[0].url if images else None,
        images=images or None,
        amenities=_string_list(raw, "fac", "facilities", "amenities"),
        review_score=get_number(raw, "reviewScore", "tripAdvisorRating"),
        review_count=get_int(raw, "reviewCount", "numberOfReviews"),
        rate=_rate_summary(raw, currency),
    )


def _location(raw: dict[str, Any]) -> HotelLocation | None:
    address_block = get_map(raw, "ad", "address")
    city_block = get_map(address_block, "city") or get_map(raw, "city")
    country_block = get_map(address_block, "country") or get_map(raw, "country")

    location = HotelLocation(
        address=get_str(address_block, "adr", "address", "line1") or get_str(raw, "address"),
        area=get_str(address_block, "area", "locality") or get_str(raw, "area"),
        city=get_str(city_block, "name") or get_str(address_block, "city") or get_str(raw, "cityName"),
        country=get_str(country_block, "name") or get_str(address_block, "country"),
        landmark=get_str(raw, "landmark", "nearBy"),
        latitude=get_number(get_map(raw, "gl", "geolocation", "geoLocation"), "lt", "lat", "latitude"),
        longitude=get_number(get_map(raw, "gl", "geolocation", "geoLocation"), "ln", "lng", "longitude"),
    )
    if not any(location.model_dump(exclude_none=True).values()):
        return None
    return location


def _images(raw: dict[str, Any]) -> list[HotelImage]:
    """Provider media only. If the provider sends none, we send none."""
    images: list[HotelImage] = []
    for key in ("img", "images", "hotelImages", "gallery"):
        for item in get_list(raw, key):
            url: str | None
            if isinstance(item, str):
                url = item.strip() or None
                caption = None
            elif isinstance(item, dict):
                url = get_str(item, "url", "imageUrl", "src", "l", "m", "s")
                caption = get_str(item, "caption", "tp", "type")
            else:
                continue
            if not url or not url.lower().startswith("http"):
                continue
            images.append(HotelImage(url=url, caption=caption))
            if len(images) >= MAX_IMAGES:
                return images
        if images:
            break
    return images


def _string_list(raw: dict[str, Any], *keys: str) -> list[str] | None:
    for key in keys:
        values = [v.strip() for v in get_list(raw, key) if isinstance(v, str) and v.strip()]
        if values:
            return values[:40]
    return None


def _rate_summary(raw: dict[str, Any], currency: str) -> HotelRateSummary | None:
    option = _cheapest_option(raw)
    if option is None:
        return None
    total, base, taxes = _prices(option)
    if total is None:
        return None

    nights = get_int(raw, "nights") or get_int(option, "nights")
    per_night = round(total / nights, 2) if nights and nights > 0 else None
    cancellation = _cancellation(option, currency)

    return HotelRateSummary(
        total_price=Money(amount=round(total, 2), currency=currency),
        per_night_price=Money(amount=per_night, currency=currency) if per_night else None,
        meal_plan=get_str(option, "mb", "mealPlan", "boardType"),
        refundable=cancellation.refundable if cancellation else None,
        free_cancellation_until=cancellation.free_cancellation_until if cancellation else None,
        room_name=get_str(option, "rc", "roomName", "name"),
        rooms_available=get_int(option, "ra", "roomsAvailable", "availableRooms"),
    )


def _cheapest_option(raw: dict[str, Any]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for key in ("ops", "options", "rates", "roomRates", "totalPriceList"):
        candidates.extend(item for item in get_list(raw, key) if isinstance(item, dict))
        if candidates:
            break
    if not candidates:
        # Some listings carry a single flattened rate on the hotel itself.
        if get_number(get_map(raw, "tp", "totalPrice", "price"), "TF", "total", "amount") is not None:
            return raw
        return None
    priced = [(c, _prices(c)[0]) for c in candidates]
    priced = [(c, total) for c, total in priced if total is not None]
    if not priced:
        return None
    return min(priced, key=lambda pair: pair[1])[0]


def _prices(option: dict[str, Any]) -> tuple[float | None, float | None, float | None]:
    """(total, base, taxes) — all optional, none of them ever invented."""
    price_block = get_map(option, "tp", "totalPrice", "price", "fare") or option
    total = get_number(price_block, "TF", "total", "totalFare", "amount", "tp", "publishedPrice")
    if total is None:
        total = get_number(option, "tp", "totalPrice", "price")
    base = get_number(price_block, "BF", "base", "baseFare", "roomRate")
    taxes = get_number(price_block, "TAF", "tax", "taxes", "totalTax")
    return total, base, taxes


def _cancellation(option: dict[str, Any], currency: str) -> HotelCancellationPolicy | None:
    raw_policy = get_map(option, "cnp", "cancellationPolicy", "cancelPolicy")
    raw_rules = get_list(raw_policy, "pd", "policies", "rules") or get_list(
        option, "cancellationPolicies"
    )

    refundable = refundable_flag(
        raw_policy.get("ifra")
        if "ifra" in raw_policy
        else option.get("refundable", option.get("isRefundable", option.get("rt")))
    )

    rules: list[HotelCancellationRule] = []
    free_until: str | None = None
    for item in raw_rules:
        if not isinstance(item, dict):
            continue
        charge = get_number(item, "am", "amount", "charge")
        rule = HotelCancellationRule(
            **{
                "from": get_str(item, "fd", "from", "fromDate"),
                "to": get_str(item, "td", "to", "toDate"),
                "charge": Money(amount=round(charge, 2), currency=currency)
                if charge is not None
                else None,
                "description": get_str(item, "desc", "description", "policyText"),
            }
        )
        rules.append(rule)
        if charge == 0 and rule.to and free_until is None:
            free_until = rule.to

    summary = get_str(raw_policy, "text", "summary", "policyText")
    if refundable is None and not rules and not summary:
        return None

    return HotelCancellationPolicy(
        refundable=bool(refundable),
        summary=summary,
        free_cancellation_until=free_until,
        rules=rules or None,
    )


# ============================== detail =====================================


async def hotel_detail(
    client: TripJackClient,
    config: TripJackConfig,
    *,
    provider_hotel_id: str,
    provider_search_id: str | None,
    currency: str,
    fallback: HotelResult | None = None,
) -> HotelDetail:
    body = await client.post(
        HOTEL_DETAIL_PATH,
        build_detail_payload(
            provider_hotel_id=provider_hotel_id,
            provider_search_id=provider_search_id,
        ),
        retries=config.search_retries,
        operation="hotel_detail",
    )
    return normalize_detail_response(
        body,
        provider_hotel_id=provider_hotel_id,
        currency=currency,
        fallback=fallback,
    )


def normalize_detail_response(
    body: dict[str, Any],
    *,
    provider_hotel_id: str,
    currency: str,
    fallback: HotelResult | None = None,
) -> HotelDetail:
    raw = (
        get_map(body, "hotel")
        or get_map(get_map(body, "searchResult"), "hotel")
        or (_raw_hotel_list(body)[0] if _raw_hotel_list(body) else {})
        or body
    )
    if not isinstance(raw, dict):
        raw = {}

    base = _hotel_result(raw, currency) or fallback
    if base is None:
        # Nothing renderable came back; surfacing a blank hotel would be worse.
        raise ValueError("hotel_detail_unusable")

    return HotelDetail(
        id=provider_hotel_id,
        name=base.name,
        star_rating=base.star_rating,
        property_type=base.property_type,
        location=base.location,
        thumbnail_url=base.thumbnail_url,
        images=base.images,
        amenities=base.amenities,
        review_score=base.review_score,
        review_count=base.review_count,
        rate=base.rate,
        description=get_str(raw, "desc", "description", "hotelDescription"),
        check_in_time=get_str(raw, "checkInTime", "cit", "checkin"),
        check_out_time=get_str(raw, "checkOutTime", "cot", "checkout"),
        facilities=_string_list(raw, "fac", "facilities", "amenities"),
        policies=_string_list(raw, "pol", "policies", "instructions", "hotelPolicy"),
        rooms=_rooms(raw, currency),
    )


def _rooms(raw: dict[str, Any], currency: str) -> list[HotelRoomOption]:
    options: list[dict[str, Any]] = []
    for key in ("ops", "options", "rates", "roomRates", "roomOptions"):
        options = [item for item in get_list(raw, key) if isinstance(item, dict)]
        if options:
            break

    rooms: list[HotelRoomOption] = []
    for option in options:
        room = _room_option(option, currency)
        if room is not None:
            rooms.append(room)
        if len(rooms) >= MAX_ROOMS_PER_HOTEL:
            break
    return rooms


def _room_option(option: dict[str, Any], currency: str) -> HotelRoomOption | None:
    rate_id = get_str(option, "id", "rateId", "bookingCode")
    total, base, taxes = _prices(option)
    if not rate_id or total is None:
        # An unpriced or unbookable rate must never be shown as sellable.
        return None

    room_block = option
    room_infos = [item for item in get_list(option, "ris", "roomInfo", "rooms") if isinstance(item, dict)]
    if room_infos:
        room_block = room_infos[0]

    adults = get_int(room_block, "adultCount", "numberOfAdults", "adults") or 1
    child_ages = [
        int(age)
        for age in get_list(room_block, "childAge", "childAges")
        if isinstance(age, (int, float)) and not isinstance(age, bool) and 0 <= int(age) <= 17
    ]

    fees = get_number(get_map(option, "tp", "totalPrice", "price"), "OT", "fees", "otherCharges")

    return HotelRoomOption(
        id=rate_id,
        room_name=get_str(room_block, "rc", "roomName", "name", "roomType") or "Room",
        room_type=get_str(room_block, "roomType", "rt"),
        bed_type=get_str(room_block, "bedType", "bt"),
        occupancy=HotelOccupancy(adults=min(adults, 6), child_ages=child_ages[:4]),
        room_count=max(len(room_infos) or 1, 1),
        meal_plan=get_str(option, "mb", "mealPlan", "boardType") or get_str(room_block, "mb"),
        inclusions=_string_list(option, "inc", "inclusions") or _string_list(room_block, "inc", "inclusions"),
        cancellation=_cancellation(option, currency) or HotelCancellationPolicy(refundable=False),
        base_price=Money(amount=round(base, 2), currency=currency) if base is not None else None,
        taxes=Money(amount=round(taxes, 2), currency=currency) if taxes is not None else None,
        fees_and_charges=Money(amount=round(fees, 2), currency=currency) if fees is not None else None,
        total_price=Money(amount=round(total, 2), currency=currency),
        rooms_available=get_int(option, "ra", "roomsAvailable", "availableRooms"),
        payment_policy=get_str(option, "pt", "paymentPolicy", "payAt"),
    )


# ============================== re-price ===================================


async def review_rate(
    client: TripJackClient,
    config: TripJackConfig,
    *,
    provider_rate_id: str,
    provider_hotel_id: str | None,
    currency: str,
) -> HotelRoomOption | None:
    """Re-price one rate with the provider.

    Returns the re-priced room, or `None` when the provider gives no usable
    quote back (the caller then treats the rate as unavailable — it never
    falls back to the older, cheaper price).
    """
    body = await client.post(
        HOTEL_RATE_REVIEW_PATH,
        build_rate_review_payload(
            provider_rate_id=provider_rate_id,
            provider_hotel_id=provider_hotel_id,
        ),
        retries=0,  # transactional-adjacent: never retried
        operation="hotel_rate_review",
    )

    candidate = (
        get_map(body, "hotel")
        or get_map(get_map(body, "searchResult"), "hotel")
        or body
    )
    for option in _rooms(candidate, currency) or []:
        if option.id == provider_rate_id:
            return option
    rooms = _rooms(candidate, currency)
    return rooms[0] if rooms else None
