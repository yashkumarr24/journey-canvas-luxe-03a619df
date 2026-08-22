"""Liveness and readiness endpoints.

Responses are intentionally minimal: no versions of dependencies, no
hostnames, no environment values, no credential state.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.config import get_settings
from app.schemas.common import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, summary="Liveness probe")
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/health/ready", response_model=ReadinessResponse, summary="Readiness probe")
async def readiness(response: Response) -> ReadinessResponse:
    # Booleans only: no hostnames, no key material, no connection strings.
    # `flight_provider` reports whether TripJack is CONFIGURED, not whether a
    # key is valid — probing the provider on every health check would burn
    # quota and leak whitelist state.
    settings = get_settings()
    checks = {
        "app": True,
        "flight_provider": bool(settings.tripjack_base_url and settings.tripjack_api_key),
    }
    # Readiness tracks whether the process can serve traffic. A missing
    # provider key degrades flight search but must not take the app out of
    # the load balancer (the rest of the site still works).
    ready = checks["app"]
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(status="ready" if ready else "not_ready", checks=checks)
