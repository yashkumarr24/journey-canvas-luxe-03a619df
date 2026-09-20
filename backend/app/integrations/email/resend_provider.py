"""Resend email provider for the PHASE 13 notification service.

This is an implementation of the existing `ChannelProvider` contract — it adds no
second notification system, no new templates and no new delivery states. The
notification service still owns composition, channel selection, idempotency and
the queued/sent/failed/retrying/skipped states.

SECURITY
  * `RESEND_API_KEY` is backend only, read from the process environment. It is
    never logged, never returned in a response and never a `VITE_` variable.
  * The rendered email carries references and statuses only: no card data, CVV,
    OTP, password, passport/document number or provider secret.
  * A send failure returns `SendResult(ok=False, ...)`. It can never fail a
    booking or a payment.
"""

from __future__ import annotations

import html
from typing import TYPE_CHECKING, Optional

import httpx

from app.core.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover - typing only, avoids an import cycle
    from app.services.notifications import NotificationMessage, SendResult

logger = get_logger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"


def _render_html(title: str, body: str, reference: Optional[str], account_url: str) -> str:
    """Fly n Feel branded shell around the existing template copy."""

    safe_title = html.escape(title)
    safe_body = html.escape(body)
    reference_block = (
        f'<p style="margin:0 0 18px;font:14px/1.6 Arial,Helvetica,sans-serif;color:#555">'
        f"Booking reference: <strong>{html.escape(reference)}</strong></p>"
        if reference
        else ""
    )
    link_block = (
        f'<p style="margin:24px 0 0"><a href="{html.escape(account_url)}" '
        'style="display:inline-block;background:#d62828;color:#ffffff;padding:12px 22px;'
        'font:14px Arial,Helvetica,sans-serif;text-decoration:none">View in your account</a></p>'
        if account_url
        else ""
    )
    return (
        '<div style="background:#f8f8f6;padding:32px 0">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e4df;padding:32px">'
        '<p style="margin:0 0 24px;font:12px Arial,Helvetica,sans-serif;letter-spacing:.18em;'
        'text-transform:uppercase;color:#d62828">Fly n Feel</p>'
        f'<h1 style="margin:0 0 14px;font:22px Georgia,serif;color:#111111">{safe_title}</h1>'
        f'<p style="margin:0 0 18px;font:15px/1.7 Arial,Helvetica,sans-serif;color:#333">{safe_body}</p>'
        f"{reference_block}{link_block}"
        '<p style="margin:28px 0 0;font:12px/1.6 Arial,Helvetica,sans-serif;color:#8a8a8a">'
        "This is an automated message about your Fly n Feel booking. "
        "Never share card details, OTPs or passwords by email.</p>"
        "</div></div>"
    )


class ResendEmailProvider:
    """Sends the existing notification message through the Resend API."""

    channel = "email"
    mode = "live"

    def __init__(
        self,
        *,
        api_key: str,
        from_email: str,
        account_url: str = "",
        timeout: float = 15.0,
    ) -> None:
        self.id = "resend"
        self._api_key = api_key
        self._from_email = from_email
        self._account_url = account_url
        self._timeout = timeout

    async def send(self, message: "NotificationMessage") -> "SendResult":
        from app.services.notifications import SendResult  # local import: no cycle

        if not self._api_key or not self._from_email:
            # Safe, non-revealing configuration error. Never names the secret value.
            return SendResult(ok=False, error="Email provider is not configured")

        to_address = getattr(message, "to_email", None)
        if not to_address:
            return SendResult(ok=False, error="No recipient address on file")

        payload = {
            "from": self._from_email,
            "to": [to_address],
            "subject": message.title,
            "html": _render_html(
                message.title, message.body, message.booking_reference, self._account_url
            ),
            "text": message.body,
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    RESEND_ENDPOINT,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                )
        except httpx.HTTPError:
            logger.warning(
                "notification_email_transport_error",
                extra={"notification_id": message.notification_id},
            )
            return SendResult(ok=False, error="Email provider unreachable")

        if response.status_code >= 400:
            # Status only: the body can echo request data, so it is not stored.
            logger.warning(
                "notification_email_rejected",
                extra={
                    "notification_id": message.notification_id,
                    "status": response.status_code,
                },
            )
            return SendResult(ok=False, error=f"Email provider rejected the message ({response.status_code})")

        logger.info(
            "notification_email_sent",
            extra={"notification_id": message.notification_id, "channel": "email"},
        )
        return SendResult(ok=True)
