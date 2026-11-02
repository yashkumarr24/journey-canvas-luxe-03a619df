"""TripJack fare review / pre-book adapter (PHASE 7).

Documented contract (TripJack Flights API v2.0, https://tripjack.com/page/api-doc):

    POST /fms/v1/review
    apikey: <key>
    { "priceIds": ["<priceId from air-search-all>"] }

The review call is TripJack's fare revalidation + pre-book step: it re-prices
the selected `priceId` against live inventory and returns the `bookingId`
handle that the later (PHASE 8) booking call consumes. It is NOT a ticket, it
holds no money, and it is never presented to the customer as a confirmation.

Response fields read here (everything else is ignored, nothing is invented):

    bookingId                                   provider pre-book handle
    tripInfos[].sI[]                            segments (same shape as search)
    tripInfos[].totalPriceList[]                per-option fare block
    totalPriceInfo.totalFareDetail.fC.BF/TAF/TF base / taxes / total
    alerts[]                                    provider notices (price/seat)
    conditions{}                                document requirements (see below)

Condition names follow the official Review table (supplied PDF page 3).
The existing fare/itinerary normalization remains unchanged: that reference
does not provide a full Review response or a FAREALERT amount example.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from app.core.logging import get_logger, log_extra
from app.integrations.tripjack.client import TripJackClient
from app.integrations.tripjack.flights import _itinerary, _segment  # normalization reuse
from app.integrations.tripjack.schemas import get_list, get_map, get_number, get_str
from app.schemas.flights import FlightItinerary
from app.schemas.review import ReviewFare, TravellerRequirements

logger = get_logger(__name__)

REVIEW_PATH = "fms/v1/review"

# TripJack quotes a 15-minute priceId validity; we advertise slightly less so a
# quote is never presented as live in its final seconds.
REVIEW_TTL = timedelta(minutes=14)

REFUNDABLE_BY_RT = {0: False, 1: True, 2: True}
REFUND_LABEL_BY_RT = {0: "Non-refundable", 1: "Refundable", 2: "Partially refundable"}

@dataclass(frozen=True)
class ReviewOutcome:
    """Provider-neutral result of a review call."""

    provider_booking_ref: Optional[str]
    total: Decimal
    base: Optional[Decimal]
    taxes: Optional[Decimal]
    itineraries: list[FlightItinerary]
    fare: ReviewFare
    requirements: TravellerRequirements
    conditions: dict[str, Any] = field(default_factory=dict)
    sellable: bool = True
    alerts: list[str] = field(default_factory=list)
    expires_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc) + REVIEW_TTL)


async def review_fare(
    client: TripJackClient,
    *,
    price_id: Optional[str] = None,
    price_ids: Optional[list[str]] = None,
    currency: str,
) -> ReviewOutcome:
    """Review the stored selection's IDs, never construct cross-leg combinations."""
    selected_ids = price_ids if price_ids is not None else [price_id] if price_id else []
    if not selected_ids or any(not isinstance(ref, str) or not ref.strip() for ref in selected_ids):
        raise ValueError("review_price_ids_required")
    body = await client.post(
        REVIEW_PATH,
        {"priceIds": selected_ids},
        retries=0,  # pre-book must not be duplicated by an automatic retry
        operation="air_review",
    )
    return normalize_review_response(body, currency=currency)


# --------------------------------------------------------------------------


def normalize_review_response(body: dict[str, Any], *, currency: str) -> ReviewOutcome:
    trips = get_list(body, "tripInfos")

    itineraries: list[FlightItinerary] = []
    price_blocks: list[dict[str, Any]] = []
    for index, trip in enumerate(trips):
        if not isinstance(trip, dict):
            continue
        segments = [seg for seg in (_segment(raw) for raw in get_list(trip, "sI")) if seg]
        if segments:
            itineraries.append(_itinerary(segments, "inbound" if index else "outbound"))
        for price in get_list(trip, "totalPriceList"):
            if isinstance(price, dict):
                price_blocks.append(price)

    total, base, taxes = _totals(body, price_blocks)
    alerts = _alerts(body)
    fare = _fare(price_blocks, total=total, base=base, taxes=taxes, currency=currency)

    outcome = ReviewOutcome(
        provider_booking_ref=get_str(body, "bookingId"),
        total=total,
        base=base,
        taxes=taxes,
        itineraries=itineraries,
        fare=fare,
        requirements=_requirements(body, itineraries),
        conditions=dict(get_map(body, "conditions")),
        # A review that produced no total is not sellable, whatever else it said.
        sellable=total > 0 and bool(itineraries) and bool(get_str(body, "bookingId")),
        alerts=alerts,
        expires_at=_expiry(get_map(body, "conditions")),
    )

    logger.info(
        "tripjack_review_normalized",
        extra=log_extra(
            itinerary_count=len(itineraries),
            has_provider_ref=bool(outcome.provider_booking_ref),
            alert_count=len(alerts),
        ),
    )
    return outcome


