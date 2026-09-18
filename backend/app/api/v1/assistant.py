"""AI travel assistant endpoint (v1) — PHASE 12.

    POST /api/v1/assistant/interpret

Scope: turn a natural-language message into VALIDATED search requirements.
This endpoint never searches, never re-prices, never books and never returns a
fare, a fare id or availability. The caller takes the requirements to
/api/v1/flights/search, which is the only path to a provider.

Rules
  * Guests may use the assistant. When a bearer token is present the user id
    comes from the VERIFIED token only; a body-supplied id is ignored.
  * Input is sanitised and length-capped by the schema before it reaches a
    provider, and the conversation history is trimmed.
  * Rate limited per user (or per client IP for guests).
  * Provider credentials stay in backend settings and are never returned.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.core.rate_limit import SlidingWindowLimiter, client_identity
from app.integrations.ai.base import AssistantUnavailableError
from app.schemas.assistant import AssistantTurnRequest
from app.schemas.common import ErrorResponse
from app.services.assistant import AssistantService

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/assistant", tags=["assistant"])

# A person typing a trip description sends a handful of messages per minute.
_limiter = SlidingWindowLimiter(limit=20, window_seconds=60.0)


@router.post(
    "/interpret",
    summary="Turn a natural-language travel request into validated search requirements",
    responses={
        422: {"model": ErrorResponse, "description": "Invalid message or requirements"},
        429: {"model": ErrorResponse, "description": "Rate limited"},
        503: {"model": ErrorResponse, "description": "Assistant unavailable"},
    },
)
async def interpret(
    payload: AssistantTurnRequest,
    request: Request,
    auth: AuthContext = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> JSONResponse:
    _limiter.check(client_identity(request, auth.user_id))

    service = AssistantService(settings)
    try:
        response = await service.interpret(payload)
    except AssistantUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=error.message
        ) from error

    # Serialised with camelCase aliases to match the frontend contract.
    return JSONResponse(content=response.model_dump(by_alias=True, mode="json"))
