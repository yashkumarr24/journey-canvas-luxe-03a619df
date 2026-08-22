"""In-process rate limiting for provider-backed endpoints.

Flight search costs us real provider quota, so it is throttled server-side.
A frontend-only limiter would be trivially bypassed.

Deliberately simple: a sliding window per identity held in process memory.
That is correct for the single-VPS deployment we have today. If the backend
is ever scaled to multiple instances this must move to Redis — the interface
below is designed so only the storage swaps.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict

from fastapi import Request, status

from app.core.errors import AppError


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "RATE_LIMITED"
    message = "Too many searches in a short time. Please wait a moment and try again."


@dataclass
class _Window:
    hits: Deque[float]


class SlidingWindowLimiter:
    def __init__(self, *, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._buckets: Dict[str, _Window] = {}
        self._last_sweep = 0.0

    def _sweep(self, now: float) -> None:
        # Cheap periodic cleanup so idle identities do not leak memory.
        if now - self._last_sweep < self.window:
            return
        self._last_sweep = now
        cutoff = now - self.window
        for key in [k for k, w in self._buckets.items() if not w.hits or w.hits[-1] < cutoff]:
            self._buckets.pop(key, None)

    def check(self, identity: str) -> None:
        now = time.monotonic()
        self._sweep(now)

        window = self._buckets.setdefault(identity, _Window(hits=deque()))
        cutoff = now - self.window
        while window.hits and window.hits[0] < cutoff:
            window.hits.popleft()

        if len(window.hits) >= self.limit:
            raise RateLimitedError()

        window.hits.append(now)


def client_identity(request: Request, user_id: str | None) -> str:
    """Stable throttling key: user id when known, else client IP.

    Only the first hop of X-Forwarded-For is used, and only when the app is
    configured to trust a proxy — otherwise a client could spoof the header
    and evade the limit entirely.
    """
    if user_id:
        return f"user:{user_id}"

    from app.core.config import get_settings

    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("X-Forwarded-For", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return f"ip:{first}"

    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


# Tuned so a real customer refining a search is never blocked, while scripted
# flooding is stopped quickly.
flight_search_limiter = SlidingWindowLimiter(limit=12, window_seconds=60.0)
