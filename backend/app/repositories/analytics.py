"""Analytics persistence (PHASE 10).

Writes go to Supabase PostgREST with the service-role key, which exists only in
the backend environment. When Supabase is not configured (local development, or
before the VPS is provisioned) the repository falls back to a bounded in-memory
buffer so the endpoints and the admin dashboard remain testable.

Every write is BEST EFFORT: an analytics failure is logged and swallowed so it
can never break a search, a checkout or a booking.

The queue-friendly shape here is deliberate — swapping the in-memory buffer for
Redis/Celery later means changing only this file. No queue is added yet.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional

from app.core.config import Settings
from app.core.logging import get_logger, log_extra
from app.repositories.supabase_rest import SupabaseRest, SupabaseUnavailableError
from app.schemas.analytics import EventIn, SessionUpsert

logger = get_logger(__name__)

MAX_MEMORY_EVENTS = 5000
MAX_MEMORY_SESSIONS = 1000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AnalyticsRepository:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._rest = SupabaseRest(settings)
        self._events: Deque[Dict[str, Any]] = deque(maxlen=MAX_MEMORY_EVENTS)
        self._sessions: Dict[str, Dict[str, Any]] = {}

    @property
    def persistent(self) -> bool:
        return self._rest.enabled

    # ---- sessions --------------------------------------------------------

    async def upsert_session(self, payload: SessionUpsert, user_id: Optional[str]) -> None:
        row = {
            "session_id": payload.session_id,
            # The user id is taken from the VERIFIED token, never from the body.
            "user_id": user_id,
            "current_page": payload.current_page,
            "device_category": payload.device,
            "browser": payload.browser,
            "platform": payload.platform,
            "last_activity_at": _now(),
            "status": "active",
        }
        if payload.started_at:
            row["started_at"] = payload.started_at.isoformat()

        if not self.persistent:
            existing = self._sessions.get(payload.session_id, {})
            merged = {**existing, **{k: v for k, v in row.items() if v is not None}}
            merged.setdefault("started_at", _now())
            self._sessions[payload.session_id] = merged
            if len(self._sessions) > MAX_MEMORY_SESSIONS:
                self._sessions.pop(next(iter(self._sessions)))
            return

        try:
            await self._rest.upsert("user_sessions", [row], on_conflict="session_id")
        except SupabaseUnavailableError:
            logger.warning("analytics_session_write_skipped")

    async def end_session(self, session_id: str) -> None:
        if not self.persistent:
            session = self._sessions.get(session_id)
            if session:
                session["status"] = "ended"
                session["ended_at"] = _now()
            return
        try:
            await self._rest.update(
                "user_sessions",
                {"status": "ended", "ended_at": _now()},
                filters={"session_id": f"eq.{session_id}"},
            )
        except SupabaseUnavailableError:
            logger.warning("analytics_session_end_skipped")

    # ---- events ----------------------------------------------------------

    async def insert_events(self, events: List[EventIn], user_id: Optional[str]) -> int:
        rows = [
            {
                "session_id": event.session_id,
                "user_id": user_id,
                "event_name": event.name,
                "page": event.page,
                "props": event.props,
                "occurred_at": (event.occurred_at or datetime.now(timezone.utc)).isoformat(),
            }
            for event in events
        ]
        if not rows:
            return 0

        if not self.persistent:
            self._events.extend(rows)
            for row in rows:
                session = self._sessions.setdefault(
                    row["session_id"], {"session_id": row["session_id"], "started_at": _now()}
                )
                session["last_activity_at"] = row["occurred_at"]
                session["current_page"] = row.get("page") or session.get("current_page")
                session["user_id"] = user_id or session.get("user_id")
                session.setdefault("status", "active")
            return len(rows)

        try:
            await self._rest.insert("activity_events", rows)
        except SupabaseUnavailableError:
            logger.warning("analytics_events_write_skipped", extra=log_extra(count=len(rows)))
            return 0
        return len(rows)

    # ---- admin reads -----------------------------------------------------

    async def recent_sessions(self, limit: int = 200) -> List[Dict[str, Any]]:
        if not self.persistent:
            return list(self._sessions.values())[-limit:]
        try:
            return await self._rest.select(
                "user_sessions",
                filters={},
                limit=limit,
                order="last_activity_at.desc",
            )
        except SupabaseUnavailableError:
            return []

    async def recent_events(self, limit: int = 2000) -> List[Dict[str, Any]]:
        if not self.persistent:
            return list(self._events)[-limit:]
        try:
            return await self._rest.select(
                "activity_events",
                filters={},
                limit=limit,
                order="occurred_at.desc",
            )
        except SupabaseUnavailableError:
            return []
