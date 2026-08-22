"""Liveness and readiness endpoints.

Responses are intentionally minimal: no versions of dependencies, no
hostnames, no environment values, no credential state.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.schemas.common import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, summary="Liveness probe")
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health/ready", response_model=ReadinessResponse, summary="Readiness probe")
async def readiness(response: Response) -> ReadinessResponse:
    # Phase 2: the app itself is the only dependency. Later this will also
    # check Supabase, TripJack session validity and Razorpay reachability —
    # each reported as a boolean, never with connection details.
    checks = {"app": True}
    ready = all(checks.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(status="ready" if ready else "not_ready", checks=checks)
