"""Notification schemas (PHASE 13).

Contracts for the customer notification centre and the admin notification desk.
Rules that shape every model here:

  * A notification carries REFERENCES and STATUSES only — never a card detail,
    OTP, password, passport/document number or provider credential.
  * Nothing a client sends decides audience, ownership or admin level: those are
    resolved from the verified bearer token server-side.
  * A delivery state describes what OUR service attempted. No real Email/SMS/
    WhatsApp provider is connected, so demo attempts are labelled as such.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

NotificationChannel = Literal["in_app", "email", "sms", "whatsapp", "push"]
NotificationDeliveryState = Literal["queued", "sent", "failed", "retrying", "skipped"]
NotificationAudience = Literal["customer", "admin"]

NotificationType = Literal[
    "booking_created",
    "booking_pending",
    "booking_confirmed",
    "booking_failed",
    "booking_cancelled",
    "booking_update",
    "payment_successful",
    "payment_failed",
    "payment_refunded",
    "cancellation_requested",
    "cancellation_status_changed",
    "refund_status_changed",
    "documents_available",
    "support_request_created",
    "support_request_replied",
    "support_request_updated",
]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class NotificationDeliveryOut(Model):
    channel: NotificationChannel
    state: NotificationDeliveryState
    attempts: int = 0
    provider_id: str = Field(default="none", serialization_alias="providerId")
    mode: Literal["demo", "live"] = "demo"
    updated_at: datetime = Field(serialization_alias="updatedAt")
    error: Optional[str] = None


class NotificationOut(Model):
    """Camel-case aliases keep the frontend `NotificationRecord` shape."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)

    id: str
    type: NotificationType
    title: str
    body: str
    created_at: datetime = Field(serialization_alias="createdAt")
    booking_reference: Optional[str] = Field(default=None, serialization_alias="bookingReference")
    support_request_id: Optional[str] = Field(default=None, serialization_alias="supportRequestId")
    audience: NotificationAudience = "customer"
    channels: list[NotificationChannel] = Field(default_factory=list)
    dispatched: bool = False
    read_at: Optional[datetime] = Field(default=None, serialization_alias="readAt")
    deliveries: list[NotificationDeliveryOut] = Field(default_factory=list)


class UnreadCountOut(Model):
    count: int = 0


class NotificationActionOut(Model):
    ok: bool = True
    """Always true when the request was accepted. Delivery is asynchronous and
    never blocks a booking or a payment."""
