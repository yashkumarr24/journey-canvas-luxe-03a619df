"""Browser-facing hotel booking contract. Provider handles never appear here."""

from __future__ import annotations

import re
from typing import Any, List, Literal, Optional

from pydantic import Field, field_validator

from app.schemas.flights import CamelModel
from app.schemas.flights import Money

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
REF_RE = re.compile(r"^FNFH[0-9A-F]{6}$")

# Lifecycle -> the status vocabulary the website already renders.
PUBLIC_STATUS = {
    "DRAFT": "awaiting_payment",
    "REVIEWED": "booking_processing",
    "BOOKING_IN_PROGRESS": "booking_processing",
    "CONFIRMED": "confirmed",
    "ON_HOLD": "on_hold",
    "CONFIRMING": "confirming",
    "FAILED": "failed",
    "ABORTED": "failed",
    "CANCELLATION_REQUESTED": "cancellation_pending",
    "CANCELLATION_PENDING": "cancellation_pending",
    "CANCELLED": "cancelled",
}


class HotelBookRequest(CamelModel):
    booking_reference: str
    guest_token: Optional[str] = None
    mode: Literal["instant", "hold"] = "instant"
    idempotency_key: Optional[str] = Field(default=None, max_length=128)
    # Payment proof fields kept for the existing checkout contract. They are NOT
    # verified yet; production refuses instant booking until verification exists.
    provider: Optional[str] = None
    order_id: Optional[str] = Field(default=None, max_length=128)
    payment_id: Optional[str] = Field(default=None, max_length=128)
    signature: Optional[str] = Field(default=None, max_length=256)

    @field_validator("booking_reference")
    @classmethod
    def _ref(cls, v: str) -> str:
        v = v.strip().upper()
        if not REF_RE.match(v):
            raise ValueError("invalid_booking_reference")
        return v

    @field_validator("guest_token")
    @classmethod
    def _guest(cls, v: Optional[str]) -> Optional[str]:
        if v in (None, ""):
            return None
        if not TOKEN_RE.match(v or ""):
            raise ValueError("invalid_guest_token")
        return v


class HotelBookingActionRequest(CamelModel):
    guest_token: Optional[str] = None

    @field_validator("guest_token")
    @classmethod
    def _guest(cls, v: Optional[str]) -> Optional[str]:
        if v in (None, ""):
            return None
        if not TOKEN_RE.match(v or ""):
            raise ValueError("invalid_guest_token")
        return v


class HotelGuestView(CamelModel):
    type: str
    title: Optional[str] = None
    full_name: str
    room_index: int
    is_lead: bool = False


class HotelPenaltyView(CamelModel):
    from_: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None
    amount: Optional[float] = None


class HotelCancellationView(CamelModel):
    refundable: Optional[bool] = None
    penalties: List[HotelPenaltyView] = Field(default_factory=list)


class HotelBookingView(CamelModel):
    booking_reference: str
    status: str
    lifecycle_status: str
    mode: Optional[str] = None
    hotel: dict[str, Any]
    room: dict[str, Any]
    stay: dict[str, Any]
    breakdown: list = Field(default_factory=list)
    total_payable: Money
    guests: List[HotelGuestView]
    contact: dict[str, Any]
    special_requests: Optional[str] = None
    hold_deadline: Optional[str] = None
    hotel_confirmation_number: Optional[str] = None
    provider_cancellation: Optional[HotelCancellationView] = None
    status_message: Optional[str] = None
    can_confirm_hold: bool = False
    can_cancel: bool = False


class HotelBookResult(CamelModel):
    status: str
    booking: HotelBookingView
    message: Optional[str] = None
