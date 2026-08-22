"""Normalized fare-review + traveller contract (PHASE 7).

Everything the browser may send lives here, and nothing else is accepted:
`CamelModel` sets `extra="forbid"`, so a request that smuggles `totalAmount`,
`price`, `currency` or `userId` is rejected with 422 before any handler runs.

Amounts NEVER travel inbound. The server resolves them from
`flight_review_sessions` / `search_result_refs`.
"""

from __future__ import annotations

import re
from datetime import date
from typing import List, Literal, Optional

from pydantic import Field, field_validator, model_validator

from app.schemas.flights import (
    CamelModel,
    FlightItinerary,
    Money,
    PassengerCounts,
)

PassengerType = Literal["adult", "child", "infant"]
ReviewStatus = Literal["reviewed", "price_changed"]

# Opaque handles. Length bounds only — the value itself is provider/server data.
TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-]{32,128}$")
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z .'\-]{0,49}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
PHONE_RE = re.compile(r"^\+?[0-9]{8,15}$")
PASSPORT_RE = re.compile(r"^[A-Za-z0-9]{5,20}$")
COUNTRY_RE = re.compile(r"^[A-Za-z]{2}$")
IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9_\-]{16,128}$")

MAX_TRAVELLERS = 9


# ----------------------------------------------------------------- select --


class FlightSelectionRequest(CamelModel):
    """Everything the browser is allowed to say about its choice."""

    # Our own search id (returned by /flights/search), not a provider token.
    search_id: str
    # Opaque provider fare handle echoed back from the search response. It is
    # only ever used to LOOK UP a server-side row; it never sets a price.
    fare_id: str = Field(min_length=1, max_length=256)
    # Lets a guest resume an existing review session in the same browser.
    guest_token: Optional[str] = None
    idempotency_key: Optional[str] = None

    @field_validator("search_id")
    @classmethod
    def _uuid(cls, value: str) -> str:
        value = value.strip()
        if not UUID_RE.match(value):
            raise ValueError("invalid_search_id")
        return value.lower()

    @field_validator("guest_token")
    @classmethod
    def _guest_token(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not TOKEN_RE.match(value or ""):
            raise ValueError("invalid_guest_token")
        return value

    @field_validator("idempotency_key")
    @classmethod
    def _idempotency(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not IDEMPOTENCY_RE.match(value or ""):
            raise ValueError("invalid_idempotency_key")
        return value


# ----------------------------------------------------------------- review --


class PriceChange(CamelModel):
    """Only ever produced by the server, after comparing two server values."""

    previous: Money
    current: Money
    difference: Money
    direction: Literal["increase", "decrease"]


class TravellerRequirements(CamelModel):
    """What the booking actually needs. Absent provider flags mean 'not required'."""

    passport_required: bool = False
    passport_expiry_required: bool = False
    nationality_required: bool = False
    date_of_birth_required: bool = False
    international: bool = False


class ReviewFare(CamelModel):
    total_price: Money
    base_price: Optional[Money] = None
    taxes: Optional[Money] = None
    other_charges: Optional[Money] = None
    fare_type: Optional[str] = None
    refundable: Optional[bool] = None
    conditions: Optional[List[str]] = None
    baggage_check_in: Optional[str] = None
    baggage_cabin: Optional[str] = None
    seats_available: Optional[int] = None


class FlightReviewResponse(CamelModel):
    """Server-authoritative review payload. All money originates server-side."""

    review_token: str
    # Returned exactly once, when a guest session is created.
    guest_token: Optional[str] = None
    status: ReviewStatus
    itineraries: List[FlightItinerary]
    fare: ReviewFare
    price_change: Optional[PriceChange] = None
    passengers: PassengerCounts
    requirements: TravellerRequirements = Field(default_factory=TravellerRequirements)
    expires_at: str
    valid_for_seconds: int


# -------------------------------------------------------------- travellers --


class TravellerInput(CamelModel):
    type: PassengerType
    title: Optional[str] = None
    first_name: str
    last_name: str
    date_of_birth: Optional[date] = None
    gender: Optional[Literal["male", "female", "other"]] = None
    nationality: Optional[str] = None
    passport_number: Optional[str] = None
    passport_expiry: Optional[date] = None
    passport_issuing_country: Optional[str] = None
    # Authenticated users may reuse a saved profile. Ownership of this id is
    # re-checked server-side against the verified token — never trusted.
    saved_traveller_id: Optional[str] = None
    save_to_profile: bool = False

    @field_validator("first_name", "last_name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not NAME_RE.match(value):
            raise ValueError("invalid_name")
        return value

    @field_validator("title")
    @classmethod
    def _title(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        cleaned = (value or "").strip().rstrip(".").title()
        if cleaned not in {"Mr", "Mrs", "Ms", "Miss", "Mstr"}:
            raise ValueError("invalid_title")
        return cleaned

    @field_validator("nationality", "passport_issuing_country")
    @classmethod
    def _country(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not COUNTRY_RE.match(value or ""):
            raise ValueError("invalid_country_code")
        return (value or "").upper()

    @field_validator("passport_number")
    @classmethod
    def _passport(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        cleaned = (value or "").strip().upper()
        if not PASSPORT_RE.match(cleaned):
            # The submitted value is deliberately NOT echoed in the error.
            raise ValueError("invalid_passport_number")
        return cleaned

    @field_validator("saved_traveller_id")
    @classmethod
    def _saved_id(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not UUID_RE.match(value or ""):
            raise ValueError("invalid_traveller_id")
        return (value or "").lower()

    @model_validator(mode="after")
    def _consistency(self) -> "TravellerInput":
        today = date.today()
        if self.date_of_birth and self.date_of_birth > today:
            raise ValueError("date_of_birth_in_future")
        if self.passport_expiry and self.passport_expiry <= today:
            raise ValueError("passport_expired")
        if self.passport_number and not (self.passport_expiry and self.passport_issuing_country):
            raise ValueError("passport_details_incomplete")
        return self


class ContactInput(CamelModel):
    email: str
    phone: str

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if len(cleaned) > 254 or not EMAIL_RE.match(cleaned):
            raise ValueError("invalid_email")
        return cleaned

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        cleaned = re.sub(r"[\s\-()]", "", value.strip())
        if not PHONE_RE.match(cleaned):
            raise ValueError("invalid_phone")
        return cleaned


class TravellerDetailsRequest(CamelModel):
    review_token: str
    guest_token: Optional[str] = None
    travellers: List[TravellerInput] = Field(min_length=1, max_length=MAX_TRAVELLERS + 9)
    contact: ContactInput
    # Consent only. The amount itself always comes from the server session.
    accept_price_change: bool = False
    idempotency_key: Optional[str] = None

    @field_validator("review_token")
    @classmethod
    def _token(cls, value: str) -> str:
        if not TOKEN_RE.match(value.strip()):
            raise ValueError("invalid_review_token")
        return value.strip()

    @field_validator("guest_token")
    @classmethod
    def _guest(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not TOKEN_RE.match(value or ""):
            raise ValueError("invalid_guest_token")
        return value

    @field_validator("idempotency_key")
    @classmethod
    def _idempotency(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not IDEMPOTENCY_RE.match(value or ""):
            raise ValueError("invalid_idempotency_key")
        return value


class TravellerDetailsResponse(CamelModel):
    """Draft state only — nothing here means a seat is held or paid for."""

    booking_reference: str
    status: Literal["awaiting_payment"]
    total_price: Money
    passengers: PassengerCounts
    traveller_count: int
    contact_email: str
    expires_at: str
    next_step: Literal["payment"] = "payment"
