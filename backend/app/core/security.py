"""Security foundation: CORS policy, security headers, secret hygiene.

The backend — not the React app — is the security boundary. Provider
credentials (TripJack, Razorpay, Supabase service role) live only here.
"""

from __future__ import annotations

import hmac
from typing import Iterable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import Settings
from app.core.logging import get_logger, log_extra

logger = get_logger(__name__)

ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"]
EXPOSED_HEADERS = ["X-Request-ID"]


def configure_cors(app: FastAPI, settings: Settings) -> None:
    origins = settings.cors_allowed_origins
    if "*" in origins:
        raise RuntimeError("Wildcard CORS origin is not permitted.")
    if settings.is_production and not origins:
        raise RuntimeError(
            "CORS_ALLOWED_ORIGINS must be set in production (comma-separated origins)."
        )

    logger.info("cors_configured", extra=log_extra(origin_count=len(origins)))

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=settings.cors_allowed_origin_regex or None,
        allow_credentials=True,
        allow_methods=ALLOWED_METHODS,
        allow_headers=ALLOWED_HEADERS,
        expose_headers=EXPOSED_HEADERS,
        max_age=600,
    )


def configure_trusted_hosts(app: FastAPI, allowed_hosts: Iterable[str] | None = None) -> None:
    hosts = list(allowed_hosts or ["*"])
    if hosts != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)


def constant_time_compare(a: str, b: str) -> bool:
    """Timing-safe comparison for future webhook signature verification."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
