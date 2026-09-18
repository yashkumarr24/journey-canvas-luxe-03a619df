"""AI Travel Assistant contracts (PHASE 12).

The assistant produces SEARCH INTENT only. There is deliberately no place in
these schemas for a fare, a fare id, a price, a schedule or a baggage rule:
those exist only in flight-search responses produced by the provider adapter.

Everything crossing the wire is bounded and validated so AI-generated content
can never drive an arbitrary provider request.
"""

from __future__ import annotations

import re
from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

CabinClass = Literal["economy", "premium_economy", "business", "first"]
TripType = Literal["oneway", "roundtrip"]
TimeWindow = Literal["early_morning", "morning", "afternoon", "evening", "night"]
BaggagePreference = Literal["checked_baggage", "cabin_only"]
AssistantProduct = Literal["flights", "hotels"]
ResultSortPreference = Literal["recommended", "cheapest", "fastest"]

MAX_MESSAGE_LENGTH = 500
MAX_HISTORY = 8
MAX_PASSENGERS = 9

_IATA = re.compile(r"^[A-Z]{3}$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _clean(value: str, limit: int = MAX_MESSAGE_LENGTH) -> str:
    """Strip control characters, collapse whitespace and cap length."""
    return " ".join(_CONTROL.sub(" ", value).split())[:limit]


class TravelRequirements(BaseModel):
    products: List[AssistantProduct] = Field(default_factory=lambda: ["flights"])
    """Structured requirements. Every field optional — gaps are asked about."""

    trip_type: Optional[TripType] = Field(default=None, alias="tripType")
    origin: Optional[str] = None
    origin_label: Optional[str] = Field(default=None, alias="originLabel")
    destination: Optional[str] = None
    destination_label: Optional[str] = Field(default=None, alias="destinationLabel")
    departure_date: Optional[date] = Field(default=None, alias="departureDate")
    return_date: Optional[date] = Field(default=None, alias="returnDate")
    duration_nights: Optional[int] = Field(default=None, alias="durationNights", ge=1, le=90)
    adults: Optional[int] = Field(default=None, ge=1, le=MAX_PASSENGERS)
    children: Optional[int] = Field(default=None, ge=0, le=MAX_PASSENGERS)
    infants: Optional[int] = Field(default=None, ge=0, le=MAX_PASSENGERS)
    cabin_class: Optional[CabinClass] = Field(default=None, alias="cabinClass")
    preferred_departure_window: Optional[TimeWindow] = Field(
        default=None, alias="preferredDepartureWindow"
    )
    preferred_arrival_window: Optional[TimeWindow] = Field(
        default=None, alias="preferredArrivalWindow"
    )
    preferred_return_window: Optional[TimeWindow] = Field(
        default=None, alias="preferredReturnWindow"
    )
    non_stop_only: Optional[bool] = Field(default=None, alias="nonStopOnly")
    baggage_preference: Optional[BaggagePreference] = Field(default=None, alias="baggagePreference")
    preferred_airlines: List[str] = Field(default_factory=list, alias="preferredAirlines")
    hotel_destination: Optional[str] = Field(default=None, alias="hotelDestination")
    hotel_location_preference: Optional[str] = Field(default=None, alias="hotelLocationPreference")
    result_sort: Optional[ResultSortPreference] = Field(default=None, alias="resultSort")
    notes: List[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True, "extra": "ignore"}

    @field_validator("origin", "destination")
    @classmethod
    def _iata(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        code = value.strip().upper()
        if not _IATA.match(code):
            raise ValueError("Airport codes must be 3 letters.")
        return code

    @field_validator("origin_label", "destination_label", "hotel_destination", "hotel_location_preference")
    @classmethod
    def _label(cls, value: Optional[str]) -> Optional[str]:
        return _clean(value, 60) if value else None

    @field_validator("preferred_airlines", "notes")
    @classmethod
    def _short_list(cls, value: List[str]) -> List[str]:
        return [_clean(item, 60) for item in value[:5] if item.strip()]

    @model_validator(mode="after")
    def _coherent(self) -> "TravelRequirements":
        if self.origin and self.destination and self.origin == self.destination:
            raise ValueError("Origin and destination must be different.")
        if self.departure_date and self.return_date and self.return_date < self.departure_date:
            raise ValueError("The return date cannot be before the departure date.")
        adults = self.adults or 1
        if (self.infants or 0) > adults:
            raise ValueError("Each infant must be accompanied by an adult.")
        if adults + (self.children or 0) > MAX_PASSENGERS:
            raise ValueError(f"A single booking can hold up to {MAX_PASSENGERS} travellers.")
        return self


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str

    model_config = {"extra": "ignore"}

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return _clean(value)


class AssistantTurnRequest(BaseModel):
    message: str
    requirements: TravelRequirements = Field(default_factory=TravelRequirements)
    history: List[HistoryTurn] = Field(default_factory=list)

    model_config = {"extra": "ignore"}

    @field_validator("message")
    @classmethod
    def _message(cls, value: str) -> str:
        cleaned = _clean(value)
        if not cleaned:
            raise ValueError("Please include a message.")
        return cleaned

    @field_validator("history")
    @classmethod
    def _history(cls, value: List[HistoryTurn]) -> List[HistoryTurn]:
        return value[-MAX_HISTORY:]


class MissingRequirement(BaseModel):
    field: Literal[
        "origin", "destination", "departureDate", "returnDate", "passengers", "cabinClass"
    ]
    prompt: str


class AssistantTurnResponse(BaseModel):
    reply: str
    requirements: TravelRequirements
    missing: List[MissingRequirement] = Field(default_factory=list)
    ready: bool = False
    suggestions: List[str] = Field(default_factory=list)
    provider: Literal["demo", "ai"] = "demo"

    model_config = {"populate_by_name": True}
