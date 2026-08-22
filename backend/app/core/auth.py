"""Optional Supabase authentication for public endpoints.

Flight search is available to GUESTS. When a bearer token is present we
verify it with Supabase and attach the resulting user id; when it is absent
or invalid we simply continue as a guest.

The user id is ALWAYS derived from the verified token — a `userId` sent in a
request body is ignored everywhere in the codebase.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
from fastapi import Request

from app.core.config import Settings, get_settings
from app.core.logging import get_logger, log_extra

logger = get_logger(__name__)

# Short-lived positive cache so a burst of requests from one user does not
# hammer Supabase. Tokens are hashed, never stored raw.
_CACHE_TTL = 60.0
_cache: dict[int, tuple[float, str]] = {}
_MAX_CACHE = 2048


@dataclass(frozen=True)
class AuthContext:
    user_id: str | None

    @property
    def is_authenticated(self) -> bool:
        return self.user_id is not None


GUEST = AuthContext(user_id=None)


def _bearer(request: Request) -> str | None:
    header = request.headers.get("Authorization") or ""
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    # Supabase access tokens are JWTs; anything else is not worth a round trip.
    return token if token.count(".") == 2 and len(token) < 4096 else None


async def _verify(token: str, settings: Settings) -> str | None:
    key = hash(token)
    now = time.monotonic()
    cached = _cache.get(key)
    if cached and cached[0] > now:
        return cached[1]

    if not (settings.supabase_url and settings.supabase_anon_key):
        return None

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": settings.supabase_anon_key,
                },
            )
    except httpx.HTTPError:
        # Auth is optional here: an outage must not break guest search.
        logger.warning("auth_verify_unavailable")
        return None

    if response.status_code != 200:
        return None

    try:
        user_id = response.json().get("id")
    except ValueError:
        return None

    if isinstance(user_id, str) and user_id:
        if len(_cache) > _MAX_CACHE:
            _cache.clear()
        _cache[key] = (now + _CACHE_TTL, user_id)
        return user_id
    return None


async def optional_user(request: Request) -> AuthContext:
    """FastAPI dependency: authenticated user when possible, guest otherwise."""
    token = _bearer(request)
    if not token:
        return GUEST

    user_id = await _verify(token, get_settings())
    if user_id:
        logger.info("auth_context", extra=log_extra(authenticated=True))
        return AuthContext(user_id=user_id)
    return GUEST
