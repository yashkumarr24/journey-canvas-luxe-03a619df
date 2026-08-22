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
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")

MAX_SEATED_PAX = 9  # TripJack error 1006: passengers cannot exceed 9
MAX_ADVANCE_DAYS = 361

TripType = Literal["oneway", "roundtrip"]
CabinClass = Literal["economy", "premium_economy", "business", "first"]


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


class FlightSearchRequest(CamelModel):
    trip_type: TripType
    origin: str
    destination: str
    departure_date: date
    return_date: Optional[date] = None
    passengers: PassengerCounts = Field(default_factory=PassengerCounts)
    cabin_class: CabinClass = "economy"
    currency: Optional[str] = None
    direct_only: bool = False

    @field_validator("origin", "destination", mode="before")
    @classmethod
    def _normalize_iata(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip().upper()
            if not IATA_RE.match(value):
                raise ValueError("invalid_airport_code")
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
    direction: Literal["outbound", "inbound"]
    segments: List[FlightSegment]
    stops: Optional[int] = None
    duration_minutes: Optional[int] = None


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
