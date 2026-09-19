"""Notification endpoints (PHASE 13).

Customer
    GET  /api/v1/notifications                       signed-in only
    GET  /api/v1/notifications/unread-count          signed-in only
    POST /api/v1/notifications/{notification_id}/read
    POST /api/v1/notifications/read-all

Admin
    GET  /api/v1/admin/notifications                 level 1 (view)
    POST /api/v1/admin/notifications/{id}/retry      level 2 (act)

Rules that hold for every route:
  * The acting user id comes from the verified bearer token, never the body, and
    it stays inside the query predicate — another id matches zero rows.
  * The admin level is resolved from the database by `require_admin`.
  * Responses carry references, statuses and short copy only: no card data,
    OTP, password, passport/document number or provider credential.
  * A retry only re-attempts delivery. It cannot change a booking, a payment or
    a refund, and a delivery failure never fails either.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, status

from app.core.admin_auth import AdminContext, require_admin
from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.repositories.operations import OperationsRepository
from app.schemas.notifications import (
    NotificationActionOut,
    NotificationDeliveryOut,
    NotificationOut,
    UnreadCountOut,
)
from app.services.notifications import NotificationService

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1", tags=["notifications"])


class NotificationsUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "NOTIFICATIONS_UNAVAILABLE"
    message = "Notifications are temporarily unavailable."


class SignInRequiredError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "SIGN_IN_REQUIRED"
    message = "Please sign in to view your notifications."


def get_repository(settings: Settings = Depends(get_settings)) -> OperationsRepository:
    repository = OperationsRepository(settings)
    if not repository.enabled:
        raise NotificationsUnavailableError()
    return repository


def get_service(
    repository: OperationsRepository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
) -> NotificationService:
    return NotificationService(repository, settings)


def _require_user(auth: AuthContext) -> str:
    if not auth.user_id:
        raise SignInRequiredError()
    return auth.user_id


def _delivery(row: dict[str, Any]) -> NotificationDeliveryOut:
    return NotificationDeliveryOut(
        channel=row.get("channel") or "in_app",
        state=row.get("state") or "queued",
        attempts=int(row.get("attempts") or 0),
        provider_id=row.get("provider_id") or "none",
        mode=row.get("mode") or "demo",
        updated_at=row.get("updated_at"),
        error=row.get("error"),
    )


def _notification(row: dict[str, Any], deliveries: list[dict[str, Any]]) -> NotificationOut:
    payload = row.get("payload") or {}
    return NotificationOut(
        id=str(row.get("id")),
        type=row.get("event_type"),
        title=row.get("title") or "Update",
        body=row.get("body") or "",
        created_at=row.get("created_at"),
        booking_reference=payload.get("booking_reference"),
        support_request_id=row.get("request_id"),
        audience=row.get("audience") or "customer",
        channels=list(row.get("channels") or []),
        dispatched=bool(row.get("dispatched")),
        read_at=row.get("read_at"),
        deliveries=[_delivery(d) for d in deliveries],
    )


async def _with_deliveries(
    repository: OperationsRepository, rows: list[dict[str, Any]]
) -> list[NotificationOut]:
    out: list[NotificationOut] = []
    for row in rows:
        deliveries = await repository.list_notification_deliveries(str(row.get("id")))
        out.append(_notification(row, deliveries))
    return out


# -- customer ---------------------------------------------------------------


@router.get("/notifications", response_model=list[NotificationOut], summary="My notifications")
async def my_notifications(
    limit: int = Query(default=50, ge=1, le=100),
    unread_only: bool = Query(default=False, alias="unreadOnly"),
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> list[NotificationOut]:
    user_id = _require_user(auth)
    rows = await repository.list_notifications_for_user(
        user_id, limit=limit, unread_only=unread_only
    )
    return await _with_deliveries(repository, rows)


@router.get(
    "/notifications/unread-count", response_model=UnreadCountOut, summary="Unread notifications"
)
async def unread_count(
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> UnreadCountOut:
    user_id = _require_user(auth)
    return UnreadCountOut(count=await repository.count_unread_for_user(user_id))


@router.post(
    "/notifications/{notification_id}/read",
    response_model=NotificationActionOut,
    summary="Mark one as read",
)
async def mark_read(
    notification_id: str,
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> NotificationActionOut:
    user_id = _require_user(auth)
    await repository.mark_notification_read(notification_id, user_id)
    return NotificationActionOut()


@router.post(
    "/notifications/read-all", response_model=NotificationActionOut, summary="Mark all as read"
)
async def mark_all_read(
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> NotificationActionOut:
    user_id = _require_user(auth)
    await repository.mark_all_notifications_read(user_id)
    return NotificationActionOut()


# -- admin ------------------------------------------------------------------


@router.get(
    "/admin/notifications", response_model=list[NotificationOut], summary="Notification desk"
)
async def admin_notifications(
    audience: Optional[str] = Query(default=None, pattern="^(customer|admin)$"),
    limit: int = Query(default=100, ge=1, le=200),
    admin: AdminContext = Depends(require_admin(1)),
    repository: OperationsRepository = Depends(get_repository),
) -> list[NotificationOut]:
    rows = await repository.list_notifications_for_admin(audience=audience, limit=limit)
    return await _with_deliveries(repository, rows)


@router.post(
    "/admin/notifications/{notification_id}/retry",
    response_model=NotificationActionOut,
    summary="Retry delivery",
)
async def admin_retry(
    notification_id: str,
    admin: AdminContext = Depends(require_admin(2)),
    service: NotificationService = Depends(get_service),
) -> NotificationActionOut:
    await service.retry(notification_id)
    return NotificationActionOut()
