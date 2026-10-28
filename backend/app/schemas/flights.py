"""Our own normalized flight contract (request + response).

This is the ONLY flight shape the frontend ever sees. TripJack's wire format
never crosses this boundary. Field names are camelCase to match
src/types/booking.ts exactly.

Validation here is authoritative: React/Zod validation is a UX convenience
and is re-checked in full on the server.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

IATA_RE = re.compile(r"^[A-Z]{3}$")
AIRLINE_RE = re.compile(r"^[A-Z0-9]{2}$")  # airline IATA codes are 2 chars (6E, AI, EK)
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")

MAX_SEATED_PAX = 9  # TripJack error 1006: passengers cannot exceed 9
MAX_ADVANCE_DAYS = 361
MIN_MULTI_CITY_LEGS = 2
MAX_MULTI_CITY_LEGS = 6  # TripJack documents 2-6 routeInfos for multi-city
MAX_PREFERRED_AIRLINES = 10  # documented preferredAirline cap

TripType = Literal["oneway", "roundtrip", "multicity"]
CabinClass = Literal["economy", "premium_economy", "business", "first"]
# Documented searchModifiers.pfts values (default: REGULAR).
PassengerFareType = Literal["REGULAR", "STUDENT", "SENIOR_CITIZEN"]


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_camel,
        populate_by_name=True,
        extra="forbid",  # unexpected fields are rejected, not silently ignored
    )


# ---------------------------------------------------------------- request --


class PassengerCounts(CamelModel):
    adults: int = Field(default=1, ge=1, le=MAX_SEATED_PAX)
    children: int = Field(default=0, ge=0, le=MAX_SEATED_PAX)
    infants: int = Field(default=0, ge=0, le=MAX_SEATED_PAX)

    @model_validator(mode="after")
    def _check_combination(self) -> "PassengerCounts":
        # Mirrors TripJack 1001/1006: infants ride on an adult's lap, and the
        # seated total is capped at 9.
        if self.infants > self.adults:
            raise ValueError("infants_exceed_adults")
        if self.adults + self.children > MAX_SEATED_PAX:
            raise ValueError("too_many_passengers")
        return self


class FlightRouteLeg(CamelModel):
    """One multi-city leg -> one TripJack routeInfos entry."""

    origin: str
    destination: str
    departure_date: date

    @field_validator("origin", "destination", mode="before")
    @classmethod
    def _normalize_iata(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip().upper()
            if not IATA_RE.match(value):
                raise ValueError("invalid_airport_code")
        return value

    @model_validator(mode="after")
    def _check_leg(self) -> "FlightRouteLeg":
        if self.origin == self.destination:
            raise ValueError("same_origin_destination")  # TripJack 1005
        today = date.today()
        if self.departure_date < today:
            raise ValueError("departure_in_past")
        if self.departure_date > today + timedelta(days=MAX_ADVANCE_DAYS):
            raise ValueError("departure_too_far_ahead")
        return self


class FlightSearchRequest(CamelModel):
    trip_type: TripType
    # Required for oneway/roundtrip; for multicity they are derived from legs
    # (first origin, last destination, first date) so every downstream consumer
    # keeps working with the same scalar fields.
    origin: Optional[str] = None
    destination: Optional[str] = None
    departure_date: Optional[date] = None
    return_date: Optional[date] = None
    # Multi-city legs (2-6), in travel order. Only valid with trip_type
    # "multicity"; forbidden otherwise.
    legs: Optional[List[FlightRouteLeg]] = None
    passengers: PassengerCounts = Field(default_factory=PassengerCounts)
    cabin_class: CabinClass = "economy"
    currency: Optional[str] = None
    # Documented optional search modifiers.
    direct_only: bool = False
    connecting_only: bool = False
    pfts: Optional[List[PassengerFareType]] = None
    preferred_airlines: Optional[List[str]] = None

    @field_validator("origin", "destination", mode="before")
    @classmethod
    def _normalize_iata(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            value = value.strip().upper()
            if not IATA_RE.match(value):
                raise ValueError("invalid_airport_code")
        return value

    @field_validator("preferred_airlines", mode="before")
    @classmethod
    def _normalize_airlines(cls, value: object) -> object:
        if value in (None, ""):
            return None
        if isinstance(value, list):
            cleaned = []
            for item in value:
                if not isinstance(item, str):
                    raise ValueError("invalid_airline_code")
                code = item.strip().upper()
                if not AIRLINE_RE.match(code):
                    raise ValueError("invalid_airline_code")
                if code not in cleaned:
                    cleaned.append(code)
            return cleaned or None
        return value

    @field_validator("currency", mode="before")
    @classmethod
    def _normalize_currency(cls, value: object) -> object:
        if value in (None, ""):
            return None
        if isinstance(value, str):
            value = value.strip().upper()
            if not CURRENCY_RE.match(value):
                raise ValueError("invalid_currency")
        return value

    @model_validator(mode="after")
    def _check_route_and_dates(self) -> "FlightSearchRequest":
        if self.direct_only and self.connecting_only:
            # Contradictory searchModifiers — TripJack documents them as
            # mutually exclusive filters.
            raise ValueError("conflicting_flight_modifiers")
        if self.preferred_airlines and len(self.preferred_airlines) > MAX_PREFERRED_AIRLINES:
            raise ValueError("too_many_preferred_airlines")

        if self.trip_type == "multicity":
            return self._check_multicity()

        if self.legs is not None:
            raise ValueError("legs_require_multicity")
        if self.origin is None or self.destination is None or self.departure_date is None:
            raise ValueError("route_required")

        if self.origin == self.destination:
            raise ValueError("same_origin_destination")  # TripJack 1005

        today = date.today()
        if self.departure_date < today:
            raise ValueError("departure_in_past")
        if self.departure_date > today + timedelta(days=MAX_ADVANCE_DAYS):
            raise ValueError("departure_too_far_ahead")

        if self.trip_type == "roundtrip":
            if self.return_date is None:
                raise ValueError("return_date_required")
            if self.return_date < self.departure_date:
                raise ValueError("return_before_departure")  # TripJack 1003
            if self.return_date > today + timedelta(days=MAX_ADVANCE_DAYS):
                raise ValueError("return_too_far_ahead")
        elif self.return_date is not None:
            raise ValueError("return_date_not_allowed")

        return self

    def _check_multicity(self) -> "FlightSearchRequest":
        if self.return_date is not None:
            raise ValueError("return_date_not_allowed")
        if not self.legs or not (MIN_MULTI_CITY_LEGS <= len(self.legs) <= MAX_MULTI_CITY_LEGS):
            raise ValueError("invalid_leg_count")
        # Legs must be chronological; same-day onward legs are allowed, so the
        # check is non-decreasing rather than strictly increasing.
        for previous, current in zip(self.legs, self.legs[1:]):
            if current.departure_date < previous.departure_date:
                raise ValueError("legs_not_chronological")
        # Derive the scalar summary fields so logging, persistence and the
        # response contract stay identical to one-way/round-trip.
        self.origin = self.legs[0].origin
        self.destination = self.legs[-1].destination
        self.departure_date = self.legs[0].departure_date
        return self


# --------------------------------------------------------------- response --


class Money(CamelModel):
    amount: float
    currency: str


class AirlineRef(CamelModel):
    code: str
    name: Optional[str] = None


class AirportRef(CamelModel):
    code: str
    name: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    terminal: Optional[str] = None


class BaggageAllowance(CamelModel):
    check_in: Optional[str] = None
    cabin: Optional[str] = None


class FlightSegment(CamelModel):
    id: str
    airline: AirlineRef
    flight_number: Optional[str] = None
    aircraft: Optional[str] = None
    origin: AirportRef
    destination: AirportRef
    departure_at: str
    arrival_at: str
    duration_minutes: Optional[int] = None
    cabin_class: Optional[CabinClass] = None
    baggage: Optional[BaggageAllowance] = None


class FlightItinerary(CamelModel):
    # "leg" is used for indexed multi-city response groups; leg_index is the
    # provider's numeric group key when it is parseable, else omitted.
    direction: Literal["outbound", "inbound", "leg"]
    segments: List[FlightSegment]
    stops: Optional[int] = None
    duration_minutes: Optional[int] = None
    leg_index: Optional[int] = None


class FlightFare(CamelModel):
    # TripJack priceId. Opaque to the browser and only valid for 15 minutes;
    # it is a re-pricing handle, never an authorization token.
    fare_id: Optional[str] = None
    total_price: Money
    base_price: Optional[Money] = None
    taxes: Optional[Money] = None
    refundable: Optional[bool] = None
    fare_type: Optional[str] = None
    conditions: Optional[List[str]] = None
    seats_available: Optional[int] = None


class FlightResult(CamelModel):
    id: str
    itineraries: List[FlightItinerary]
    fare: FlightFare
    validating_airline: Optional[AirlineRef] = None


class FlightSearchResponse(CamelModel):
    search_id: Optional[str] = None
    results: List[FlightResult] = Field(default_factory=list)
    airlines: Optional[List[AirlineRef]] = None
    currency: Optional[str] = None
    expires_at: Optional[str] = None
