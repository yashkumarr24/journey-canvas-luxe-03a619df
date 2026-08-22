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
    payload = build_search_payload(
        origin=request.origin,
        destination=request.destination,
        departure_date=request.departure_date.isoformat(),
        return_date=request.return_date.isoformat() if request.return_date else None,
        cabin_class=request.cabin_class,
        adults=request.passengers.adults,
        children=request.passengers.children,
        infants=request.passengers.infants,
        direct_only=request.direct_only,
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

    if not (outbound_trips or inbound_trips or combo_trips):
        # Domestic multi-city uses indexed keys ("0", "1", ...). Treat the
        # first indexed group as outbound so nothing is silently dropped.
        indexed = [trip_infos[k] for k in sorted(trip_infos) if isinstance(trip_infos[k], list)]
        if indexed:
            outbound_trips = indexed[0]

    results: list[FlightResult] = []
    for trip in combo_trips:
        results.extend(_results_from_trip(trip, "outbound", currency, combo=True))
    for trip in outbound_trips:
        results.extend(_results_from_trip(trip, "outbound", currency))
    for trip in inbound_trips:
        results.extend(_results_from_trip(trip, "inbound", currency))

    results = results[:MAX_RESULTS]

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


def _results_from_trip(
    trip: Any,
    direction: str,
    currency: str,
    *,
    combo: bool = False,
) -> list[FlightResult]:
    if not isinstance(trip, dict):
        return []

    segments = [seg for seg in (_segment(raw) for raw in get_list(trip, "sI")) if seg]
    if not segments:
        return []

    itinerary = _itinerary(segments, direction if not combo else "outbound")

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


def _itinerary(segments: list[FlightSegment], direction: str) -> FlightItinerary:
    durations = [s.duration_minutes for s in segments if s.duration_minutes is not None]
    total = sum(durations) if len(durations) == len(segments) else None
    return FlightItinerary(
        direction="inbound" if direction == "inbound" else "outbound",
        segments=segments,
        stops=max(len(segments) - 1, 0),
        duration_minutes=total,
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
