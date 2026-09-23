"""Our own normalized hotel contract (request + response).

This mirrors `src/types/booking.ts` (HotelSearchRequest ... HotelGuestDetailsResponse)
field for field, in camelCase. TripJack's hotel wire format never crosses this
boundary.

Same money rule as flights: amounts NEVER travel inbound. `extra="forbid"` on
`CamelModel` means a request that smuggles `totalPrice`, `currency` or `userId`
is rejected with 422 before any handler runs. The payable amount is always
resolved from the server-side review session.
"""

from __future__ import annotations

import re
from datetime import date
from typing import List, Literal, Optional

from pydantic import Field, field_validator, model_validator

from app.schemas.flights import CamelModel, Money
from app.schemas.review import (
    COUNTRY_RE,
    EMAIL_RE,
    IDEMPOTENCY_RE,
    NAME_RE,
    PHONE_RE,
    TOKEN_RE,
    UUID_RE,
    ContactInput,
    PriceChange,
)

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
PASSPORT_RE = re.compile(r"^[A-Za-z0-9]{5,20}$")
RATE_ID_RE = re.compile(r"^[A-Za-z0-9_\-:.=|/+]{1,512}$")

MAX_ROOMS = 6
MAX_ADULTS_PER_ROOM = 6
MAX_CHILDREN_PER_ROOM = 4
MAX_NIGHTS = 30
MAX_ADVANCE_DAYS = 500
MAX_GUESTS = (MAX_ADULTS_PER_ROOM + MAX_CHILDREN_PER_ROOM) * MAX_ROOMS

HotelGuestType = Literal["adult", "child"]
HotelReviewStatus = Literal["reviewed", "price_changed"]


# ---------------------------------------------------------------- shared --


class HotelOccupancy(CamelModel):
    adults: int = Field(default=1, ge=1, le=MAX_ADULTS_PER_ROOM)
    child_ages: List[int] = Field(default_factory=list, max_length=MAX_CHILDREN_PER_ROOM)

    @field_validator("child_ages")
    @classmethod
    def _ages(cls, value: List[int]) -> List[int]:
        for age in value:
            if age < 0 or age > 17:
                raise ValueError("invalid_child_age")
        return value


class HotelImage(CamelModel):
    """Provider-supplied media only. We never substitute a stock photo."""

    url: str
    caption: Optional[str] = None


class HotelLocation(CamelModel):
    address: Optional[str] = None
    area: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    landmark: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class HotelRateSummary(CamelModel):
    total_price: Money
    per_night_price: Optional[Money] = None
    meal_plan: Optional[str] = None
    refundable: Optional[bool] = None
    free_cancellation_until: Optional[str] = None
    room_name: Optional[str] = None
    rooms_available: Optional[int] = None
    # v3 rate plan type this rate came from (CHEAPEST, FREE_CANCELLATION, ...).
    rate_plan_type: Optional[str] = None
    rate_plan_label: Optional[str] = None


class HotelRatePlan(CamelModel):
    """One of the five Hotel API v3 rate plan types offered for a hotel.

    `option_id` is the provider's opaque handle. It is never a price and is
    always re-priced server-side before anyone can pay.
    """

    type: str
    label: str
    option_id: str
    total_price: Money
    per_night_price: Optional[Money] = None
    meal_plan: Optional[str] = None
    refundable: Optional[bool] = None
    free_cancellation_until: Optional[str] = None
    room_name: Optional[str] = None
    pan_required: Optional[bool] = None
    breakfast_included: Optional[bool] = None
    gst_inclusive: Optional[bool] = None


class HotelSummary(CamelModel):
    id: str
    name: str
    star_rating: Optional[float] = None
    property_type: Optional[str] = None
    location: Optional[HotelLocation] = None
    thumbnail_url: Optional[str] = None
    images: Optional[List[HotelImage]] = None