def _decimal(value: float | int | None) -> Optional[Decimal]:
    if value is None:
        return None
    # Money is quantized once, here, and stays Decimal from this point on.
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _totals(
    body: dict[str, Any],
    price_blocks: list[dict[str, Any]],
) -> tuple[Decimal, Optional[Decimal], Optional[Decimal]]:
    """Authoritative amount: `totalPriceInfo` first, per-trip fare as fallback."""
    components = get_map(get_map(body, "totalPriceInfo"), "totalFareDetail")
    fc = get_map(components, "fC")

    total = _decimal(get_number(fc, "TF"))
    base = _decimal(get_number(fc, "BF"))
    taxes = _decimal(get_number(fc, "TAF"))

    if total is None:
        summed = Decimal("0")
        found = False
        for price in price_blocks:
            pax_blocks = get_map(price, "fd", "fD")
            for pax in pax_blocks.values():
                block_total = _decimal(get_number(get_map(pax, "fC"), "TF")) if isinstance(pax, dict) else None
                if block_total is not None:
                    summed += block_total
                    found = True
        total = summed if found else Decimal("0")

    return total, base, taxes


def _alerts(body: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for alert in get_list(body, "alerts"):
        if not isinstance(alert, dict):
            continue
        kind = get_str(alert, "type", "alertType")
        if kind:
            out.append(kind.upper())
    return out


def _fare(
    price_blocks: list[dict[str, Any]],
    *,
    total: Decimal,
    base: Optional[Decimal],
    taxes: Optional[Decimal],
    currency: str,
) -> ReviewFare:
    adult: dict[str, Any] = {}
    fare_type: Optional[str] = None
    for price in price_blocks:
        fare_type = fare_type or get_str(price, "fareIdentifier")
        pax_blocks = get_map(price, "fd", "fD")
        candidate = get_map(pax_blocks, "ADULT")
        if not candidate:
            for value in pax_blocks.values():
                if isinstance(value, dict):
                    candidate = value
                    break
        if candidate and not adult:
            adult = candidate

    refundable_type = adult.get("rT") if isinstance(adult.get("rT"), int) else None
    baggage = get_map(adult, "bI")
    check_in = get_str(baggage, "iB")
    cabin = get_str(baggage, "cB")

    conditions: list[str] = []
    if refundable_type in REFUND_LABEL_BY_RT:
        conditions.append(REFUND_LABEL_BY_RT[refundable_type])
    if check_in:
        conditions.append(f"Check-in baggage: {check_in}")
    if cabin:
        conditions.append(f"Cabin baggage: {cabin}")

    other: Optional[Decimal] = None
    if base is not None and taxes is not None:
        remainder = (total - base - taxes).quantize(Decimal("0.01"))
        if remainder > 0:
            other = remainder

    seats = adult.get("sR") if isinstance(adult.get("sR"), int) else None

    return ReviewFare(
        total_price={"amount": float(total), "currency": currency},
        base_price={"amount": float(base), "currency": currency} if base is not None else None,
        taxes={"amount": float(taxes), "currency": currency} if taxes is not None else None,
        other_charges={"amount": float(other), "currency": currency} if other is not None else None,
        fare_type=fare_type,
        refundable=REFUNDABLE_BY_RT.get(refundable_type) if refundable_type is not None else None,
        conditions=conditions or None,
        baggage_check_in=check_in,
        baggage_cabin=cabin,
        seats_available=seats,
    )


def _expiry(conditions: dict[str, Any]) -> datetime:
    now = datetime.now(timezone.utc)
    seconds = conditions.get("st")
    if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds < 0:
        return now + REVIEW_TTL  # existing compatibility, not a claimed provider lifetime
    created = now
    timestamp = conditions.get("sct")
    if isinstance(timestamp, str):
        try:
            parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if parsed.tzinfo:
                created = min(now, parsed)
        except ValueError:
            pass
    try:
        return created + timedelta(seconds=seconds)
    except OverflowError:
        return now  # malformed duration must not extend validity


def _requirements(body: dict[str, Any], itineraries: list[FlightItinerary]) -> TravellerRequirements:
    conditions = get_map(body, "conditions")

    countries = {
        airport.country
        for itinerary in itineraries
        for segment in itinerary.segments
        for airport in (segment.origin, segment.destination)
        if airport and airport.country
    }
    international = len(countries) > 1
    return TravellerRequirements(
        passport_required=conditions.get("pm") is True,
        passport_expiry_required=conditions.get("pped") is True,
        adult_dob_required=conditions.get("adobr") is True,
        child_dob_required=conditions.get("cdobr") is True,
        infant_dob_required=conditions.get("idobr") is True,
        international=international,
    )
