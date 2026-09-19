"""Centralised notification service + provider abstraction (PHASE 13).

This module is the ONLY place in the backend that composes notification
messages, chooses channels and talks to a delivery provider. Booking, payment,
cancellation and support code calls `NotificationService.emit(...)` and never
imports a provider.

HARD RULES
  1. Delivery never decides booking or payment success. Every public method
     swallows its own failures and returns instead of raising.
  2. Provider credentials are BACKEND ONLY, read from the process environment.
     They must never be exposed to the browser and never be a `VITE_` variable.
  3. Payloads carry references and statuses only: never card data, OTPs,
     passwords, passport/document numbers or unnecessary PII.
  4. Idempotency: a repeated emit with the same dedupe key is ignored, so a
     retried checkout or webhook cannot double-notify.

WHAT IS CONNECTED TODAY
  Nothing. `DemoProvider` records the attempt in the log and reports success, so
  the whole workflow, its delivery states and the admin desk are exercisable
  without credentials. Real providers become subclasses of `ChannelProvider`
  registered in `_build_registry()`; no call site changes.

QUEUE READINESS
  `dispatch_pending()` is written so a future background worker (or a cron-style
  endpoint) can drain queued/retrying rows. No queue infrastructure is added in
  this phase.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.repositories.operations import OperationsRepository

logger = get_logger(__name__)

MAX_ATTEMPTS = 3

DEFAULT_CHANNELS: dict[str, list[str]] = {
    "booking_created": ["in_app", "email"],
    "booking_pending": ["in_app", "email"],
    "booking_confirmed": ["in_app", "email", "whatsapp"],
    "booking_failed": ["in_app", "email", "sms"],
    "booking_cancelled": ["in_app", "email"],
    "booking_update": ["in_app", "email", "whatsapp"],
    "payment_successful": ["in_app", "email"],
    "payment_failed": ["in_app", "email"],
    "payment_refunded": ["in_app", "email"],
    "cancellation_requested": ["in_app", "email"],
    "cancellation_status_changed": ["in_app", "email"],
    "refund_status_changed": ["in_app", "email"],
    "documents_available": ["in_app", "email"],
    "support_request_created": ["in_app", "email"],
    "support_request_replied": ["in_app", "email"],
    "support_request_updated": ["in_app", "email"],
}

# Short, provider-neutral copy. Never promises a ticket, voucher or money
# movement that has not happened.
TEMPLATES: dict[str, tuple[str, str]] = {
    "booking_created": ("Booking created", "Booking {ref} has been created and is awaiting payment."),
    "booking_pending": ("Booking in progress", "Booking {ref} is being processed."),
    "booking_confirmed": ("Booking confirmed", "Booking {ref} is confirmed."),
    "booking_failed": ("Booking could not be confirmed", "Booking {ref} could not be confirmed."),
    "booking_cancelled": ("Booking cancelled", "Booking {ref} is now cancelled."),
    "booking_update": ("Important booking update", "There is an update on booking {ref}."),
    "payment_successful": ("Payment successful", "We have recorded your payment for booking {ref}."),
    "payment_failed": ("Payment failed", "The payment for booking {ref} did not go through."),
    "payment_refunded": ("Refund update", "The refund for booking {ref} has been marked complete."),
    "cancellation_requested": ("Cancellation requested", "We have your cancellation request for {ref}."),
    "cancellation_status_changed": ("Cancellation update", "The cancellation request for {ref} was updated."),
    "refund_status_changed": ("Refund update", "The refund status for booking {ref} was updated."),
    "documents_available": ("Travel documents available", "Documents for booking {ref} are available."),
    "support_request_created": ("Support request received", "Our team has your request."),
    "support_request_replied": ("Support team replied", "There is a new reply on your support request."),
    "support_request_updated": ("Support request updated", "Your support request status changed."),
}


@dataclass
class NotificationMessage:
    """What a provider receives. References and copy only — no PII payloads."""

    notification_id: str
    channel: str
    event_type: str
    title: str
    body: str
    booking_reference: Optional[str] = None
    support_request_id: Optional[str] = None


@dataclass
class SendResult:
    ok: bool
    error: Optional[str] = None


class ChannelProvider:
    """One delivery channel. A real Email/SMS/WhatsApp client subclasses this."""

    id = "base"
    channel = "in_app"
    mode = "demo"

    async def send(self, message: NotificationMessage) -> SendResult:  # pragma: no cover
        raise NotImplementedError


class InAppProvider(ChannelProvider):
    """In-app needs no provider: the stored row IS the delivery."""

    id = "in-app"
    channel = "in_app"
    mode = "live"

    async def send(self, message: NotificationMessage) -> SendResult:
        return SendResult(ok=True)


class DemoProvider(ChannelProvider):
    """Records intent only. Nothing leaves the server."""

    mode = "demo"

    def __init__(self, channel: str) -> None:
        self.channel = channel
        self.id = f"demo-{channel}"

    async def send(self, message: NotificationMessage) -> SendResult:
        logger.info(
            "notification_demo_send",
            extra={
                "channel": self.channel,
                "event_type": message.event_type,
                "notification_id": message.notification_id,
            },
        )
        return SendResult(ok=True)


def _build_registry(settings: Settings) -> dict[str, ChannelProvider]:
    """Pick a provider per channel.

    Real providers are selected here once their backend-only credentials exist
    (`NOTIFICATIONS_EMAIL_PROVIDER` + the matching API key, and so on). Until
    then every outbound channel is a demo provider, so no credential is
    required and nothing is sent.
    """

    registry: dict[str, ChannelProvider] = {"in_app": InAppProvider()}
    for channel in ("email", "sms", "whatsapp"):
        # No live implementation is wired in this phase by design.
        registry[channel] = DemoProvider(channel)
    return registry


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dedupe_key(event_type: str, reference: Optional[str], title: str) -> str:
    raw = f"{event_type}|{reference or 'none'}|{title}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


class NotificationService:
    """Emit + deliver notifications. Never raises into a caller's flow."""

    def __init__(
        self,
        repository: OperationsRepository,
        settings: Optional[Settings] = None,
    ) -> None:
        self._repo = repository
        self._settings = settings or get_settings()
        self._providers = _build_registry(self._settings)

    # -- emit ---------------------------------------------------------------

    async def emit(
        self,
        *,
        event_type: str,
        booking_id: Optional[str] = None,
        request_id: Optional[str] = None,
        booking_reference: Optional[str] = None,
        user_id: Optional[str] = None,
        audience: str = "customer",
        title: Optional[str] = None,
        body: Optional[str] = None,
        channels: Optional[Iterable[str]] = None,
        dedupe_key: Optional[str] = None,
    ) -> None:
        """Record the event and attempt delivery. Best effort, never blocking."""

        try:
            default_title, default_body = TEMPLATES.get(
                event_type, ("Update", "There is an update on your booking.")
            )
            resolved_title = title or default_title
            resolved_body = (body or default_body).replace(
                "{ref}", booking_reference or "your booking"
            )
            selected = list(channels or DEFAULT_CHANNELS.get(event_type, ["in_app"]))
            key = dedupe_key or _dedupe_key(event_type, booking_reference, resolved_title)

            values: dict[str, Any] = {
                "booking_id": booking_id,
                "request_id": request_id,
                "user_id": user_id,
                "event_type": event_type,
                "audience": audience,
                "title": resolved_title,
                "body": resolved_body,
                "channels": selected,
                "dedupe_key": key,
                # Safe metadata only.
                "payload": {"booking_reference": booking_reference},
            }
            # The unique index on dedupe_key makes this idempotent at the
            # database level: a duplicate insert is swallowed by the repository.
            row = await self._repo.record_notification(values)
            if not row:
                return
            await self._deliver_all(row, selected)
        except Exception:  # noqa: BLE001 - notifications must never break a flow
            logger.warning("notification_emit_failed", extra={"event_type": event_type})

    # -- delivery -----------------------------------------------------------

    async def _deliver_all(self, row: dict[str, Any], channels: list[str]) -> None:
        for channel in channels:
            await self._deliver(row, channel, attempts=0)

    async def _deliver(self, row: dict[str, Any], channel: str, *, attempts: int) -> None:
        notification_id = str(row.get("id"))
        provider = self._providers.get(channel)
        if provider is None:
            await self._repo.upsert_notification_delivery(
                {
                    "notification_id": notification_id,
                    "channel": channel,
                    "state": "skipped",
                    "attempts": attempts,
                    "provider_id": "none",
                    "mode": "demo",
                    "error": "No provider configured for this channel",
                }
            )
            return

        message = NotificationMessage(
            notification_id=notification_id,
            channel=channel,
            event_type=str(row.get("event_type")),
            title=str(row.get("title") or ""),
            body=str(row.get("body") or ""),
            booking_reference=(row.get("payload") or {}).get("booking_reference"),
            support_request_id=row.get("request_id"),
        )

        next_attempt = attempts + 1
        try:
            result = await provider.send(message)
        except Exception:  # noqa: BLE001
            result = SendResult(ok=False, error="Delivery attempt failed")

        if result.ok:
            state, error = "sent", None
        elif next_attempt < MAX_ATTEMPTS:
            state, error = "retrying", result.error or "Provider rejected the message"
        else:
            state, error = "failed", result.error or "Provider rejected the message"

        await self._repo.upsert_notification_delivery(
            {
                "notification_id": notification_id,
                "channel": channel,
                "state": state,
                "attempts": next_attempt,
                "provider_id": provider.id,
                "mode": provider.mode,
                "error": error,
            }
        )
        await self._repo.refresh_notification_dispatched(notification_id)

    async def retry(self, notification_id: str) -> None:
        """Re-attempt the failed/retrying channels of one notification."""

        try:
            deliveries = await self._repo.list_notification_deliveries(notification_id)
            row = await self._repo.get_notification(notification_id)
            if not row:
                return
            for delivery in deliveries:
                if delivery.get("state") in {"failed", "retrying"}:
                    await self._deliver(
                        row, str(delivery.get("channel")), attempts=int(delivery.get("attempts") or 0)
                    )
        except Exception:  # noqa: BLE001
            logger.warning("notification_retry_failed")

    async def dispatch_pending(self, limit: int = 50) -> int:
        """Drain queued/retrying deliveries.

        A future background worker calls exactly this. No queue infrastructure
        (Redis/Celery) is introduced in this phase.
        """

        drained = 0
        try:
            pending = await self._repo.list_pending_notification_deliveries(limit=limit)
            for delivery in pending:
                row = await self._repo.get_notification(str(delivery.get("notification_id")))
                if not row:
                    continue
                await self._deliver(
                    row, str(delivery.get("channel")), attempts=int(delivery.get("attempts") or 0)
                )
                drained += 1
        except Exception:  # noqa: BLE001
            logger.warning("notification_dispatch_failed")
        return drained
