"""Shared response schemas."""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    checks: Dict[str, bool] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    success: Literal[False] = False
    code: str
    message: str
    request_id: Optional[str] = None
    details: Optional[Any] = None
