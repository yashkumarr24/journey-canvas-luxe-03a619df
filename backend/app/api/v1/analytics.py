"""Public analytics ingestion endpoints (PHASE 10).

    POST /api/v1/analytics/events        batch of activity events
    POST /api/v1/analytics/session       register / refresh a session
    POST /api/v1/analytics/session/end   mark a session ended

Design rules
  * Guests may post: a session id is opaque and anonymous. When a bearer token
    is present the user id is taken from the VERIFIED token only — a `userId`
    in the body is ignored.
  * Rate limited so the ingest surface cannot be used to hammer the database.
  * Always answers 202 with a small ack. Even on an internal failure the client
    is never told analytics broke, and never retries in a loop.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status

from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.core.rate_limit import SlidingWindowLimiter
from app.repositories.analytics import AnalyticsRepository
from app.schemas.analytics import Ack, EventBatch, SessionEnd, SessionUpsert

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])

# Generous but bounded: a normal browsing session flushes a few times a minute.
_limiter = SlidingWindowLimiter(limit=120, window_seconds=60.0)

_repository: AnalyticsRepository | None = None


def get_repository(settings: Settings = Depends(get_settings)) -> AnalyticsRepository:
    global _repository
    if _repository is None:
        _repository = AnalyticsRepository(settings)
    return _repository


def _identity(request: Request, auth: AuthContext) -> str:
    if auth.user_id:
        return f"user:{auth.user_id}"
    client = request.client.host if request.client else "unknown"
    return f"ip:{client}"


@router.post(
    "/session",
    response_model=Ack,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Register or refresh an activity session",
)
async def upsert_session(
    payload: SessionUpsert,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    repository: AnalyticsRepository = Depends(get_repository),
) -> Ack:
    _limiter.check(_identity(request, auth))
    try:
        await repository.upsert_session(payload, auth.user_id)
    except Exception:  # noqa: BLE001 - analytics must never fail a request
        logger.warning("analytics_session_failed")
    return Ack(accepted=1)


@router.post(
    "/events",
    response_model=Ack,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ingest a batch of activity events",
)
async def ingest_events(
    payload: EventBatch,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    repository: AnalyticsRepository = Depends(get_repository),
) -> Ack:
    _limiter.check(_identity(request, auth))
    accepted = 0
    try:
        accepted = await repository.insert_events(payload.events, auth.user_id)
    except Exception:  # noqa: BLE001
        logger.warning("analytics_events_failed")
    return Ack(accepted=accepted)


@router.post(
    "/session/end",
    response_model=Ack,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Mark an activity session as ended",
)
async def end_session(
    payload: SessionEnd,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    repository: AnalyticsRepository = Depends(get_repository),
) -> Ack:
    _limiter.check(_identity(request, auth))
    try:
        await repository.end_session(payload.session_id)
    except Exception:  # noqa: BLE001
        logger.warning("analytics_session_end_failed")
    return Ack(accepted=1)
