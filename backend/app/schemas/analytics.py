"""Analytics request/response contracts (PHASE 10).

Validation is strict on purpose: analytics is a PUBLIC ingest surface, so the
payload shape, sizes and character sets are all bounded, and forbidden property
keys are dropped server-side even if a client sends them.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{8,64}$")
EVENT_NAME_RE = re.compile(r"^[a-z0-9_]{3,60}$")

# Mirrors src/lib/analytics/events.ts — never store a value under these keys.
BLOCKED_PROP_KEY = re.compile(
    r"pass|pwd|otp|cvv|card|secret|apikey|api_key|token|auth|email|phone|mobile|pan|passport|dob|address",
    re.IGNORECASE,
)
MAX_PROPS = 20
MAX_STRING = 120


def sanitize_props(props: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Drop forbidden keys, cap size, coerce to primitives."""
    if not props:
        return {}
    clean: Dict[str, Any] = {}
    for raw_key, value in props.items():
        if len(clean) >= MAX_PROPS:
            break
        key = str(raw_key)[:40]
        if BLOCKED_PROP_KEY.search(key):
            continue
        if value is None or isinstance(value, bool):
            clean[key] = value
        elif isinstance(value, (int, float)):
            clean[key] = value
        elif isinstance(value, str):
            clean[key] = value[:MAX_STRING]
    return clean


class SessionUpsert(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    session_id: str = Field(alias="sessionId")
    user_id: Optional[str] = Field(default=None, alias="userId")
    started_at: Optional[datetime] = Field(default=None, alias="startedAt")
    current_page: Optional[str] = Field(default=None, alias="currentPage", max_length=60)
    device: Optional[Literal["desktop", "tablet", "mobile"]] = None
    browser: Optional[str] = Field(default=None, max_length=40)
    platform: Optional[str] = Field(default=None, max_length=40)

    @field_validator("session_id")
    @classmethod
    def _session_id(cls, value: str) -> str:
        if not SESSION_ID_RE.match(value):
            raise ValueError("invalid session id")
        return value


class SessionEnd(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    session_id: str = Field(alias="sessionId")

    @field_validator("session_id")
    @classmethod
    def _session_id(cls, value: str) -> str:
        if not SESSION_ID_RE.match(value):
            raise ValueError("invalid session id")
        return value


class EventIn(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: Optional[str] = Field(default=None, max_length=64)
    session_id: str = Field(alias="sessionId")
    user_id: Optional[str] = Field(default=None, alias="userId")
    name: str
    page: Optional[str] = Field(default=None, max_length=60)
    props: Dict[str, Any] = Field(default_factory=dict)
    occurred_at: Optional[datetime] = Field(default=None, alias="occurredAt")

    @field_validator("session_id")
    @classmethod
    def _session_id(cls, value: str) -> str:
        if not SESSION_ID_RE.match(value):
            raise ValueError("invalid session id")
        return value

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if not EVENT_NAME_RE.match(value):
            raise ValueError("invalid event name")
        return value

    @field_validator("props")
    @classmethod
    def _props(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        return sanitize_props(value)


class EventBatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Bounded batch: a client cannot flood one request with events.
    events: List[EventIn] = Field(min_length=1, max_length=50)


class Ack(BaseModel):
    accepted: int = 0
    status: Literal["ok"] = "ok"


# ---- admin read models ----------------------------------------------------


class OverviewOut(BaseModel):
    active_sessions: int = 0
    total_sessions: int = 0
    authenticated_users: int = 0
    guest_sessions: int = 0
    flight_searches: int = 0
    hotel_searches: int = 0
    checkouts_started: int = 0
    payments_started: int = 0
    bookings_completed: int = 0
    bookings_failed: int = 0
    abandoned_sessions: int = 0
    conversion_rate: float = 0.0
    total_events: int = 0


class ActivityRow(BaseModel):
    session_id: str
    identity: Literal["Guest", "User"]
    current_page: Optional[str] = None
    last_event: Optional[str] = None
    device: Optional[str] = None
    last_activity_at: Optional[datetime] = None


class FunnelRowOut(BaseModel):
    key: str
    label: str
    event_count: int = 0
    unique_sessions: int = 0
    unique_users: int = 0
    reached_pct: float = 0.0
    dropped_sessions: int = 0


class AdminIdentityOut(BaseModel):
    id: str
    email: str
    display_name: str = Field(serialization_alias="displayName")
    role: Literal["staff", "manager", "owner"]
    level: int
    status: Literal["active", "suspended"] = "active"
    last_sign_in_at: Optional[datetime] = Field(default=None, serialization_alias="lastSignInAt")
