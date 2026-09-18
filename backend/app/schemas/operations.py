"""Operations schemas (PHASE 11).

Contracts for customer booking management, cancellation requests, support and
the admin operations desk. Two rules shape every model here:

  * Nothing a customer sends decides money, status or ownership. Amounts,
    statuses and the acting user id are resolved server-side.
  * Nothing returned to a customer carries passport values, card data,
    provider credentials or admin-internal notes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

CancellationState = Literal["requested", "pending", "approved", "rejected"]
RefundState = Literal["not_applicable", "pending", "processing", "completed", "failed"]
SupportState = Literal["open", "in_progress", "waiting_customer", "resolved", "closed"]
SupportCategory = Literal[
    "flight_booking",
    "hotel_booking",
    "payment",
    "cancellation",
    "refund",
    "document",
    "general",
]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# -- booking list / detail --------------------------------------------------


class BookingListItemOut(Model):
    booking_reference: str
    product: Literal["flight", "hotel"]
    status: str
    payment_status: str
    title: str
    destination: Optional[str] = None
    booked_at: datetime
    travel_date: Optional[datetime] = None
    total_amount: str
    currency: str
    summary: Optional[str] = None
    cancellation_state: Optional[CancellationState] = None
    refund_state: Optional[RefundState] = None
    is_test_mode: bool = False


class BookingListOut(Model):
    items: list[BookingListItemOut]
    total: int
    has_more: bool


class TimelineEventOut(Model):
    id: str
    event_type: str
    message: Optional[str] = None
    occurred_at: datetime
    actor: str = "system"


class DocumentOut(Model):
    kind: Literal["eticket", "voucher", "invoice"]
    label: str
    # Absent until real document generation exists; the UI shows a placeholder.
    url: Optional[str] = None
    available: bool = False


class BookingDetailOut(Model):
    booking_reference: str
    product: Literal["flight", "hotel"]
    status: str
    payment_status: str
    status_message: Optional[str] = None
    total_amount: str
    currency: str
    booked_at: datetime
    # Product payload as normalised by the booking service (no passport values).
    details: dict[str, Any] = Field(default_factory=dict)
    timeline: list[TimelineEventOut] = Field(default_factory=list)
    documents: list[DocumentOut] = Field(default_factory=list)
    cancellation_state: Optional[CancellationState] = None
    refund_state: Optional[RefundState] = None
    is_test_mode: bool = False


class GuestLookupIn(Model):
    """Reference alone is never enough — contact email must also match."""

    booking_reference: str = Field(min_length=4, max_length=40)
    contact_email: EmailStr


# -- cancellation ----------------------------------------------------------


class CancellationRequestIn(Model):
    reason_code: str = Field(min_length=2, max_length=64)
    reason_note: Optional[str] = Field(default=None, max_length=1000)
    contact_email: Optional[EmailStr] = None


class CancellationRequestOut(Model):
    id: str
    booking_reference: str
    reason_code: str
    reason_note: Optional[str] = None
    state: CancellationState
    refund_state: RefundState
    decision_note: Optional[str] = None
    created_at: datetime
    # True while no provider cancellation / refund API is connected.
    workflow_only: bool = True


class CancellationDecisionIn(Model):
    state: CancellationState
    refund_state: RefundState = "not_applicable"
    decision_note: Optional[str] = Field(default=None, max_length=1000)


# -- support ---------------------------------------------------------------


class SupportMessageOut(Model):
    id: str
    author_role: Literal["customer", "admin", "system"]
    author_name: Optional[str] = None
    body: str
    internal: bool = False
    created_at: datetime


class SupportRequestOut(Model):
    id: str
    reference: str
    booking_reference: Optional[str] = None
    category: SupportCategory
    subject: str
    state: SupportState
    created_at: datetime
    updated_at: datetime
    messages: list[SupportMessageOut] = Field(default_factory=list)


class SupportRequestIn(Model):
    booking_reference: Optional[str] = Field(default=None, max_length=40)
    category: SupportCategory = "general"
    subject: str = Field(min_length=3, max_length=160)
    message: str = Field(min_length=3, max_length=4000)
    contact_email: Optional[EmailStr] = None


class SupportReplyIn(Model):
    message: str = Field(min_length=1, max_length=4000)
    internal: bool = False


class SupportUpdateIn(Model):
    state: Optional[SupportState] = None
    assign_to_me: bool = False


# -- admin -----------------------------------------------------------------


class InternalNoteIn(Model):
    body: str = Field(min_length=1, max_length=2000)


class InternalNoteOut(Model):
    id: str
    body: str
    author_name: Optional[str] = None
    created_at: datetime


class AdminBookingDetailOut(BookingDetailOut):
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    customer_type: Literal["account", "guest"] = "guest"
    provider: Optional[str] = None
    provider_reference: Optional[str] = None
    internal_notes: list[InternalNoteOut] = Field(default_factory=list)
    support_references: list[str] = Field(default_factory=list)


class OperationsMetricsOut(Model):
    total_bookings: int
    today_bookings: int
    pending_bookings: int
    failed_bookings: int
    payment_pending: int
    cancellation_requests: int
    open_support: int
    flight_bookings: int
    hotel_bookings: int
