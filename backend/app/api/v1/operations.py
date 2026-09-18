"""Customer & admin operations endpoints (PHASE 11).

Customer
    GET   /api/v1/bookings
    GET   /api/v1/bookings/{reference}
    POST  /api/v1/bookings/lookup                     guest: reference + email
    POST  /api/v1/bookings/{reference}/cancellation-request
    GET   /api/v1/support
    POST  /api/v1/support
    GET   /api/v1/support/{request_id}
    POST  /api/v1/support/{request_id}/messages

Admin
    GET   /api/v1/admin/bookings                      level 1
    GET   /api/v1/admin/bookings/{reference}          level 1
    POST  /api/v1/admin/bookings/{reference}/notes     level 2
    PATCH /api/v1/admin/bookings/{reference}/cancellation   level 2
    GET   /api/v1/admin/support                        level 1
    PATCH /api/v1/admin/support/{request_id}           level 2
    POST  /api/v1/admin/support/{request_id}/messages   level 2
    GET   /api/v1/admin/operations/metrics             level 1

Authorisation rules that hold for every route below:
  * The acting user id comes from the verified bearer token, never the body.
  * A customer read is scoped by that id; a guest read needs reference + email.
  * The admin level is resolved from the database by `require_admin`.
  * A cancellation or refund here records WORKFLOW STATE ONLY — no TripJack
    cancellation and no Razorpay refund is performed in this phase.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query, status

from app.core.admin_auth import AdminContext, require_admin
from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.repositories.operations import OperationsRepository
from app.schemas.operations import (
    AdminBookingDetailOut,
    BookingDetailOut,
    BookingListItemOut,
    BookingListOut,
    CancellationDecisionIn,
    CancellationRequestIn,
    CancellationRequestOut,
    DocumentOut,
    GuestLookupIn,
    InternalNoteIn,
    InternalNoteOut,
    OperationsMetricsOut,
    SupportMessageOut,
    SupportReplyIn,
    SupportRequestIn,
    SupportRequestOut,
    SupportUpdateIn,
    TimelineEventOut,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1", tags=["operations"])


class OperationsUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "OPERATIONS_UNAVAILABLE"
    message = "Booking management is temporarily unavailable."


class SignInRequiredError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "SIGN_IN_REQUIRED"
    message = "Please sign in to view this."


class BookingNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "BOOKING_NOT_FOUND"
    # Deliberately identical for "wrong reference" and "not yours": a probe
    # cannot tell an existing booking from a missing one.
    message = "We could not find a booking with those details."


class SupportNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "SUPPORT_NOT_FOUND"
    message = "We could not find that support request."


def get_repository(settings: Settings = Depends(get_settings)) -> OperationsRepository:
    repository = OperationsRepository(settings)
    if not repository.enabled:
        raise OperationsUnavailableError()
    return repository


def _require_user(auth: AuthContext) -> str:
    if not auth.user_id:
        raise SignInRequiredError()
    return auth.user_id


# -- projections ------------------------------------------------------------

PAID = {"confirmed", "booking_processing", "failed"}


def _payment_status(status_value: str) -> str:
    if status_value in PAID:
        return "paid"
    if status_value == "payment_processing":
        return "processing"
    if status_value == "payment_failed":
        return "failed"
    if status_value in {"cancelled", "expired"}:
        return "not_required"
    return "pending"


def _product(row: dict[str, Any]) -> str:
    return "hotel" if str(row.get("booking_type")) == "hotel" else "flight"


def _documents(row: dict[str, Any]) -> list[DocumentOut]:
    """Placeholders until real document generation exists (no fake documents)."""
    product = _product(row)
    kinds = [("voucher", "Hotel voucher")] if product == "hotel" else [("eticket", "E-ticket")]
    kinds.append(("invoice", "Invoice"))
    return [
        DocumentOut(kind=kind, label=label, url=None, available=False)  # type: ignore[arg-type]
        for kind, label in kinds
    ]


def _timeline(rows: list[dict[str, Any]]) -> list[TimelineEventOut]:
    return [
        TimelineEventOut(
            id=str(row.get("id")),
            event_type=str(row.get("event_type")),
            message=row.get("message"),
            occurred_at=row.get("created_at"),  # type: ignore[arg-type]
            actor=str(row.get("actor") or "system"),
        )
        for row in rows
    ]


def _list_item(row: dict[str, Any], cancellation: Optional[dict[str, Any]] = None):
    return BookingListItemOut(
        booking_reference=str(row.get("booking_reference")),
        product=_product(row),  # type: ignore[arg-type]
        status=str(row.get("status")),
        payment_status=_payment_status(str(row.get("status"))),
        title=str(row.get("booking_reference")),
        booked_at=row.get("created_at"),  # type: ignore[arg-type]
        total_amount=str(row.get("total_amount") or "0"),
        currency=str(row.get("currency") or "INR"),
        summary=row.get("status_message"),
        cancellation_state=(cancellation or {}).get("state"),
        refund_state=(cancellation or {}).get("refund_state"),
    )


async def _detail(
    repository: OperationsRepository, row: dict[str, Any]
) -> tuple[dict[str, Any], Optional[dict[str, Any]]]:
    booking_id = str(row.get("id"))
    items = await repository.booking_items(booking_id)
    events = await repository.timeline(booking_id)
    cancellation = await repository.cancellation_for_booking(booking_id)
    payload = {
        "booking_reference": str(row.get("booking_reference")),
        "product": _product(row),
        "status": str(row.get("status")),
        "payment_status": _payment_status(str(row.get("status"))),
        "status_message": row.get("status_message"),
        "total_amount": str(row.get("total_amount") or "0"),
        "currency": str(row.get("currency") or "INR"),
        "booked_at": row.get("created_at"),
        "details": (items[0].get("details") if items else {}) or {},
        "timeline": _timeline(events),
        "documents": _documents(row),
        "cancellation_state": (cancellation or {}).get("state"),
        "refund_state": (cancellation or {}).get("refund_state"),
    }
    return payload, cancellation


# -- customer: bookings -----------------------------------------------------


@router.get("/bookings", response_model=BookingListOut, summary="My bookings")
async def my_bookings(
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> BookingListOut:
    user_id = _require_user(auth)
    rows = await repository.list_bookings_for_user(user_id, limit=limit + 1, offset=offset)
    has_more = len(rows) > limit
    page = rows[:limit]
    return BookingListOut(
        items=[_list_item(row) for row in page],
        total=len(page) + offset,
        has_more=has_more,
    )


@router.get("/bookings/{reference}", response_model=BookingDetailOut, summary="Booking detail")
async def my_booking(
    reference: str,
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> BookingDetailOut:
    user_id = _require_user(auth)
    row = await repository.get_booking_for_user(reference, user_id)
    if not row:
        raise BookingNotFoundError()
    payload, _ = await _detail(repository, row)
    return BookingDetailOut(**payload)


@router.post("/bookings/lookup", response_model=BookingDetailOut, summary="Guest booking lookup")
async def guest_lookup(
    payload: GuestLookupIn,
    repository: OperationsRepository = Depends(get_repository),
) -> BookingDetailOut:
    """Knowing a reference is not enough — the contact email must match too."""
    row = await repository.get_booking_for_guest(payload.booking_reference, str(payload.contact_email))
    if not row:
        raise BookingNotFoundError()
    detail, _ = await _detail(repository, row)
    return BookingDetailOut(**detail)


@router.post(
    "/bookings/{reference}/cancellation-request",
    response_model=CancellationRequestOut,
    summary="Request a cancellation (workflow only)",
)
async def request_cancellation(
    reference: str,
    payload: CancellationRequestIn,
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> CancellationRequestOut:
    if auth.user_id:
        row = await repository.get_booking_for_user(reference, auth.user_id)
    elif payload.contact_email:
        row = await repository.get_booking_for_guest(reference, str(payload.contact_email))
    else:
        raise SignInRequiredError()
    if not row:
        raise BookingNotFoundError()

    created = await repository.create_cancellation(
        {
            "booking_id": row.get("id"),
            # From the verified token only.
            "user_id": auth.user_id,
            "reason_code": payload.reason_code,
            "reason_note": payload.reason_note,
            "state": "requested",
            "refund_state": "not_applicable",
        }
    )
    if not created:
        raise OperationsUnavailableError()

    await repository.record_notification(
        {
            "booking_id": row.get("id"),
            "event_type": "cancellation_requested",
            "payload": {"booking_reference": reference},
        }
    )
    return CancellationRequestOut(
        id=str(created.get("id")),
        booking_reference=reference,
        reason_code=str(created.get("reason_code")),
        reason_note=created.get("reason_note"),
        state=created.get("state"),  # type: ignore[arg-type]
        refund_state=created.get("refund_state"),  # type: ignore[arg-type]
        created_at=created.get("created_at"),  # type: ignore[arg-type]
        workflow_only=True,
    )


# -- customer: support ------------------------------------------------------


def _support_out(row: dict[str, Any], messages: list[dict[str, Any]]) -> SupportRequestOut:
    return SupportRequestOut(
        id=str(row.get("id")),
        reference=str(row.get("reference")),
        category=row.get("category"),  # type: ignore[arg-type]
        subject=str(row.get("subject")),
        state=row.get("state"),  # type: ignore[arg-type]
        created_at=row.get("created_at"),  # type: ignore[arg-type]
        updated_at=row.get("updated_at"),  # type: ignore[arg-type]
        messages=[
            SupportMessageOut(
                id=str(m.get("id")),
                author_role=m.get("author_role"),  # type: ignore[arg-type]
                author_name=m.get("author_name"),
                body=str(m.get("body")),
                internal=bool(m.get("internal")),
                created_at=m.get("created_at"),  # type: ignore[arg-type]
            )
            for m in messages
        ],
    )


@router.get("/support", response_model=list[SupportRequestOut], summary="My support requests")
async def my_support(
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> list[SupportRequestOut]:
    user_id = _require_user(auth)
    rows = await repository.list_support_for_user(user_id)
    return [_support_out(row, []) for row in rows]


@router.post("/support", response_model=SupportRequestOut, summary="Open a support request")
async def open_support(
    payload: SupportRequestIn,
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> SupportRequestOut:
    user_id = _require_user(auth)
    booking_id: Optional[str] = None
    if payload.booking_reference:
        booking = await repository.get_booking_for_user(payload.booking_reference, user_id)
        if not booking:
            raise BookingNotFoundError()
        booking_id = str(booking.get("id"))
        contact_email = str(booking.get("contact_email") or payload.contact_email or "")
    else:
        contact_email = str(payload.contact_email or "")

    created = await repository.create_support(
        {
            "booking_id": booking_id,
            "user_id": user_id,
            "contact_email": contact_email,
            "category": payload.category,
            "subject": payload.subject,
            "state": "open",
        }
    )
    if not created:
        raise OperationsUnavailableError()

    await repository.add_support_message(
        {
            "request_id": created.get("id"),
            "author_role": "customer",
            "author_id": user_id,
            "body": payload.message,
            "internal": False,
        }
    )
    await repository.record_notification(
        {
            "request_id": created.get("id"),
            "event_type": "support_request_created",
            "payload": {"reference": created.get("reference")},
        }
    )
    messages = await repository.support_messages(str(created.get("id")), include_internal=False)
    return _support_out(created, messages)


@router.get(
    "/support/{request_id}", response_model=SupportRequestOut, summary="Support request detail"
)
async def support_detail(
    request_id: str,
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> SupportRequestOut:
    user_id = _require_user(auth)
    row = await repository.get_support(request_id)
    if not row or str(row.get("user_id")) != user_id:
        raise SupportNotFoundError()
    # include_internal=False: admin-only replies never reach a customer.
    messages = await repository.support_messages(request_id, include_internal=False)
    return _support_out(row, messages)


@router.post(
    "/support/{request_id}/messages",
    response_model=SupportRequestOut,
    summary="Reply to my support request",
)
async def support_reply(
    request_id: str,
    payload: SupportReplyIn,
    auth: AuthContext = Depends(optional_user),
    repository: OperationsRepository = Depends(get_repository),
) -> SupportRequestOut:
    user_id = _require_user(auth)
    row = await repository.get_support(request_id)
    if not row or str(row.get("user_id")) != user_id:
        raise SupportNotFoundError()

    await repository.add_support_message(
        {
            "request_id": request_id,
            "author_role": "customer",
            "author_id": user_id,
            "body": payload.message,
            # A customer can never author an internal note.
            "internal": False,
        }
    )
    await repository.update_support(
        request_id, {"state": "open", "updated_at": datetime.now(timezone.utc).isoformat()}
    )
    messages = await repository.support_messages(request_id, include_internal=False)
    refreshed = await repository.get_support(request_id) or row
    return _support_out(refreshed, messages)


# -- admin ------------------------------------------------------------------


@router.get(
    "/admin/bookings", response_model=list[BookingListItemOut], summary="Admin booking list"
)
async def admin_bookings(
    product: Optional[str] = Query(default=None, pattern="^(flight|hotel)$"),
    booking_status: Optional[str] = Query(default=None, max_length=32),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    admin: AdminContext = Depends(require_admin(1)),
    repository: OperationsRepository = Depends(get_repository),
) -> list[BookingListItemOut]:
    filters: dict[str, str] = {}
    if product:
        filters["booking_type"] = f"eq.{product}"
    if booking_status:
        filters["status"] = f"eq.{booking_status}"
    rows = await repository.list_bookings_admin(filters=filters, limit=limit, offset=offset)
    return [_list_item(row) for row in rows]


@router.get(
    "/admin/bookings/{reference}",
    response_model=AdminBookingDetailOut,
    summary="Admin booking detail",
)
async def admin_booking(
    reference: str,
    admin: AdminContext = Depends(require_admin(1)),
    repository: OperationsRepository = Depends(get_repository),
) -> AdminBookingDetailOut:
    row = await repository.get_booking_admin(reference)
    if not row:
        raise BookingNotFoundError()
    payload, _ = await _detail(repository, row)
    # Internal notes are level 2+ material.
    notes = await repository.list_notes(str(row.get("id"))) if admin.level >= 2 else []
    return AdminBookingDetailOut(
        **payload,
        contact_email=row.get("contact_email"),
        contact_phone=row.get("contact_phone"),
        customer_type="account" if row.get("user_id") else "guest",
        provider=row.get("provider"),
        internal_notes=[
            InternalNoteOut(
                id=str(n.get("id")),
                body=str(n.get("body")),
                author_name=n.get("author_name"),
                created_at=n.get("created_at"),  # type: ignore[arg-type]
            )
            for n in notes
        ],
    )


@router.post(
    "/admin/bookings/{reference}/notes",
    response_model=InternalNoteOut,
    summary="Add an internal note (admin only)",
)
async def add_note(
    reference: str,
    payload: InternalNoteIn,
    admin: AdminContext = Depends(require_admin(2)),
    repository: OperationsRepository = Depends(get_repository),
) -> InternalNoteOut:
    row = await repository.get_booking_admin(reference)
    if not row:
        raise BookingNotFoundError()
    created = await repository.add_note(
        {
            "booking_id": row.get("id"),
            # Author comes from the verified admin context.
            "author_id": admin.user_id,
            "author_name": admin.display_name or admin.role,
            "body": payload.body,
        }
    )
    if not created:
        raise OperationsUnavailableError()
    return InternalNoteOut(
        id=str(created.get("id")),
        body=str(created.get("body")),
        author_name=created.get("author_name"),
        created_at=created.get("created_at"),  # type: ignore[arg-type]
    )


@router.patch(
    "/admin/bookings/{reference}/cancellation",
    response_model=CancellationRequestOut,
    summary="Decide a cancellation request (workflow only)",
)
async def decide_cancellation(
    reference: str,
    payload: CancellationDecisionIn,
    admin: AdminContext = Depends(require_admin(2)),
    repository: OperationsRepository = Depends(get_repository),
) -> CancellationRequestOut:
    row = await repository.get_booking_admin(reference)
    if not row:
        raise BookingNotFoundError()
    request = await repository.cancellation_for_booking(str(row.get("id")))
    if not request:
        raise BookingNotFoundError()

    # This records a decision. No TripJack cancellation and no Razorpay refund
    # is performed here — those arrive with the provider integrations.
    await repository.decide_cancellation(
        str(request.get("id")),
        {
            "state": payload.state,
            "refund_state": payload.refund_state,
            "decision_note": payload.decision_note,
            "decided_by": admin.user_id,
            "decided_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await repository.record_notification(
        {
            "booking_id": row.get("id"),
            "event_type": "cancellation_status_changed",
            "payload": {"booking_reference": reference, "state": payload.state},
        }
    )
    return CancellationRequestOut(
        id=str(request.get("id")),
        booking_reference=reference,
        reason_code=str(request.get("reason_code")),
        reason_note=request.get("reason_note"),
        state=payload.state,
        refund_state=payload.refund_state,
        decision_note=payload.decision_note,
        created_at=request.get("created_at"),  # type: ignore[arg-type]
        workflow_only=True,
    )


@router.get("/admin/support", response_model=list[SupportRequestOut], summary="Admin support list")
async def admin_support(
    support_state: Optional[str] = Query(default=None, max_length=32),
    category: Optional[str] = Query(default=None, max_length=32),
    limit: int = Query(default=50, ge=1, le=100),
    admin: AdminContext = Depends(require_admin(1)),
    repository: OperationsRepository = Depends(get_repository),
) -> list[SupportRequestOut]:
    filters: dict[str, str] = {}
    if support_state:
        filters["state"] = f"eq.{support_state}"
    if category:
        filters["category"] = f"eq.{category}"
    rows = await repository.list_support_admin(filters=filters, limit=limit)
    return [_support_out(row, []) for row in rows]


@router.patch(
    "/admin/support/{request_id}",
    response_model=SupportRequestOut,
    summary="Update a support request",
)
async def admin_update_support(
    request_id: str,
    payload: SupportUpdateIn,
    admin: AdminContext = Depends(require_admin(2)),
    repository: OperationsRepository = Depends(get_repository),
) -> SupportRequestOut:
    row = await repository.get_support(request_id)
    if not row:
        raise SupportNotFoundError()
    values: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.state:
        values["state"] = payload.state
    if payload.assign_to_me:
        values["assigned_to"] = admin.user_id
    await repository.update_support(request_id, values)
    await repository.record_notification(
        {
            "request_id": request_id,
            "event_type": "support_request_updated",
            "payload": {"state": payload.state},
        }
    )
    messages = await repository.support_messages(request_id, include_internal=True)
    refreshed = await repository.get_support(request_id) or row
    return _support_out(refreshed, messages)


@router.post(
    "/admin/support/{request_id}/messages",
    response_model=SupportRequestOut,
    summary="Reply to a support request",
)
async def admin_support_reply(
    request_id: str,
    payload: SupportReplyIn,
    admin: AdminContext = Depends(require_admin(2)),
    repository: OperationsRepository = Depends(get_repository),
) -> SupportRequestOut:
    row = await repository.get_support(request_id)
    if not row:
        raise SupportNotFoundError()
    await repository.add_support_message(
        {
            "request_id": request_id,
            "author_role": "admin",
            "author_id": admin.user_id,
            "author_name": admin.display_name or admin.role,
            "body": payload.message,
            "internal": payload.internal,
        }
    )
    await repository.update_support(
        request_id,
        {"state": "in_progress", "updated_at": datetime.now(timezone.utc).isoformat()},
    )
    messages = await repository.support_messages(request_id, include_internal=True)
    refreshed = await repository.get_support(request_id) or row
    return _support_out(refreshed, messages)


@router.get(
    "/admin/operations/metrics",
    response_model=OperationsMetricsOut,
    summary="Operational metrics (booking records, not analytics events)",
)
async def operations_metrics(
    admin: AdminContext = Depends(require_admin(1)),
    repository: OperationsRepository = Depends(get_repository),
) -> OperationsMetricsOut:
    rows = await repository.list_bookings_admin(filters={}, limit=100)
    today = datetime.now(timezone.utc).date().isoformat()
    support_open = await repository.list_support_admin(filters={"state": "eq.open"}, limit=100)
    return OperationsMetricsOut(
        total_bookings=len(rows),
        today_bookings=sum(1 for r in rows if str(r.get("created_at") or "").startswith(today)),
        pending_bookings=sum(
            1
            for r in rows
            if str(r.get("status"))
            in {"awaiting_payment", "payment_processing", "booking_processing"}
        ),
        failed_bookings=sum(
            1 for r in rows if str(r.get("status")) in {"failed", "payment_failed"}
        ),
        payment_pending=sum(
            1 for r in rows if _payment_status(str(r.get("status"))) in {"pending", "processing"}
        ),
        cancellation_requests=0,
        open_support=len(support_open),
        flight_bookings=sum(1 for r in rows if _product(r) == "flight"),
        hotel_bookings=sum(1 for r in rows if _product(r) == "hotel"),
    )
