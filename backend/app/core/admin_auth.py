"""Server-side admin authorisation (PHASE 10).

The admin level is resolved from the VERIFIED Supabase user id against the
`admin_users` table using the service-role key. It is never read from a request
body, header, query parameter or frontend state, so a customer cannot become an
owner by editing anything they control.

Levels: 1 staff, 2 manager, 3 owner.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Request, status

from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.core.logging import get_logger, log_extra
from app.repositories.supabase_rest import SupabaseRest, SupabaseUnavailableError

logger = get_logger(__name__)

LEVEL_BY_ROLE = {"staff": 1, "manager": 2, "owner": 3}
_CACHE_TTL = 30.0
_cache: dict[str, tuple[float, Optional[dict]]] = {}


class AdminForbiddenError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "ADMIN_FORBIDDEN"
    message = "You do not have access to this area."


class AdminUnauthorizedError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "ADMIN_UNAUTHORIZED"
    message = "Admin sign-in required."


@dataclass(frozen=True)
class AdminContext:
    user_id: str
    role: str
    level: int
    display_name: str = ""

    def require(self, minimum: int) -> None:
        if self.level < minimum:
            raise AdminForbiddenError()


async def _load_admin(user_id: str, settings: Settings) -> Optional[dict]:
    now = time.monotonic()
    cached = _cache.get(user_id)
    if cached and cached[0] > now:
        return cached[1]

    rest = SupabaseRest(settings)
    if not rest.enabled:
        # Without the database there is no way to prove admin status; deny.
        return None

    try:
        rows = await rest.select(
            "admin_users",
            columns="id,user_id,role,display_name,status",
            filters={"user_id": f"eq.{user_id}", "status": "eq.active"},
            limit=1,
        )
    except SupabaseUnavailableError:
        logger.warning("admin_lookup_unavailable")
        return None

    record = rows[0] if rows else None
    if len(_cache) > 1024:
        _cache.clear()
    _cache[user_id] = (now + _CACHE_TTL, record)
    return record


async def current_admin(
    request: Request,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> AdminContext:
    """Dependency: resolves the caller's admin context or raises."""
    if not auth.user_id:
        raise AdminUnauthorizedError()

    record = await _load_admin(auth.user_id, settings)
    if not record:
        # Log the attempt (no email, no token) so denials are auditable.
        logger.warning("admin_access_denied", extra=log_extra(path=request.url.path))
        raise AdminForbiddenError()

    role = str(record.get("role") or "")
    level = LEVEL_BY_ROLE.get(role, 0)
    if level < 1:
        raise AdminForbiddenError()

    return AdminContext(
        user_id=auth.user_id,
        role=role,
        level=level,
        display_name=str(record.get("display_name") or ""),
    )


def require_admin(minimum: int):
    """Factory producing a dependency that enforces a minimum admin level."""

    async def _dependency(admin: AdminContext = Depends(current_admin)) -> AdminContext:
        admin.require(minimum)
        return admin

    return _dependency
