"""TripJack adapter exceptions.

These are PROVIDER-level failures. They are translated into user-safe
application errors by the service layer (app/services/flight_search.py) —
a TripJack message, status line or payload never reaches the browser
verbatim.
"""

from __future__ import annotations

from typing import Any


class TripJackError(Exception):
    """Base class for every TripJack adapter failure."""

    def __init__(self, message: str = "TripJack request failed", *, provider_code: str | None = None):
        super().__init__(message)
        # `message` is for SERVER LOGS only.
        self.message = message
        self.provider_code = provider_code


class TripJackNotConfiguredError(TripJackError):
    """Base URL or API key missing from the backend environment."""


class TripJackTimeoutError(TripJackError):
    """Connect/read/write/pool timeout talking to TripJack."""


class TripJackNetworkError(TripJackError):
    """DNS, TLS, connection reset — the request never completed."""


class TripJackAuthError(TripJackError):
    """Invalid API key (412), access denied (408) or insufficient permission (411).

    Almost always means the VPS IP is not whitelisted or the key is wrong.
    Never surfaced to the client as an auth error — that would leak our
    provider-side state.
    """


class TripJackRateLimitError(TripJackError):
    """TripJack throttled us (HTTP 429)."""


class TripJackUpstreamError(TripJackError):
    """TripJack returned 5xx or an unusable payload."""


class TripJackBadRequestError(TripJackError):
    """TripJack rejected the request parameters (documented 4xx error codes)."""

    def __init__(
        self,
        message: str = "TripJack rejected the request",
        *,
        provider_code: str | None = None,
        safe_message: str | None = None,
    ):
        super().__init__(message, provider_code=provider_code)
        # A curated, non-leaking message that MAY be shown to the user.
        self.safe_message = safe_message


def summarise_errors(errors: Any) -> tuple[str | None, str]:
    """Extract (code, log-safe message) from a TripJack `errors` payload.

    TripJack returns `{"errors": [{"errCode": 1000, "message": "..."}], ...}`.
    Only the code is treated as safe context; provider prose is kept for logs.
    """
    if isinstance(errors, dict):
        errors = [errors]
    if not isinstance(errors, list) or not errors:
        return None, "unspecified provider error"

    first = errors[0] if isinstance(errors[0], dict) else {}
    code = first.get("errCode") or first.get("errorCode") or first.get("code")
    message = first.get("message") or first.get("errMsg") or "unspecified provider error"
    return (str(code) if code is not None else None), str(message)[:300]
