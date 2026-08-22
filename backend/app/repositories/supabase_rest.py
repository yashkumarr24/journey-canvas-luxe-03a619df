"""Thin Supabase PostgREST helper shared by the Phase 7 repositories.

Uses the service-role key, which exists only in the FastAPI VPS environment.
RLS is therefore bypassed here BY DESIGN — every ownership rule is enforced in
the service layer from the verified auth context before a query is issued.

Nothing in this module logs row contents: only the table, the operation and
the HTTP status. Traveller and passport values never reach a log record.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

import httpx

from app.core.config import Settings
from app.core.logging import get_logger, log_extra

logger = get_logger(__name__)

TIMEOUT = 8.0


class SupabaseUnavailableError(RuntimeError):
    """The database could not be reached or refused the operation."""


class SupabaseRest:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def enabled(self) -> bool:
        return bool(self._settings.supabase_url and self._settings.supabase_service_role_key)

    def _url(self, table: str) -> str:
        return f"{self._settings.supabase_url.rstrip('/')}/rest/v1/{table}"

    def _headers(self, *, prefer: str | None = None) -> dict[str, str]:
        key = self._settings.supabase_service_role_key
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def _send(
        self,
        method: str,
        table: str,
        *,
        params: Mapping[str, Any] | None = None,
        json: Any = None,
        prefer: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self.enabled:
            raise SupabaseUnavailableError("supabase_not_configured")

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                response = await client.request(
                    method,
                    self._url(table),
                    params=params,
                    json=json,
                    headers=self._headers(prefer=prefer),
                )
        except httpx.HTTPError as exc:
            logger.warning("supabase_unreachable", extra=log_extra(table=table, method=method))
            raise SupabaseUnavailableError("supabase_unreachable") from exc

        if response.status_code >= 300:
            # Database detail stays server-side; callers get a generic failure.
            logger.warning(
                "supabase_error",
                extra=log_extra(table=table, method=method, status=response.status_code),
            )
            raise SupabaseUnavailableError(f"supabase_{response.status_code}")

        try:
            body = response.json()
        except ValueError:
            return []
        if isinstance(body, list):
            return body
        return [body] if isinstance(body, dict) else []

    # -- operations -------------------------------------------------------

    async def select(
        self,
        table: str,
        *,
        columns: str = "*",
        filters: Mapping[str, str],
        limit: int = 1,
        order: str | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"select": columns, "limit": limit, **filters}
        if order:
            params["order"] = order
        return await self._send("GET", table, params=params)

    async def insert(
        self,
        table: str,
        rows: Mapping[str, Any] | Sequence[Mapping[str, Any]],
        *,
        returning: bool = True,
    ) -> list[dict[str, Any]]:
        prefer = "return=representation" if returning else "return=minimal"
        return await self._send("POST", table, json=rows, prefer=prefer)

    async def update(
        self,
        table: str,
        values: Mapping[str, Any],
        *,
        filters: Mapping[str, str],
        returning: bool = False,
    ) -> list[dict[str, Any]]:
        prefer = "return=representation" if returning else "return=minimal"
        return await self._send("PATCH", table, params=dict(filters), json=values, prefer=prefer)

    async def delete(self, table: str, *, filters: Mapping[str, str]) -> None:
        await self._send("DELETE", table, params=dict(filters), prefer="return=minimal")
