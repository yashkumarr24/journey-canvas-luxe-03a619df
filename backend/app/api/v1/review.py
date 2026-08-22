"""Flight selection / review / traveller endpoints (v1, PHASE 7).

Scope stops at a DRAFT booking awaiting payment. No payment, no ticket
issuance, no production inventory.

Guests are supported: the server issues a `guestToken` once, on selection, and
requires it to resume that session. Handlers stay thin; all rules live in
`app.services.flight_booking`.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, Query, Request

from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.schemas.common import ErrorResponse
from app.schemas.review import (
    FlightReviewResponse,
    FlightSelectionRequest,
    TravellerDetailsRequest,
    TravellerDetailsResponse,
)
from app.services import flight_booking as booking_service

router = APIRouter(prefix="/api/v1/flights", tags=["flights"])

COMMON_ERRORS = {
    404: {"model": ErrorResponse, "description": "Session not found"},
    409: {"model": ErrorResponse, "description": "Fare expired, unavailable or re-priced"},
    422: {"model": ErrorResponse, "description": "Invalid request"},
    429: {"model": ErrorResponse, "description": "Rate limited"},
    503: {"model": ErrorResponse, "description": "Provider unavailable"},
}


@router.post(
    "/select",
    response_model=FlightReviewResponse,
    response_model_exclude_none=True,
    summary="Select a fare and revalidate it with the provider",
    responses=COMMON_ERRORS,
)
async def select_flight(
    payload: FlightSelectionRequest,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> FlightReviewResponse:
    return await booking_service.select_flight(
        request=request, payload=payload, auth=auth, settings=settings
    )


@router.get(
    "/review/{review_token}",
    response_model=FlightReviewResponse,
    response_model_exclude_none=True,
    summary="Re-read a stored review session",
    responses=COMMON_ERRORS,
)
async def get_review(
    review_token: str,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
    # Guest continuity travels in a header so it never lands in access logs,
    # browser history or a shared URL.
    guest_token: Optional[str] = Header(default=None, alias="X-Guest-Token"),
    guest_token_query: Optional[str] = Query(default=None, include_in_schema=False, alias="guestToken"),
) -> FlightReviewResponse:
    return await booking_service.get_review(
        review_token=review_token,
        guest_token=guest_token or guest_token_query,
        auth=auth,
        settings=settings,
    )


@router.post(
    "/travellers",
    response_model=TravellerDetailsResponse,
    response_model_exclude_none=True,
    summary="Submit traveller details and create a draft booking",
    responses=COMMON_ERRORS,
)
async def submit_travellers(
    payload: TravellerDetailsRequest,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> TravellerDetailsResponse:
    return await booking_service.submit_travellers(
        request=request, payload=payload, auth=auth, settings=settings
    )
