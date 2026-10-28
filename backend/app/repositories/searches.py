"""Persistence for flight searches and fare references (PHASE 4 schema).

Writes go through Supabase PostgREST with the service-role key, which lives
only in the backend environment. Storage is deliberately minimal:

  * flight_searches   — the normalized query only (route, dates, pax, cabin).
  * search_result_refs — the opaque provider fare token + authoritative amount
                         + hard expiry, so booking can later re-price against a
                         server-held value instead of trusting the browser.

We never persist raw provider responses, authorization headers or credentials.
Persistence is best-effort: a database hiccup must not fail a customer's search.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Sequence

import httpx

from app.core.config import Settings
from app.core.logging import get_logger, log_extra
from app.schemas.flights import FlightResult, FlightSearchRequest

logger = get_logger(__name__)

# Every fare returned to the browser must have a server-side reference, or
# selecting it fails review. The adapter already caps each provider group,
# so refs are stored for all returned results, written in bounded chunks.
REF_INSERT_CHUNK = 100
TIMEOUT = 6.0


class SearchRepository:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def enabled(self) -> bool:
        return bool(self._settings.supabase_url and self._settings.supabase_service_role_key)

    def _headers(self, *, prefer: str) -> dict[str, str]:
        key = self._settings.supabase_service_role_key
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        }

    async def _post(self, table: str, rows: Any, *, prefer: str) -> list[dict[str, Any]]:
        url = f"{self._settings.supabase_url.rstrip('/')}/rest/v1/{table}"
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(url, json=rows, headers=self._headers(prefer=prefer))
        if response.status_code >= 300:
            # Database detail stays in logs; callers only learn it failed.
            logger.warning(
                "search_persist_failed",
                extra=log_extra(table=table, status=response.status_code),
            )
            return []
        try:
            body = response.json()
        except ValueError:
            return []
        return body if isinstance(body, list) else []

    async def record_search(
        self,
        request: FlightSearchRequest,
        *,
        user_id: str | None,
        currency: str,
    ) -> str | None:
        """Insert the search row and return its id, or None if unavailable."""
        if not self.enabled:
            return None

        row = {
            # user_id comes from the verified auth context, never from the body.
            "user_id": user_id,
            "origin": request.origin,
            "destination": request.destination,
            "departure_date": request.departure_date.isoformat() if request.departure_date else None,
            "return_date": request.return_date.isoformat() if request.return_date else None,
            "trip_type": request.trip_type,
            "adults": request.passengers.adults,
            "children": request.passengers.children,
            "infants": request.passengers.infants,
            "cabin_class": request.cabin_class,
            "currency": currency,
            # Multi-city legs (migration 0030); NULL for oneway/roundtrip so
            # historical rows and the existing scalar columns stay authoritative.
            "routes": (
                [
                    {
                        "from": leg.origin,
                        "to": leg.destination,
                        "travelDate": leg.departure_date.isoformat(),
                    }
                    for leg in request.legs
                ]
                if request.legs
                else None
            ),
        }

        try:
            inserted = await self._post("flight_searches", row, prefer="return=representation")
        except httpx.HTTPError:
            logger.warning("search_persist_unavailable")
            return None

        search_id = inserted[0].get("id") if inserted else None
        return search_id if isinstance(search_id, str) else None

    async def record_result_refs(
        self,
        search_id: str,
        results: Sequence[FlightResult],
        *,
        expires_at: datetime,
    ) -> set[str]:
        """Store fare tokens with their server-side authoritative amount.

        Returns the result ids whose reference rows were confirmed written;
        the caller must not offer any other result for selection.
        """
        if not self.enabled or not search_id or not results:
            return set()

        rows = [
            {
                "_result_id": result.id,
                "search_kind": "flight",
                "flight_search_id": search_id,
                "provider": "tripjack",
                "provider_ref": result.fare.fare_id or result.id,
                # JSONB list (VPS migration 0022_flight_provider_price_refs);
                # one TripJack priceId per row today, list-shaped so a future
                # documented multi-ID selection needs no schema change.
                "provider_refs": _provider_refs(result),
                "total_amount": result.fare.total_price.amount,
                "currency": result.fare.total_price.currency,
                "expires_at": expires_at.isoformat(),
            }
            for result in results
            if result.fare.fare_id or result.id
        ]
        if not rows:
            return set()

        stored: set[str] = set()
        for start in range(0, len(rows), REF_INSERT_CHUNK):
            chunk = rows[start : start + REF_INSERT_CHUNK]
            payload = [{k: v for k, v in row.items() if k != "_result_id"} for row in chunk]
            try:
                ok = await self._insert_ok("search_result_refs", payload)
            except httpx.HTTPError:
                ok = False
            if not ok:
                logger.warning("result_refs_persist_unavailable")
                break  # remaining chunks are not attempted; their fares stay unselectable
            stored.update(row["_result_id"] for row in chunk)
        return stored

    async def _insert_ok(self, table: str, rows: Any) -> bool:
        url = f"{self._settings.supabase_url.rstrip('/')}/rest/v1/{table}"
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(url, json=rows, headers=self._headers(prefer="return=minimal"))
        if response.status_code >= 300:
            logger.warning("search_persist_failed", extra=log_extra(table=table, status=response.status_code))
            return False
        return True


def _provider_refs(result: FlightResult) -> list[str]:
    """The fare's full provider reference list, never collapsed.

    VPS fares may carry several ids (combined return / Special Return);
    those are stored verbatim. Otherwise fall back to the single primary ref.
    """
    refs = getattr(result.fare, "provider_refs", None)
    if isinstance(refs, (list, tuple)):
        cleaned = [str(r) for r in refs if r]
        if cleaned:
            return cleaned
    return [result.fare.fare_id or result.id]
