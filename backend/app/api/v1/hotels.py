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
    return hotel_service.submit_guests(
        request=request, payload=payload, auth=auth, settings=settings
    )
