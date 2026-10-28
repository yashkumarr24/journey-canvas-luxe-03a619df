"""TripJack flight adapter: our request -> TripJack -> our normalized response.

Route handlers never touch TripJack HTTP or TripJack field names. They call
`search_flights()` here and receive fully normalized domain objects.

Normalization rules:
  * Only fields documented in the TripJack Flights API v2.0 reference are read.
  * A field TripJack omits stays `None` — nothing is invented or defaulted to a
    plausible-looking value.
  * A single malformed result is skipped, not allowed to fail the whole search.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.logging import get_logger, log_extra
from app.integrations.tripjack.client import TripJackClient
from app.integrations.tripjack.config import TripJackConfig
from app.integrations.tripjack.schemas import (
    CABIN_CLASS_FROM_TRIPJACK,
    COMBO_KEY,
    DEFAULT_CURRENCY,
    ONWARD_KEY,
    RETURN_KEY,
    SEARCH_PATH,
    build_search_payload,
    get_int,
    get_list,
    get_map,
    get_number,
    get_str,
)
from app.schemas.flights import (
    AirlineRef,
    AirportRef,
    BaggageAllowance,
    FlightFare,
    FlightItinerary,
    FlightResult,
    FlightSearchRequest,
    FlightSearchResponse,
    FlightSegment,
    Money,
)

logger = get_logger(__name__)

# TripJack documents priceIds as valid for 15 minutes. We advertise a slightly
# shorter window so the UI never presents an already-dead quote as live.
PRICE_ID_TTL = timedelta(minutes=14)

# Refundable type (rT): 0 = non-refundable, 1 = refundable, 2 = partial.
REFUNDABLE_BY_RT = {0: False, 1: True, 2: True}
REFUND_LABEL_BY_RT = {0: "Non-refundable", 1: "Refundable", 2: "Partially refundable"}

MAX_RESULTS = 120


async def search_flights(
    client: TripJackClient,
    config: TripJackConfig,
    request: FlightSearchRequest,
) -> FlightSearchResponse:
    legs = (
        [(leg.origin, leg.destination, leg.departure_date.isoformat()) for leg in request.legs]
        if request.legs
        else None
    )
    payload = build_search_payload(
        origin=request.origin or "",
        destination=request.destination or "",
        departure_date=request.departure_date.isoformat() if request.departure_date else "",
        return_date=request.return_date.isoformat() if request.return_date else None,
        cabin_class=request.cabin_class,
        adults=request.passengers.adults,
        children=request.passengers.children,
        infants=request.passengers.infants,
        direct_only=request.direct_only,
        connecting_only=request.connecting_only,
        pfts=list(request.pfts) if request.pfts else None,
        preferred_airlines=list(request.preferred_airlines) if request.preferred_airlines else None,
        legs=legs,
    )

    # Search is a pure read, so a small retry budget is safe. Nothing
    # transactional is ever retried (see client.post docstring).
    body = await client.post(
        SEARCH_PATH,
        payload,
        retries=config.search_retries,
        operation="air_search_all",
    )

    return normalize_search_response(body, currency=request.currency or DEFAULT_CURRENCY)


# --------------------------------------------------------------------------


def normalize_search_response(body: dict[str, Any], *, currency: str) -> FlightSearchResponse:
    trip_infos = get_map(get_map(body, "searchResult"), "tripInfos")

    outbound_trips = get_list(trip_infos, ONWARD_KEY)
    inbound_trips = get_list(trip_infos, RETURN_KEY)
    combo_trips = get_list(trip_infos, COMBO_KEY)

    # MAX_RESULTS caps each provider group independently. A single global
    # cap let a large first group (ONWARD/COMBO/leg 0) crowd out RETURN fares
    # or later multi-city legs entirely, leaving those legs unselectable.
    results: list[FlightResult] = []
    results.extend(_capped(combo_trips, "outbound", currency, combo=True))
    results.extend(_capped(outbound_trips, "outbound", currency))
    results.extend(_capped(inbound_trips, "inbound", currency))

    # Domestic multi-city returns indexed keys per route (documented as
    # "Indexed keys per route"; the reference never names them, so any
    # list-valued key outside ONWARD/RETURN/COMBO is treated as one leg
    # group). EVERY group is normalized with its original key and index —
    # no leg and no priceId is dropped. How fares combine across legs is not
    # documented, so no combination logic lives here.
    for key, group in _indexed_groups(trip_infos):
        leg_index = int(key) if key.isdigit() else None
        results.extend(
            _capped(group, "leg", currency, leg_index=leg_index, group_key=key)
        )

    airlines: dict[str, AirlineRef] = {}
    for result in results:
        for itinerary in result.itineraries:
            for segment in itinerary.segments:
                airlines.setdefault(segment.airline.code, segment.airline)

    expires_at = (datetime.now(timezone.utc) + PRICE_ID_TTL).isoformat(timespec="seconds")

    logger.info(
        "tripjack_search_normalized",
        extra=log_extra(result_count=len(results), airline_count=len(airlines)),
    )

    return FlightSearchResponse(
        results=results,
        airlines=sorted(airlines.values(), key=lambda a: a.code) or None,
        currency=currency,
        expires_at=expires_at,
    )


def _indexed_groups(trip_infos: dict[str, Any]) -> list[tuple[str, list[Any]]]:
    """List-valued tripInfos keys outside the documented ONWARD/RETURN/COMBO.

    Sorted numerically when every key is a non-negative integer (the
    documented multi-city shape), otherwise lexically — order is preserved,
    never invented.
    """
    groups = [
        (key, value)
        for key, value in trip_infos.items()
        if key not in (ONWARD_KEY, RETURN_KEY, COMBO_KEY) and isinstance(value, list)
    ]
    if groups and all(key.isdigit() for key, _ in groups):
        groups.sort(key=lambda item: int(item[0]))
    else:
        groups.sort(key=lambda item: item[0])
    return groups


def _capped(trips: list[Any], direction: str, currency: str, **kwargs: Any) -> list[FlightResult]:
    out: list[FlightResult] = []
    for trip in trips:
        out.extend(_results_from_trip(trip, direction, currency, **kwargs))
        if len(out) >= MAX_RESULTS:
            return out[:MAX_RESULTS]
    return out


def _results_from_trip(
    trip: Any,
    direction: str,
    currency: str,
    *,
    combo: bool = False,
    leg_index: int | None = None,
    group_key: str | None = None,
) -> list[FlightResult]:
    if not isinstance(trip, dict):
        return []

    segments = [seg for seg in (_segment(raw) for raw in get_list(trip, "sI")) if seg]
    if not segments:
        return []

    itinerary = _itinerary(segments, direction if not combo else "outbound", leg_index=leg_index, group_key=group_key)

    out: list[FlightResult] = []
    for price in get_list(trip, "totalPriceList"):
        if not isinstance(price, dict):
            continue
        fare = _fare(price, currency)
        if fare is None:
            continue
        price_id = get_str(price, "id")
        if not price_id:
            # Without a priceId the option cannot be re-priced or booked, so
            # showing it would be dishonest.
            continue
        out.append(
            FlightResult(
                id=price_id,
                itineraries=[itinerary],
                fare=fare,
                validating_airline=segments[0].airline,
            )
        )
    return out


def _itinerary(
    segments: list[FlightSegment],
    direction: str,
    *,
    leg_index: int | None = None,
    group_key: str | None = None,
) -> FlightItinerary:
    durations = [s.duration_minutes for s in segments if s.duration_minutes is not None]
    total = sum(durations) if len(durations) == len(segments) else None
    return FlightItinerary(
        direction=direction if direction in ("inbound", "leg") else "outbound",
        segments=segments,
        stops=max(len(segments) - 1, 0),
        duration_minutes=total,
        leg_index=leg_index,
        group_key=group_key,
    )


def _segment(raw: Any) -> FlightSegment | None:
    if not isinstance(raw, dict):
        return None

    flight_detail = get_map(raw, "fD")
    airline_code = get_str(get_map(flight_detail, "aI"), "code")
    departure_at = get_str(raw, "dt")
    arrival_at = get_str(raw, "at")
    origin = _airport(get_map(raw, "da"))
    destination = _airport(get_map(raw, "aa"))

    # Anything without these cannot be rendered meaningfully.
    if not (airline_code and departure_at and arrival_at and origin and destination):
        return None

    flight_number = get_str(flight_detail, "fN")
    segment_id = get_str(raw, "id") or f"{airline_code}-{flight_number or '?'}-{departure_at}"

    return FlightSegment(
        id=segment_id,
        airline=AirlineRef(code=airline_code, name=get_str(get_map(flight_detail, "aI"), "name")),
        flight_number=flight_number,
        aircraft=get_str(flight_detail, "eT"),
        origin=origin,
        destination=destination,
        departure_at=departure_at,
        arrival_at=arrival_at,
        duration_minutes=get_int(raw, "duration"),
    )


def _airport(raw: dict[str, Any]) -> AirportRef | None:
    code = get_str(raw, "code")
    if not code:
        return None
    return AirportRef(
        code=code,
        name=get_str(raw, "name"),
        city=get_str(raw, "cityName", "city"),
        country=get_str(raw, "countryName", "country"),
        terminal=get_str(raw, "terminal"),
    )


def _fare(price: dict[str, Any], currency: str) -> FlightFare | None:
    # fd is keyed by pax type; ADULT is always present when a fare exists.
    fare_details = get_map(price, "fd", "fD")
    adult = get_map(fare_details, "ADULT")
    if not adult:
        # Fall back to whichever pax block exists rather than dropping the fare.
        for value in fare_details.values():
            if isinstance(value, dict):
                adult = value
                break
    if not adult:
        return None

    components = get_map(adult, "fC")
    total = get_number(components, "TF")
    if total is None:
        return None

    base = get_number(components, "BF")
    taxes = get_number(components, "TAF")
    refundable_type = get_int(adult, "rT")
    baggage_raw = get_map(adult, "bI")
    baggage = BaggageAllowance(
        check_in=get_str(baggage_raw, "iB"),
        cabin=get_str(baggage_raw, "cB"),
    )

    conditions: list[str] = []
    if refundable_type in REFUND_LABEL_BY_RT:
        conditions.append(REFUND_LABEL_BY_RT[refundable_type])
    if baggage.check_in:
        conditions.append(f"Check-in baggage: {baggage.check_in}")
    if baggage.cabin:
        conditions.append(f"Cabin baggage: {baggage.cabin}")

    cabin_raw = get_str(adult, "cc")

    fare = FlightFare(
        fare_id=get_str(price, "id"),
        total_price=Money(amount=round(total, 2), currency=currency),
        base_price=Money(amount=round(base, 2), currency=currency) if base is not None else None,
        taxes=Money(amount=round(taxes, 2), currency=currency) if taxes is not None else None,
        refundable=REFUNDABLE_BY_RT.get(refundable_type) if refundable_type is not None else None,
        fare_type=get_str(price, "fareIdentifier"),
        conditions=conditions or None,
        seats_available=get_int(adult, "sR"),
    )
    # Cabin class is carried on segments in our model; attach where known.
    if cabin_raw and cabin_raw.upper() in CABIN_CLASS_FROM_TRIPJACK:
        fare.conditions = (fare.conditions or []) + [
            CABIN_CLASS_FROM_TRIPJACK[cabin_raw.upper()].replace("_", " ").title()
        ]
    return fare
