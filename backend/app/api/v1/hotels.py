"""Hotel endpoints (v1).

Scope: search -> detail -> room selection/re-price -> guest details (DRAFT).
No payment, no provider booking, no voucher — those stay PENDING until the
TripJack hotel booking contract is confirmed (see `tripjack/hotel_wire.py`).

Guests may search and select; a guest session is continued with an opaque
`X-Guest-Token` header so it never lands in access logs or shared URLs.
Handlers stay thin; all rules live in `app.services.hotel_search`.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, Query, Request

from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.schemas.common import ErrorResponse
from app.schemas.hotels import (
    HotelDetailRequest,
    HotelDetailResponse,
    HotelGuestDetailsRequest,
    HotelGuestDetailsResponse,
    HotelReviewResponse,
    HotelSearchRequest,
    HotelSearchResponse,
    HotelSelectionRequest,
)
from app.schemas.hotel_booking import (
    PUBLIC_STATUS,
    HotelBookingActionRequest,
    HotelBookingView,
    HotelBookRequest,
    HotelBookResult,
)
from app.services import hotel_booking as booking_service
from app.services import hotel_search as hotel_service

router = APIRouter(prefix="/api/v1/hotels", tags=["hotels"])

COMMON_ERRORS = {
    404: {"model": ErrorResponse, "description": "Hotel or session not found"},
    409: {"model": ErrorResponse, "description": "Search expired, room gone or re-priced"},
    422: {"model": ErrorResponse, "description": "Invalid request"},
    429: {"model": ErrorResponse, "description": "Rate limited"},
    503: {"model": ErrorResponse, "description": "Provider unavailable"},
    504: {"model": ErrorResponse, "description": "Provider timeout"},
}


@router.post(
    "/search",
    response_model=HotelSearchResponse,
    response_model_exclude_none=True,
    summary="Search hotels",
    responses=COMMON_ERRORS,
)
async def search_hotels(
    payload: HotelSearchRequest,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> HotelSearchResponse:
    return await hotel_service.search_hotels(
        request=request, payload=payload, auth=auth, settings=settings
    )


@router.post(
    "/detail",
    response_model=HotelDetailResponse,
    response_model_exclude_none=True,
    summary="Hotel detail with sellable room options",
    responses=COMMON_ERRORS,
)
async def hotel_detail(
    payload: HotelDetailRequest,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> HotelDetailResponse:
    return await hotel_service.hotel_detail(
        request=request, payload=payload, auth=auth, settings=settings
    )


@router.post(
    "/review",
    response_model=HotelReviewResponse,
    response_model_exclude_none=True,
    summary="Select a room and revalidate the rate with the provider",
    responses=COMMON_ERRORS,
)
async def review_hotel(
    payload: HotelSelectionRequest,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> HotelReviewResponse:
    return await hotel_service.select_room(
        request=request, payload=payload, auth=auth, settings=settings
    )


@router.get(
    "/review/{review_token}",
    response_model=HotelReviewResponse,
    response_model_exclude_none=True,
    summary="Re-read a stored hotel review session",
    responses=COMMON_ERRORS,
)
async def get_hotel_review(
    review_token: str,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
    guest_token: Optional[str] = Header(default=None, alias="X-Guest-Token"),
    guest_token_query: Optional[str] = Query(
        default=None, include_in_schema=False, alias="guestToken"
    ),
) -> HotelReviewResponse:
    return await hotel_service.get_review(
        review_token=review_token,
        guest_token=guest_token or guest_token_query,
        auth=auth,
        settings=settings,
    )


@router.post(
    "/guests",
    response_model=HotelGuestDetailsResponse,
    response_model_exclude_none=True,
    summary="Submit guest details and create a draft hotel booking",
    responses=COMMON_ERRORS,
)
async def submit_hotel_guests(
    payload: HotelGuestDetailsRequest,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> HotelGuestDetailsResponse:
    return await hotel_service.submit_guests(
        request=request, payload=payload, auth=auth, settings=settings
    )


# ============================ booking lifecycle ============================


def _view(b: booking_service.HotelBooking) -> HotelBookingView:
    from datetime import datetime, timezone

    status = PUBLIC_STATUS.get(b.status, "booking_processing")
    deadline = booking_service._dt(b.hold_deadline)
    hold_open = b.status == booking_service.ON_HOLD and deadline is not None \
        and datetime.now(timezone.utc) < deadline
    if b.status == booking_service.ON_HOLD and not hold_open and deadline is not None:
        status = "expired"
    guests = [
        {"type": g.get("type") or "adult", "title": g.get("title"),
         "full_name": f"{g.get('first_name', '')} {g.get('last_name', '')}".strip() or "Guest",
         "room_index": int(g.get("room_index") or 1), "is_lead": bool(g.get("is_lead"))}
        for g in b.guests
    ]
    contact = {k: v for k, v in (b.contact or {}).items() if k in ("email", "phone", "dial_code")}
    return HotelBookingView(
        booking_reference=b.booking_reference, status=status, lifecycle_status=b.status,
        mode=b.mode, hotel=b.hotel, room=b.room, stay=b.stay,
        total_payable={"amount": b.total_amount, "currency": b.currency},
        guests=guests, contact={("dialCode" if k == "dial_code" else k): v for k, v in contact.items()},
        special_requests=b.special_requests, hold_deadline=b.hold_deadline,
        hotel_confirmation_number=b.hotel_confirmation_number,
        provider_cancellation=b.cancellation, status_message=b.status_message,
        can_confirm_hold=hold_open,
        can_cancel=b.status in (booking_service.CONFIRMED, booking_service.ON_HOLD),
    )


def _result(b: booking_service.HotelBooking) -> HotelBookResult:
    v = _view(b)
    return HotelBookResult(status=v.status, booking=v, message=v.status_message)


@router.post("/booking", response_model=HotelBookResult, response_model_exclude_none=True,
             summary="Book a reviewed hotel room (instant or hold)", responses=COMMON_ERRORS)
async def book_hotel(
    payload: HotelBookRequest,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> HotelBookResult:
    b = await booking_service.book(
        settings=settings, reference=payload.booking_reference, mode=payload.mode,
        user_id=auth.user_id, guest_token=payload.guest_token,
        idempotency_key=payload.idempotency_key,
        payment_verified=False,  # no server-side payment verification exists yet
    )
    return _result(b)


@router.get("/bookings/{reference}", response_model=HotelBookingView,
            response_model_exclude_none=True, summary="Hotel booking status", responses=COMMON_ERRORS)
async def get_hotel_booking(
    reference: str,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
    guest_token: Optional[str] = Header(default=None, alias="X-Guest-Token"),
) -> HotelBookingView:
    b = await booking_service.get_booking(
        settings=settings, reference=reference.strip().upper(), user_id=auth.user_id,
        guest_token=guest_token)
    return _view(b)


@router.post("/bookings/{reference}/confirm", response_model=HotelBookResult,
             response_model_exclude_none=True, summary="Confirm a held booking", responses=COMMON_ERRORS)
async def confirm_hotel_hold(
    reference: str,
    payload: HotelBookingActionRequest,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> HotelBookResult:
    b = await booking_service.confirm_hold(
        settings=settings, reference=reference.strip().upper(), user_id=auth.user_id,
        guest_token=payload.guest_token, payment_verified=False)
    return _result(b)


@router.post("/bookings/{reference}/cancel", response_model=HotelBookResult,
             response_model_exclude_none=True, summary="Cancel a booking or hold", responses=COMMON_ERRORS)
async def cancel_hotel_booking(
    reference: str,
    payload: HotelBookingActionRequest,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> HotelBookResult:
    b = await booking_service.cancel(
        settings=settings, reference=reference.strip().upper(), user_id=auth.user_id,
        guest_token=payload.guest_token)
    return _result(b)