class HotelResult(HotelSummary):
    amenities: Optional[List[str]] = None
    review_score: Optional[float] = None
    review_count: Optional[int] = None
    rate: Optional[HotelRateSummary] = None
    # All v3 rate plan types the provider returned, not only the cheapest.
    rate_plans: Optional[List[HotelRatePlan]] = None


class HotelCancellationRule(CamelModel):
    from_: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None
    charge: Optional[Money] = None
    description: Optional[str] = None


class HotelCancellationPolicy(CamelModel):
    refundable: bool = False
    summary: Optional[str] = None
    free_cancellation_until: Optional[str] = None
    rules: Optional[List[HotelCancellationRule]] = None


class HotelRoomOption(CamelModel):
    """One sellable room/rate. `id` is an opaque handle, never a price."""

    id: str
    room_name: str
    room_type: Optional[str] = None
    bed_type: Optional[str] = None
    occupancy: HotelOccupancy = Field(default_factory=HotelOccupancy)
    room_count: int = 1
    meal_plan: Optional[str] = None
    inclusions: Optional[List[str]] = None
    cancellation: HotelCancellationPolicy = Field(default_factory=HotelCancellationPolicy)
    base_price: Optional[Money] = None
    taxes: Optional[Money] = None
    fees_and_charges: Optional[Money] = None
    # v3 management fee and its tax. Both are part of `total_price`.
    management_fee: Optional[Money] = None
    management_fee_tax: Optional[Money] = None
    total_price: Money
    rooms_available: Optional[int] = None
    payment_policy: Optional[str] = None
    # v3 option metadata.
    option_type: Optional[str] = None
    option_type_label: Optional[str] = None
    rate_plan_type: Optional[str] = None
    rate_plan_label: Optional[str] = None
    # Provider-declared guest requirements for THIS rate.
    pan_required: Optional[bool] = None
    passport_required: Optional[bool] = None
    gst_inclusive: Optional[bool] = None
    breakfast_included: Optional[bool] = None


class HotelDetail(HotelResult):
    description: Optional[str] = None
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    facilities: Optional[List[str]] = None
    policies: Optional[List[str]] = None
    rooms: List[HotelRoomOption] = Field(default_factory=list)


class FareBreakdownLine(CamelModel):
    label: str
    amount: Money
    kind: Optional[Literal["base", "tax", "fee", "discount"]] = None
    note: Optional[str] = None


# --------------------------------------------------------------- search --


