"""Request-ID correlation, access logging and baseline security headers."""

from __future__ import annotations

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import get_logger, log_extra, request_id_ctx

logger = get_logger("app.request")

REQUEST_ID_HEADER = "X-Request-ID"
MAX_INBOUND_ID_LEN = 64

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}


def _safe_request_id(raw: str | None) -> str:
    if raw and len(raw) <= MAX_INBOUND_ID_LEN and raw.replace("-", "").isalnum():
        return raw
    return uuid.uuid4().hex


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = _safe_request_id(request.headers.get(REQUEST_ID_HEADER))
        token = request_id_ctx.set(request_id)
        request.state.request_id = request_id
        started = time.perf_counter()

        try:
            response = await call_next(request)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            # Path and method only — query strings and bodies may carry PII.
            logger.info(
                "request",
                extra=log_extra(
                    method=request.method,
                    path=request.url.path,
                    duration_ms=duration_ms,
                ),
            )
            request_id_ctx.reset(token)

        response.headers[REQUEST_ID_HEADER] = request_id
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        return response
