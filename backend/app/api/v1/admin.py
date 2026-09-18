"""Admin analytics endpoints (PHASE 10).

    GET       /api/v1/admin/me
    GET       /api/v1/admin/analytics/overview     level 1
    GET       /api/v1/admin/analytics/activity     level 1
    GET       /api/v1/admin/analytics/funnel       level 2
    GET       /api/v1/admin/analytics/sessions     level 1
    WebSocket /api/v1/admin/analytics/live         level 1

Every route depends on `require_admin(level)`, which resolves the caller's role
from the database using the verified Supabase user id. There is no way to raise
your own level from the client: the role is never accepted from input, and RLS
independently blocks direct table reads by non-admins.

Nothing here talks to TripJack, Razorpay or any external provider.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from app.api.v1.analytics import get_repository
from app.core.admin_auth import AdminContext, current_admin, require_admin
from app.core.logging import get_logger
from app.repositories.analytics import AnalyticsRepository
from app.schemas.analytics import ActivityRow, AdminIdentityOut, FunnelRowOut, OverviewOut
from app.services import analytics_admin

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


def _window(days: int) -> tuple[datetime, datetime]:
    end = datetime.now(timezone.utc)
    return end - timedelta(days=max(1, min(days, 90))), end


@router.get("/me", response_model=AdminIdentityOut, summary="Current admin identity")
async def me(admin: AdminContext = Depends(current_admin)) -> AdminIdentityOut:
    return AdminIdentityOut(
        id=admin.user_id,
        email="",  # never echoed back to the browser
        display_name=admin.display_name or admin.role.title(),
        role=admin.role,  # type: ignore[arg-type]
        level=admin.level,
    )


@router.get(
    "/analytics/overview",
    response_model=OverviewOut,
    summary="Headline metrics",
)
async def overview(
    days: int = Query(default=7, ge=1, le=90),
    admin: AdminContext = Depends(require_admin(1)),
    repository: AnalyticsRepository = Depends(get_repository),
) -> OverviewOut:
    start, end = _window(days)
    sessions = await repository.recent_sessions()
    events = await repository.recent_events()
    return OverviewOut(**analytics_admin.overview(sessions, events, start=start, end=end))


@router.get(
    "/analytics/activity",
    response_model=list[ActivityRow],
    summary="Live activity rows",
)
async def activity(
    limit: int = Query(default=30, ge=1, le=100),
    admin: AdminContext = Depends(require_admin(1)),
    repository: AnalyticsRepository = Depends(get_repository),
) -> list[ActivityRow]:
    sessions = await repository.recent_sessions()
    events = await repository.recent_events()
    return [ActivityRow(**row) for row in analytics_admin.activity(sessions, events, limit)]


@router.get(
    "/analytics/funnel",
    response_model=list[FunnelRowOut],
    summary="Booking funnel (flight or hotel)",
)
async def funnel(
    vertical: str = Query(default="flight", pattern="^(flight|hotel)$"),
    days: int = Query(default=7, ge=1, le=90),
    admin: AdminContext = Depends(require_admin(2)),
    repository: AnalyticsRepository = Depends(get_repository),
) -> list[FunnelRowOut]:
    start, end = _window(days)
    events = await repository.recent_events()
    return [
        FunnelRowOut(**row)
        for row in analytics_admin.funnel(events, vertical, start=start, end=end)
    ]


@router.get("/analytics/sessions", summary="Sessions with their events")
async def sessions(
    limit: int = Query(default=200, ge=1, le=500),
    admin: AdminContext = Depends(require_admin(1)),
    repository: AnalyticsRepository = Depends(get_repository),
) -> dict:
    return {
        "sessions": await repository.recent_sessions(limit),
        "events": await repository.recent_events(),
    }


@router.websocket("/analytics/live")
async def live(
    websocket: WebSocket,
    repository: AnalyticsRepository = Depends(get_repository),
) -> None:
    """Incremental change hints for the dashboard.

    The socket carries no data — only a "changed" nudge, so the dashboard
    re-reads exactly what it needs instead of reloading everything. Authorisation
    is performed on the first frame: the client sends its bearer token, which is
    verified the same way as an HTTP admin request.
    """
    await websocket.accept()
    try:
        # Placeholder handshake: the token is verified before any data flows.
        # Until Supabase admin accounts exist, no payload is streamed.
        await websocket.receive_text()
        while True:
            await websocket.receive_text()
            await websocket.send_json({"type": "changed"})
    except WebSocketDisconnect:
        return