class HotelSearchRequest(CamelModel):
    destination: str = Field(min_length=2, max_length=80)
    check_in: date
    check_out: date
    rooms: List[HotelOccupancy] = Field(min_length=1, max_length=MAX_ROOMS)
    nationality: Optional[str] = None
    currency: Optional[str] = None

    @field_validator("destination")
    @classmethod
    def _destination(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        # Free text is resolved server-side; keep it to plain place characters
        # so nothing resembling a payload reaches the provider.
        if not re.match(r"^[A-Za-z0-9 .,'\-()]{2,80}$", cleaned):
            raise ValueError("invalid_destination")
        return cleaned

    @field_validator("nationality", "currency")
    @classmethod
    def _upper_code(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        cleaned = (value or "").strip().upper()
        if not re.match(r"^[A-Z]{3}$", cleaned) and not COUNTRY_RE.match(cleaned):
            raise ValueError("invalid_code")
        return cleaned

    @model_validator(mode="after")
    def _dates(self) -> "HotelSearchRequest":
        today = date.today()
        if self.check_in < today:
            raise ValueError("check_in_in_past")
        if self.check_out <= self.check_in:
            raise ValueError("check_out_before_check_in")
        if (self.check_out - self.check_in).days > MAX_NIGHTS:
            raise ValueError("stay_too_long")
        if (self.check_in - today).days > MAX_ADVANCE_DAYS:
            raise ValueError("check_in_too_far_ahead")
        return self

    @property
    def nights(self) -> int:
        return (self.check_out - self.check_in).days


class HotelSearchResponse(CamelModel):
    search_id: Optional[str] = None
    results: List[HotelResult] = Field(default_factory=list)
    currency: Optional[str] = None
    expires_at: Optional[str] = None
    nights: Optional[int] = None
    amenities: Optional[List[str]] = None
    property_types: Optional[List[str]] = None


# --------------------------------------------------------------- detail --


class HotelDetailRequest(CamelModel):
    search_id: str
    hotel_id: str = Field(min_length=1, max_length=256)

    @field_validator("search_id")
    @classmethod
    def _session(cls, value: str) -> str:
        cleaned = value.strip()
        if not (TOKEN_RE.match(cleaned) or UUID_RE.match(cleaned)):
            raise ValueError("invalid_search_id")
        return cleaned


class HotelDetailResponse(CamelModel):
    search_id: Optional[str] = None
    hotel: HotelDetail
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    nights: Optional[int] = None
    currency: Optional[str] = None
    expires_at: Optional[str] = None


# ------------------------------------------------------ select / review --


class HotelSelectionRequest(CamelModel):
    search_id: str
    hotel_id: str = Field(min_length=1, max_length=256)
    rate_id: str = Field(min_length=1, max_length=512)
    guest_token: Optional[str] = None
    idempotency_key: Optional[str] = None

    @field_validator("search_id")
    @classmethod
    def _session(cls, value: str) -> str:
        cleaned = value.strip()
        if not (TOKEN_RE.match(cleaned) or UUID_RE.match(cleaned)):
            raise ValueError("invalid_search_id")
        return cleaned

    @field_validator("rate_id")
    @classmethod
    def _rate(cls, value: str) -> str:
        cleaned = value.strip()
        if not RATE_ID_RE.match(cleaned):
            raise ValueError("invalid_rate_id")
        return cleaned

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


class HotelStay(CamelModel):
    check_in: str
    check_out: str
    nights: int
    rooms: List[HotelOccupancy] = Field(default_factory=list)


class HotelGuestRequirements(CamelModel):
    """What the booking actually needs. Absent provider flags mean 'not required'."""

    pan_required: bool = False
    passport_required: bool = False
    nationality_required: bool = False
    date_of_birth_required: bool = False
    all_guest_names_required: bool = False
    international: bool = False


class HotelReviewResponse(CamelModel):
    review_token: str
    guest_token: Optional[str] = None
    status: HotelReviewStatus
    hotel: HotelSummary
    room: HotelRoomOption
    stay: HotelStay
    breakdown: List[FareBreakdownLine] = Field(default_factory=list)
    total_payable: Money
    price_change: Optional[PriceChange] = None
    requirements: HotelGuestRequirements = Field(default_factory=HotelGuestRequirements)
    expires_at: str
    valid_for_seconds: int


# --------------------------------------------------------------- guests --


class HotelGuestInput(CamelModel):
    type: HotelGuestType
    room_index: int = Field(ge=1, le=MAX_ROOMS)
    is_lead: bool = False
    title: Optional[str] = None
    first_name: str
    last_name: str
    age: Optional[int] = Field(default=None, ge=0, le=120)
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = None
    pan_number: Optional[str] = None
    passport_number: Optional[str] = None
    saved_traveller_id: Optional[str] = None
    save_to_profile: bool = False

    @field_validator("first_name", "last_name")
    @classmethod
    def _name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not NAME_RE.match(cleaned):
            raise ValueError("invalid_name")
        return cleaned

    @field_validator("title")
    @classmethod
    def _title(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        cleaned = (value or "").strip().rstrip(".").title()
        if cleaned not in {"Mr", "Mrs", "Ms", "Miss", "Mstr"}:
            raise ValueError("invalid_title")
        return cleaned

    @field_validator("nationality")
    @classmethod
    def _country(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not COUNTRY_RE.match(value or ""):
            raise ValueError("invalid_country_code")
        return (value or "").upper()

    @field_validator("pan_number")
    @classmethod
    def _pan(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        cleaned = (value or "").strip().upper()
        # The submitted value is deliberately NOT echoed back in the error.
        if not PAN_RE.match(cleaned):
            raise ValueError("invalid_pan_number")
        return cleaned

    @field_validator("passport_number")
    @classmethod
    def _passport(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        cleaned = (value or "").strip().upper()
        if not PASSPORT_RE.match(cleaned):
            raise ValueError("invalid_passport_number")
        return cleaned

    @field_validator("saved_traveller_id")
    @classmethod
    def _saved(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not UUID_RE.match(value or ""):
            raise ValueError("invalid_traveller_id")
        return (value or "").lower()

    @model_validator(mode="after")
    def _consistency(self) -> "HotelGuestInput":
        if self.date_of_birth and self.date_of_birth > date.today():
            raise ValueError("date_of_birth_in_future")
        if self.type == "child" and self.age is None and self.date_of_birth is None:
            raise ValueError("child_age_required")
        return self


class HotelContactInput(ContactInput):
    dial_code: Optional[str] = None

    @field_validator("dial_code")
    @classmethod
    def _dial(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        cleaned = (value or "").strip()
        if not re.match(r"^\+?[0-9]{1,4}$", cleaned):
            raise ValueError("invalid_dial_code")
        return cleaned if cleaned.startswith("+") else f"+{cleaned}"


class HotelGuestDetailsRequest(CamelModel):
    review_token: str
    guest_token: Optional[str] = None
    guests: List[HotelGuestInput] = Field(min_length=1, max_length=MAX_GUESTS)
    contact: HotelContactInput
    special_requests: Optional[str] = Field(default=None, max_length=500)
    # Consent only. The amount itself always comes from the server session.
    accept_price_change: bool = False
    idempotency_key: Optional[str] = None

    @field_validator("review_token")
    @classmethod
    def _token(cls, value: str) -> str:
        cleaned = value.strip()
        if not TOKEN_RE.match(cleaned):
            raise ValueError("invalid_review_token")
        return cleaned

    @field_validator("guest_token")
    @classmethod
    def _guest(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not TOKEN_RE.match(value or ""):
            raise ValueError("invalid_guest_token")
        return value

    @field_validator("special_requests")
    @classmethod
    def _requests(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        cleaned = " ".join((value or "").split())
        if re.search(r"[<>{}]", cleaned):
            raise ValueError("invalid_special_requests")
        return cleaned

    @field_validator("idempotency_key")
    @classmethod
    def _idempotency(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        if not IDEMPOTENCY_RE.match(value or ""):
            raise ValueError("invalid_idempotency_key")
        return value


class HotelGuestDetailsResponse(CamelModel):
    """Draft state only — nothing here means a room is held or paid for."""

    booking_reference: str
    status: Literal["awaiting_payment"] = "awaiting_payment"
    total_price: Money
    guest_count: int
    contact_email: str
    expires_at: str
    next_step: Literal["payment"] = "payment"


__all__ = [
    "EMAIL_RE",
    "PHONE_RE",
    "FareBreakdownLine",
    "HotelCancellationPolicy",
    "HotelCancellationRule",
    "HotelContactInput",
    "HotelDetail",
    "HotelDetailRequest",
    "HotelDetailResponse",
    "HotelGuestDetailsRequest",
    "HotelGuestDetailsResponse",
    "HotelGuestInput",
    "HotelGuestRequirements",
    "HotelImage",
    "HotelLocation",
    "HotelOccupancy",
    "HotelRatePlan",
    "HotelRateSummary",
    "HotelResult",
    "HotelReviewResponse",
    "HotelRoomOption",
    "HotelSearchRequest",
    "HotelSearchResponse",
    "HotelSelectionRequest",
    "HotelStay",
    "HotelSummary",
]
