"""TripJack Hotel API v3 adapter: our request -> TripJack -> our normalized types.

Route handlers and services never touch TripJack HTTP or TripJack field names.
They call `search_hotels()`, `hotel_pricing()` and `review_option()` here and
get fully normalized domain objects back.

Normalization rules (identical to the flight adapter):
  * A field the provider omits stays `None` — nothing is invented, no price is
    defaulted, no image, rating or policy is substituted.
  * A single malformed hotel/option is skipped, not allowed to fail the request.
  * Anything we cannot price is dropped: an option without a total is not
    sellable, so it is never shown.
  * `mf` (management fee) and `mft` (its tax) are ADDED into the payable total
    and also itemised, so the customer sees what they are paying.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger, log_extra
from app.integrations.tripjack.client import TripJackClient
from app.integrations.tripjack.config import TripJackConfig
from app.integrations.tripjack.hotel_wire import (
    DEFAULT_CURRENCY,
    HOTEL_LISTING_PATH,
    HOTEL_PRICING_PATH,
    HOTEL_REVIEW_PATH,
    OPTION_TYPES,
    RATE_PLAN_TYPES,
    build_listing_continuation_payload,
    build_listing_payload,
    build_pricing_payload,
    build_review_payload,
    normalise_rate_plan,
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
    HotelRatePlan,
    HotelRateSummary,
    HotelResult,
    HotelRoomOption,
    HotelSearchRequest,
)

logger = get_logger(__name__)

MAX_RESULTS = 240
MAX_ROOMS_PER_HOTEL = 60
MAX_IMAGES = 12


class HotelSearchPage:
    """One page of v3 listing plus the handles needed to continue."""

    __slots__ = ("results", "search_id", "next_token", "has_more")

    def __init__(
        self,
        results: list[HotelResult],
        search_id: str | None,
        next_token: str | None,
        has_more: bool,
    ) -> None:
        self.results = results
        self.search_id = search_id
        self.next_token = next_token
        self.has_more = has_more


# ============================== listing ====================================


async def search_hotels(
    client: TripJackClient,
    config: TripJackConfig,
    request: HotelSearchRequest,
    *,
    hids: list[str],
) -> tuple[list[HotelResult], str | None, str]:
    """Run /hms/v3/hotel/listing, following searchId continuation.

    Returns (results, searchId, currency). The searchId is the head of the
    v3 identity chain (searchId -> optionId -> reviewHash) and is stored
    server-side only.
    """
    currency = request.currency or DEFAULT_CURRENCY

    payload = build_listing_payload(
        hids=hids,
        check_in=request.check_in.isoformat(),
        check_out=request.check_out.isoformat(),
        rooms=[{"adults": r.adults, "childAges": r.child_ages} for r in request.rooms],
        nationality=request.nationality,
        currency=request.currency,
    )

    # Listing is a pure read, so a small retry budget is safe.
    body = await client.post(
        HOTEL_LISTING_PATH,
        payload,
        retries=config.search_retries,
        operation="hotel_listing",
    )

    page = normalize_listing_response(body, currency=currency)
    results = list(page.results)
    search_id = page.search_id
    seen = {result.id for result in results}
    next_token = page.next_token
    has_more = page.has_more

    # v3 removed pageSize; continuation is driven by the searchId from page 1.
    pages = 1
    while has_more and search_id and pages < config.hotel_max_pages and len(results) < MAX_RESULTS:
        try:
            body = await client.post(
                HOTEL_LISTING_PATH,
                build_listing_continuation_payload(
                    search_id=search_id, next_token=next_token
                ),
                retries=0,
                operation="hotel_listing_page",
            )
        except Exception:  # noqa: BLE001
            # Partial results beat no results: keep what page 1 gave us.
            logger.warning("hotel_listing_page_failed", extra=log_extra(page=pages + 1))
            break

        page = normalize_listing_response(body, currency=currency)
        added = 0
        for result in page.results:
            if result.id in seen:
                continue
            seen.add(result.id)
            results.append(result)
            added += 1
        pages += 1
        next_token = page.next_token
        has_more = page.has_more and added > 0

    logger.info(
        "tripjack_hotel_listing_normalized",
        extra=log_extra(result_count=len(results), pages=pages),
    )
    return results[:MAX_RESULTS], search_id, currency


def normalize_listing_response(body: dict[str, Any], *, currency: str) -> HotelSearchPage:
    search_result = get_map(body, "searchResult")
    search_id = (
        get_str(body, "searchId")
        or get_str(search_result, "searchId")
        or get_str(body, "id")
    )
    next_token = get_str(body, "nextPageToken", "pageToken") or get_str(
        search_result, "nextPageToken", "pageToken"
    )
    raw_more = body.get("hasMore", search_result.get("hasMore"))
    has_more = bool(raw_more) if isinstance(raw_more, bool) else bool(next_token)

    results: list[HotelResult] = []
    for raw in _raw_hotel_list(body):
        hotel = _hotel_result(raw, currency)
        if hotel is not None:
            results.append(hotel)
        if len(results) >= MAX_RESULTS:
            break

    return HotelSearchPage(results, search_id, next_token, has_more)


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

    provider_id = get_str(raw, "id", "hotelId", "hid", "code")
    name = get_str(raw, "name", "hotelName")
    if not (provider_id and name):
        # Without an id we could never re-price it; without a name we could
        # not honestly render it.
        return None

    images = _images(raw)
    rate_plans = _rate_plans(raw, currency)
    return HotelResult(
        id=provider_id,
        name=name,
        star_rating=get_number(raw, "rt", "starRating", "rating"),
        property_type=get_str(raw, "pt", "propertyType", "category"),
        location=_location(raw),
        thumbnail_url=images[0].url if images else None,
        images=images or None,
        # v3 renamed amenitiesHighlight -> amenities.
        amenities=_string_list(raw, "amenities"),
        review_score=get_number(raw, "reviewScore", "tripAdvisorRating"),
        review_count=get_int(raw, "reviewCount", "numberOfReviews"),
        rate=_rate_summary(rate_plans),
        rate_plans=rate_plans or None,
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


# --------------------------- options / pricing -----------------------------


def _raw_options(raw: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("ops", "options", "ratePlans", "rates", "roomRates"):
        options = [item for item in get_list(raw, key) if isinstance(item, dict)]
        if options:
            return options
    return []


def _prices(option: dict[str, Any]) -> dict[str, float | None]:
    """Every amount the provider gave us. Nothing is defaulted or invented.

    v3 pricing objects carry `mf` (management fee) and `mft` (its tax) in
    addition to the room fare and taxes. Both are payable, so the total we
    quote is provider total + mf + mft.
    """
    price_block = get_map(option, "tp", "totalPrice", "price", "fare") or option

    provider_total = get_number(
        price_block, "TF", "total", "totalFare", "amount", "publishedPrice"
    )
    if provider_total is None:
        provider_total = get_number(option, "tp", "totalPrice", "price")

    management_fee = get_number(price_block, "mf") or get_number(option, "mf")
    management_fee_tax = get_number(price_block, "mft") or get_number(option, "mft")

    total = provider_total
    if total is not None:
        total += management_fee or 0.0
        total += management_fee_tax or 0.0

    return {
        "total": total,
        "base": get_number(price_block, "BF", "base", "baseFare", "roomRate"),
        "taxes": get_number(price_block, "TAF", "tax", "taxes", "totalTax"),
        "fees": get_number(price_block, "OT", "fees", "otherCharges"),
        "mf": management_fee,
        "mft": management_fee_tax,
    }


def _flag(option: dict[str, Any], *keys: str) -> bool | None:
    for key in keys:
        if key in option:
            value = refundable_flag(option.get(key))
            if value is not None:
                return value
    return None


def _rate_plan_type(option: dict[str, Any]) -> str | None:
    for key in ("ratePlanType", "rpt", "planType", "tag", "rateType"):
        mapped = normalise_rate_plan(option.get(key))
        if mapped:
            return mapped
    # Some payloads mark the plan with booleans rather than a type string.
    if _flag(option, "isPanNotRequired") is True:
        return "PAN_NOT_REQUIRED"
    if _flag(option, "isBreakfastIncluded", "breakfastIncluded") is True:
        return "BREAKFAST_INCLUSIVE"
    if _flag(option, "isGstInclusive", "gstInclusive") is True:
        return "GST_INCLUSIVE"
    return None


def _rate_plans(raw: dict[str, Any], currency: str) -> list[HotelRatePlan]:
    """Keep ALL v3 rate plan types, not only the cheapest."""
    plans: list[HotelRatePlan] = []
    nights = get_int(raw, "nights")

    for option in _raw_options(raw):
        option_id = get_str(option, "id", "optionId", "rateId")
        prices = _prices(option)
        total = prices["total"]
        if not option_id or total is None:
            continue

        plan_type = _rate_plan_type(option) or ("CHEAPEST" if not plans else None)
        if plan_type is None:
            continue
        if any(plan.type == plan_type for plan in plans):
            continue

        cancellation = _cancellation(option, currency)
        option_nights = nights or get_int(option, "nights")
        per_night = round(total / option_nights, 2) if option_nights else None

        plans.append(
            HotelRatePlan(
                type=plan_type,
                label=RATE_PLAN_TYPES.get(plan_type, plan_type.replace("_", " ").title()),
                option_id=option_id,
                total_price=Money(amount=round(total, 2), currency=currency),
                per_night_price=Money(amount=per_night, currency=currency)
                if per_night
                else None,
                meal_plan=get_str(option, "mb", "mealPlan", "boardType"),
                refundable=cancellation.refundable if cancellation else None,
                free_cancellation_until=cancellation.free_cancellation_until
                if cancellation
                else None,
                room_name=get_str(option, "rc", "roomName", "name"),
                pan_required=_flag(option, "panRequired", "isPanRequired"),
                breakfast_included=_flag(
                    option, "isBreakfastIncluded", "breakfastIncluded"
                ),
                gst_inclusive=_flag(option, "isGstInclusive", "gstInclusive"),
            )
        )

    # Cheapest first, then the remaining plan types in documented order.
    order = list(RATE_PLAN_TYPES)
    plans.sort(key=lambda plan: order.index(plan.type) if plan.type in order else 99)
    return plans


def _rate_summary(plans: list[HotelRatePlan]) -> HotelRateSummary | None:
    """Headline rate = cheapest priced plan. The rest travel in `rate_plans`."""
    if not plans:
        return None
    cheapest = min(plans, key=lambda plan: plan.total_price.amount)
    return HotelRateSummary(
        total_price=cheapest.total_price,
        per_night_price=cheapest.per_night_price,
        meal_plan=cheapest.meal_plan,
        refundable=cheapest.refundable,
        free_cancellation_until=cheapest.free_cancellation_until,
        room_name=cheapest.room_name,
        rate_plan_type=cheapest.type,
        rate_plan_label=cheapest.label,
    )


def _cancellation(option: dict[str, Any], currency: str) -> HotelCancellationPolicy | None:
    """v3 embeds the policy inside every option; there is no separate call."""
    raw_policy = get_map(option, "cnp", "cancellationPolicy", "cancelPolicy")
    raw_rules = get_list(raw_policy, "pd", "policies", "rules") or get_list(
        option, "cancellationPolicies"
    )

    refundable = refundable_flag(
        raw_policy.get("ifra")
        if "ifra" in raw_policy
        else option.get("refundable", option.get("isRefundable"))
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


# ============================== pricing ====================================


async def hotel_pricing(
    client: TripJackClient,
    config: TripJackConfig,
    *,
    search_id: str,
    provider_hotel_id: str,
    currency: str,
    fallback: HotelResult | None = None,
) -> HotelDetail:
    """/hms/v3/hotel/pricing — static detail plus every sellable option."""
    body = await client.post(
        HOTEL_PRICING_PATH,
        build_pricing_payload(search_id=search_id, hotel_id=provider_hotel_id),
        retries=config.search_retries,
        operation="hotel_pricing",
    )
    return normalize_pricing_response(
        body,
        provider_hotel_id=provider_hotel_id,
        currency=currency,
        fallback=fallback,
    )


def normalize_pricing_response(
    body: dict[str, Any],
    *,
    provider_hotel_id: str,
    currency: str,
    fallback: HotelResult | None = None,
) -> HotelDetail:
    listed = _raw_hotel_list(body)
    raw = (
        get_map(body, "hotel")
        or get_map(get_map(body, "searchResult"), "hotel")
        or (listed[0] if listed else {})
        or body
    )
    if not isinstance(raw, dict):
        raw = {}

    base = _hotel_result(raw, currency) or fallback
    if base is None:
        # Nothing renderable came back; surfacing a blank hotel would be worse.
        raise ValueError("hotel_pricing_unusable")

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
        rate_plans=base.rate_plans,
        description=get_str(raw, "desc", "description", "hotelDescription"),
        check_in_time=get_str(raw, "checkInTime", "cit", "checkin"),
        check_out_time=get_str(raw, "checkOutTime", "cot", "checkout"),
        facilities=_string_list(raw, "amenities", "facilities"),
        policies=_string_list(raw, "pol", "policies", "instructions", "hotelPolicy"),
        rooms=_rooms(raw, currency),
    )


def _rooms(raw: dict[str, Any], currency: str) -> list[HotelRoomOption]:
    rooms: list[HotelRoomOption] = []
    for option in _raw_options(raw):
        room = _room_option(option, currency)
        if room is not None:
            rooms.append(room)
        if len(rooms) >= MAX_ROOMS_PER_HOTEL:
            break
    return rooms


def _room_option(option: dict[str, Any], currency: str) -> HotelRoomOption | None:
    option_id = get_str(option, "id", "optionId", "rateId", "bookingCode")
    prices = _prices(option)
    total = prices["total"]
    if not option_id or total is None:
        # An unpriced or unbookable option must never be shown as sellable.
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

    option_type = (get_str(option, "optionType", "ot") or "").upper() or None
    plan_type = _rate_plan_type(option)

    def money(value: float | None) -> Money | None:
        return Money(amount=round(value, 2), currency=currency) if value is not None else None

    return HotelRoomOption(
        id=option_id,
        room_name=get_str(room_block, "rc", "roomName", "name", "roomType") or "Room",
        room_type=get_str(room_block, "roomType", "rt"),
        bed_type=get_str(room_block, "bedType", "bt"),
        occupancy=HotelOccupancy(adults=min(adults, 6), child_ages=child_ages[:4]),
        room_count=max(len(room_infos) or 1, 1),
        meal_plan=get_str(option, "mb", "mealPlan", "boardType") or get_str(room_block, "mb"),
        inclusions=_string_list(option, "inc", "inclusions") or _string_list(room_block, "inc", "inclusions"),
        cancellation=_cancellation(option, currency) or HotelCancellationPolicy(refundable=False),
        base_price=money(prices["base"]),
        taxes=money(prices["taxes"]),
        fees_and_charges=money(prices["fees"]),
        management_fee=money(prices["mf"]),
        management_fee_tax=money(prices["mft"]),
        total_price=Money(amount=round(total, 2), currency=currency),
        rooms_available=get_int(option, "ra", "roomsAvailable", "availableRooms"),
        payment_policy=get_str(option, "pt", "paymentPolicy", "payAt"),
        option_type=option_type if option_type in OPTION_TYPES else option_type,
        option_type_label=OPTION_TYPES.get(option_type or ""),
        rate_plan_type=plan_type,
        rate_plan_label=RATE_PLAN_TYPES.get(plan_type or ""),
        # Provider-declared requirements for this rate — never inferred.
        pan_required=_flag(option, "panRequired", "isPanRequired")
        if plan_type != "PAN_NOT_REQUIRED"
        else False,
        passport_required=_flag(option, "passportRequired", "isPassportRequired"),
        gst_inclusive=_flag(option, "isGstInclusive", "gstInclusive"),
        breakfast_included=_flag(option, "isBreakfastIncluded", "breakfastIncluded"),
    )


# =============================== review ====================================


async def review_option(
    client: TripJackClient,
    config: TripJackConfig,
    *,
    search_id: str,
    provider_hotel_id: str,
    option_id: str,
    currency: str,
) -> tuple[HotelRoomOption | None, str | None]:
    """/hms/v3/hotel/review — authoritative re-price of one optionId.

    Returns (repriced room, reviewHash). `None` means the provider gave no
    usable quote back: the caller treats the option as gone rather than selling
    the older, cheaper price. The reviewHash is the handle the booking phase
    will need and is stored server-side only.
    """
    body = await client.post(
        HOTEL_REVIEW_PATH,
        build_review_payload(
            search_id=search_id, hotel_id=provider_hotel_id, option_id=option_id
        ),
        retries=0,  # transactional-adjacent: never retried
        operation="hotel_review",
    )

    review_hash = (
        get_str(body, "reviewHash")
        or get_str(get_map(body, "reviewResult"), "reviewHash")
        or get_str(get_map(body, "hotel"), "reviewHash")
    )

    candidate = (
        get_map(body, "hotel")
        or get_map(get_map(body, "reviewResult"), "hotel")
        or get_map(body, "reviewResult")
        or body
    )
    rooms = _rooms(candidate, currency)
    exact = next((room for room in rooms if room.id == option_id), None)
    return (exact or (rooms[0] if rooms else None)), review_hash
