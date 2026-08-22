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

`conditions` key naming is not fully specified in the public reference, so the
requirement extraction below probes a small set of candidate keys and treats an
ABSENT flag as "not required" rather than guessing a stricter or looser rule.
This gap is reported to the operator rather than papered over.
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

# Candidate flag names probed defensively (see module docstring).
PASSPORT_FLAGS = ("isPassportRequired", "ipa", "isPassportFullDetailRequired", "ipfdr")
PASSPORT_EXPIRY_FLAGS = ("isPassportExpiryRequired", "iper", "isPassportFullDetailRequired", "ipfdr")
DOB_FLAGS = ("isDobRequired", "idr", "isDobRequiredForAdult")
NATIONALITY_FLAGS = ("isNationalityRequired", "inr")


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
    sellable: bool = True
    alerts: list[str] = field(default_factory=list)
    expires_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc) + REVIEW_TTL)


async def review_fare(
    client: TripJackClient,
    *,
    price_id: str,
    currency: str,
) -> ReviewOutcome:
    """Re-price one fare with TripJack. Never retried: it is transactional."""
    body = await client.post(
        REVIEW_PATH,
        {"priceIds": [price_id]},
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
        # A review that produced no total is not sellable, whatever else it said.
        sellable=total > 0 and bool(itineraries),
        alerts=alerts,
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


def _flag(source: dict[str, Any], names: tuple[str, ...]) -> bool:
    for name in names:
        value = source.get(name)
        if isinstance(value, bool):
            return value
    return False


def _requirements(body: dict[str, Any], itineraries: list[FlightItinerary]) -> TravellerRequirements:
    conditions = get_map(body, "conditions")

    countries = {
        airport.country
        for itinerary in itineraries
        for segment in itinerary.segments
        for airport in (segment.origin, segment.destination)
        if airport and airport.country
    }
    # Route-derived signal only; it never RELAXES a provider flag.
    international = len(countries) > 1

    passport = _flag(conditions, PASSPORT_FLAGS) or international
    return TravellerRequirements(
        passport_required=passport,
        passport_expiry_required=passport or _flag(conditions, PASSPORT_EXPIRY_FLAGS),
        nationality_required=passport or _flag(conditions, NATIONALITY_FLAGS),
        date_of_birth_required=_flag(conditions, DOB_FLAGS) or international,
        international=international,
    )
