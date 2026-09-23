"""Local TripJack hotel catalogue (migration 0012). service_role only.

Idempotent upserts keyed on TripJack ids; no duplicates. Nothing here is a
source of price or availability.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.config import Settings
from app.repositories.supabase_rest import SupabaseRest

_SAFE = re.compile(r"[^A-Za-z0-9 _\-.'&]")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _in(ids: list[str]) -> str:
    return "in.(" + ",".join('"' + i.replace('"', "") + '"' for i in ids) + ")"


class HotelCatalogueRepository:
    def __init__(self, settings: Settings) -> None:
        self._db = SupabaseRest(settings)

    @property
    def enabled(self) -> bool:
        return self._db.enabled

    # -- writes ---------------------------------------------------------------

    async def upsert_countries(self, names: list[str]) -> None:
        if names:
            ts = now_iso()
            await self._db.upsert(
                "hotel_countries", [{"name": n, "last_synced_at": ts} for n in names], on_conflict="name"
            )

    async def upsert_regions(self, rows: list[dict]) -> None:
        if rows:
            ts = now_iso()
            await self._db.upsert(
                "hotel_regions", [{**r, "last_synced_at": ts} for r in rows], on_conflict="city_region_id"
            )

    async def upsert_mappings(self, rows: list[dict], *, reset_content: bool = False) -> None:
        """Upsert mappings. `reset_content` queues their static content refresh."""
        if not rows:
            return
        ts = now_iso()
        unique = {r["tj_hotel_id"]: r for r in rows}
        payload = []
        for r in unique.values():
            row = {**r, "is_deleted": False, "deleted_at": None, "last_synced_at": ts}
            if reset_content:
                row["content_synced_at"] = None
                row["content_error_at"] = None
            payload.append(row)
        await self._db.upsert("hotel_mappings", payload, on_conflict="tj_hotel_id")

    async def pending_content_ids(self, run_started_at: str, limit: int = 100) -> list[str]:
        rows = await self._db.select(
            "hotel_mappings",
            columns="tj_hotel_id",
            filters={
                "content_synced_at": "is.null",
                "is_deleted": "is.false",
                "or": f"(content_error_at.is.null,content_error_at.lt.{run_started_at})",
            },
            limit=limit,
            order="tj_hotel_id",
        )
        return [r["tj_hotel_id"] for r in rows]

    async def save_content(self, items: list[dict]) -> list[str]:
        if not items:
            return []
        ts = now_iso()
        hotels = [{**i["hotel"], "last_synced_at": ts} for i in items]
        ids = [h["tj_hotel_id"] for h in hotels]
        await self._db.upsert("hotels", hotels, on_conflict="tj_hotel_id")
        # Replace child rows for exactly these hotels (idempotent re-sync).
        for table, key in (("hotel_images", "images"), ("hotel_amenities", "amenities"), ("hotel_rooms", "rooms")):
            await self._db.delete(table, filters={"tj_hotel_id": _in(ids)})
            rows = [row for i in items for row in i[key]]
            if table == "hotel_rooms":
                rows = list({(r["tj_hotel_id"], r["room_key"]): r for r in rows}.values())
            if rows:
                await self._db.insert(table, rows, returning=False)
        await self._db.update(
            "hotel_mappings",
            {"content_synced_at": ts, "content_error_at": None},
            filters={"tj_hotel_id": _in(ids)},
        )
        return ids

    async def mark_content_failed(self, ids: list[str]) -> None:
        if ids:
            await self._db.update(
                "hotel_mappings", {"content_error_at": now_iso()}, filters={"tj_hotel_id": _in(ids)}
            )

    async def mark_deleted(self, ids: list[str]) -> None:
        """Soft delete: historical booking/search records stay intact."""
        if not ids:
            return
        ts = now_iso()
        await self._db.update(
            "hotel_mappings", {"is_deleted": True, "deleted_at": ts}, filters={"tj_hotel_id": _in(ids)}
        )
        await self._db.update(
            "hotels", {"is_active": False, "deleted_at": ts}, filters={"tj_hotel_id": _in(ids)}
        )

    # -- sync state -------------------------------------------------------------

    async def get_state(self, sync_type: str) -> Optional[dict]:
        rows = await self._db.select("hotel_sync_state", filters={"sync_type": f"eq.{sync_type}"})
        return rows[0] if rows else None

    async def put_state(self, sync_type: str, values: dict[str, Any]) -> None:
        await self._db.upsert(
            "hotel_sync_state",
            {"sync_type": sync_type, **values, "updated_at": now_iso()},
            on_conflict="sync_type",
        )

    async def all_states(self) -> list[dict]:
        return await self._db.select("hotel_sync_state", filters={}, limit=10)

    async def counts(self) -> dict:
        rows = await self._db.select("hotel_catalogue_counts", filters={}, limit=1)
        return rows[0] if rows else {}

    # -- search-time reads --------------------------------------------------------

    async def resolve_hids(self, destination: str, limit: int = 200) -> list[str]:
        term = _SAFE.sub("", destination or "").strip()
        if len(term) < 2:
            return []
        regions = await self._db.select(
            "hotel_regions",
            columns="city_region_id",
            filters={"or": f"(city_name.ilike.{term}*,region_name.ilike.{term}*)"},
            limit=50,
        )
        region_ids = [r["city_region_id"] for r in regions]
        if not region_ids:
            return []
        mappings = await self._db.select(
            "hotel_mappings",
            columns="tj_hotel_id",
            filters={"region_id": _in(region_ids), "is_deleted": "is.false"},
            limit=limit * 2,
        )
        ids = [m["tj_hotel_id"] for m in mappings]
        if not ids:
            return []
        inactive = await self._db.select(
            "hotels", columns="tj_hotel_id",
            filters={"tj_hotel_id": _in(ids), "is_active": "is.false"}, limit=len(ids),
        )
        blocked = {r["tj_hotel_id"] for r in inactive}
        return [i for i in ids if i not in blocked][:limit]

    async def static_for(self, ids: list[str]) -> dict[str, dict]:
        if not ids:
            return {}
        hotels = await self._db.select(
            "hotels",
            columns="tj_hotel_id,name,star_rating,property_type,address,city,country,latitude,longitude,"
            "hotel_images(url,caption,position),hotel_amenities(name)",
            filters={"tj_hotel_id": _in(ids), "is_active": "is.true"},
            limit=len(ids),
        )
        return {h["tj_hotel_id"]: h for h in hotels}
