"""Flight endpoints (v1).

PHASE 6 scope: SEARCH ONLY. No selection, re-pricing, booking, ticketing or
payment lives here yet.

Guests may search; an authenticated caller's search is attributed to them via
the verified token only.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.schemas.common import ErrorResponse
from app.schemas.flights import FlightSearchRequest, FlightSearchResponse
from app.services import flight_search as flight_search_service

router = APIRouter(prefix="/api/v1/flights", tags=["flights"])


@router.post(
    "/search",
    response_model=FlightSearchResponse,
    response_model_exclude_none=True,
    summary="Search flights",
    responses={
        422: {"model": ErrorResponse, "description": "Invalid search"},
        429: {"model": ErrorResponse, "description": "Rate limited"},
        503: {"model": ErrorResponse, "description": "Provider unavailable"},
        504: {"model": ErrorResponse, "description": "Provider timeout"},
    },
)
async def search_flights(
    payload: FlightSearchRequest,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> FlightSearchResponse:
    return await flight_search_service.search_flights(
        request=request,
        payload=payload,
        auth=auth,
        settings=settings,
    )
