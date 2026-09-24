"""TripJack Hotel v3 static catalogue synchronisation (admin/ops only).

Full:        countries -> city/region ids -> hotel mapping -> hotel content
Incremental: mapping-sync NEW/UPDATE -> content refresh;  deleted mapping -> soft delete

Resumable: progress is written to `hotel_sync_state.cursor` after every page,
and pending static content is tracked per mapping row (`content_synced_at`), so
a crash simply continues where it stopped. Never run on customer searches.

CLI (cron on the VPS):  python -m app.services.hotel_catalogue_sync full|incremental
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from typing import Optional

from app.core.config import Settings, get_settings
from app.core.logging import get_logger, log_extra
from app.integrations.tripjack import hotel_content as content
from app.integrations.tripjack.client import get_hotel_client
from app.integrations.tripjack.config import build_hotel_config
from app.repositories.hotel_catalogue import HotelCatalogueRepository, now_iso

logger = get_logger(__name__)

_lock = asyncio.Lock()
MAX_CONTENT_BATCHES_PER_RUN = 100_000


def is_running() -> bool:
    return _lock.locked()


def _client(settings: Settings):
    return get_hotel_client(build_hotel_config(settings))


async def _content_phase(repo: HotelCatalogueRepository, client, run_started: str, sync_type: str,
                         processed: int, failed: int) -> tuple[int, int]:
    for _ in range(MAX_CONTENT_BATCHES_PER_RUN):
        ids = await repo.pending_content_ids(run_started, content.CONTENT_BATCH)
        if not ids:
            break
        try:
            raw = await content.fetch_content(client, ids)
            items = [i for i in (content.normalise_content(r) for r in raw) if i]
            saved = set(await repo.save_content(items))
            missing = [i for i in ids if i not in saved]
            await repo.mark_content_failed(missing)
            processed += len(saved)
            failed += len(missing)
        except Exception as exc:  # isolate the batch, keep going
            logger.warning("hotel_content_batch_failed", extra=log_extra(kind=type(exc).__name__, size=len(ids)))
            await repo.mark_content_failed(ids)
            failed += len(ids)
        await repo.put_state(sync_type, {"processed_count": processed, "failed_count": failed})
    return processed, failed


async def run_full_sync(settings: Optional[Settings] = None) -> dict:
    settings = settings or get_settings()
    repo = HotelCatalogueRepository(settings)
    if not repo.enabled:
        raise RuntimeError("database not configured")
    async with _lock:
        client = _client(settings)
        state = await repo.get_state("full") or {}
        resume = state.get("status") in ("running", "failed", "partial") and isinstance(state.get("cursor"), dict)
        cursor: dict = state["cursor"] if resume else {"stage": "countries"}
        run_started = now_iso()
        processed = int(state.get("processed_count") or 0) if resume else 0
        failed = 0
        await repo.put_state("full", {
            "status": "running", "started_at": state.get("started_at") if resume else run_started,
            "completed_at": None, "error_summary": None, "cursor": cursor,
            "processed_count": processed, "failed_count": 0,
        })
        try:
            if cursor["stage"] == "countries":
                countries = await content.fetch_countries(client)
                await repo.upsert_countries(countries)
                cursor = {"stage": "regions", "countries": countries, "region_cursor": None}
                await repo.put_state("full", {"cursor": cursor})

            if cursor["stage"] == "regions":
                while True:
                    rows, nxt, more = await content.fetch_regions_page(client, cursor.get("region_cursor"))
                    await repo.upsert_regions(rows)
                    # The mapping response does not repeat its region. Request
                    # each authoritative cityRegionId separately and attach that
                    # exact relationship before persisting each hotel mapping.
                    saved_mapping = cursor.get("region_mapping") or {}
                    start_index = int(saved_mapping.get("region_index") or 0)
                    for region_index, region in enumerate(rows[start_index:], start=start_index):
                        region_id = region["city_region_id"]
                        page = (
                            int(saved_mapping.get("page") or 0)
                            if saved_mapping.get("region_id") == region_id
                            else 0
                        )
                        while True:
                            mappings, mapping_more = await content.fetch_mapping_page(
                                client,
                                page=page,
                                country_name=region.get("country_name"),
                                region_ids=[region_id],
                            )
                            await repo.upsert_mappings(mappings)
                            cursor["region_mapping"] = {
                                "region_index": region_index,
                                "region_id": region_id,
                                "page": page + 1 if mapping_more and mappings else page,
                            }
                            await repo.put_state("full", {"cursor": cursor})
                            if not mapping_more or not mappings:
                                break
                            page += 1
                        saved_mapping = {}
                        cursor["region_mapping"] = {"region_index": region_index + 1, "page": 0}
                        await repo.put_state("full", {"cursor": cursor})
                    cursor.pop("region_mapping", None)
                    if not more:
                        break
                    cursor["region_cursor"] = nxt
                    await repo.put_state("full", {"cursor": cursor})
                # The authoritative region-based mapping is sufficient; there is
                # no second country-wide mapping pass.
                cursor = {"stage": "content"}
                await repo.put_state("full", {"cursor": cursor})

            if cursor["stage"] == "mapping":
                # Legacy resume state from before the duplicate country-wide
                # mapping stage was removed: skip straight to content.
                cursor = {"stage": "content"}
                await repo.put_state("full", {"cursor": cursor})

            processed, failed = await _content_phase(repo, client, run_started, "full", processed, failed)
            done = failed == 0
            await repo.put_state("full", {
                "status": "completed" if done else "partial",
                "completed_at": now_iso() if done else None,
                "last_success_at": now_iso() if done else state.get("last_success_at"),
                "cursor": None if done else {"stage": "content"},
                "error_summary": None if done else f"{failed} hotels could not be fetched; re-run to retry",
            })
            if done:
                # First incremental run starts from the moment the full sync finished.
                watermark = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                for t in ("incremental_new", "incremental_update", "incremental_delete"):
                    if not (await repo.get_state(t) or {}).get("last_update_time"):
                        await repo.put_state(t, {"status": "idle", "last_update_time": watermark})
            return {"status": "completed" if done else "partial", "processed": processed, "failed": failed}
        except Exception as exc:
            logger.error("hotel_full_sync_failed", extra=log_extra(kind=type(exc).__name__))
            await repo.put_state("full", {"status": "failed", "cursor": cursor,
                                          "error_summary": f"{type(exc).__name__} during {cursor.get('stage')}"})
            raise


async def run_incremental_sync(settings: Optional[Settings] = None) -> dict:
    settings = settings or get_settings()
    repo = HotelCatalogueRepository(settings)
    if not repo.enabled:
        raise RuntimeError("database not configured")
    summary: dict = {}
    async with _lock:
        client = _client(settings)
        for change in ("NEW", "UPDATE", "DELETE"):
            key = f"incremental_{change.lower()}"
            state = await repo.get_state(key) or {}
            since = state.get("last_update_time")
            if not since:
                summary[key] = "skipped: run a full sync first"
                continue
            run_started = now_iso()
            new_watermark = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            cursor = (state.get("cursor") or {}).get("cursor") if state.get("status") == "failed" else None
            processed = failed = 0
            await repo.put_state(key, {"status": "running", "started_at": run_started, "error_summary": None})
            try:
                while True:
                    rows, nxt, more = await content.fetch_mapping_changes(
                        client, change_type=change, last_update_time=since, cursor=cursor
                    )
                    if change == "DELETE":
                        await repo.mark_deleted([r["tj_hotel_id"] for r in rows])
                    else:
                        await repo.upsert_mappings(rows, reset_content=True)
                    processed += len(rows)
                    if not more:
                        break
                    cursor = nxt
                    await repo.put_state(key, {"cursor": {"cursor": cursor}, "processed_count": processed})
                if change != "DELETE":
                    _, failed = await _content_phase(repo, client, run_started, key, processed, 0)
                await repo.put_state(key, {
                    "status": "completed" if failed == 0 else "partial",
                    "completed_at": now_iso(), "last_success_at": now_iso(),
                    "last_update_time": new_watermark, "cursor": None,
                    "processed_count": processed, "failed_count": failed,
                })
                summary[key] = {"processed": processed, "failed": failed}
            except Exception as exc:
                logger.error("hotel_incremental_sync_failed", extra=log_extra(change=change, kind=type(exc).__name__))
                await repo.put_state(key, {"status": "failed", "cursor": {"cursor": cursor},
                                           "error_summary": type(exc).__name__})
                summary[key] = "failed"
    return summary


TEST_REGION_MAX_CONTENT = 5


async def run_test_region(region_id: int, settings: Optional[Settings] = None) -> dict:
    """Safe single-region test: mappings for one cityRegionId + content for the
    first <=5 hotels. Does not touch sync state, full sync, or incremental sync."""
    settings = settings or get_settings()
    repo = HotelCatalogueRepository(settings)
    if not repo.enabled:
        raise RuntimeError("database not configured")
    target = str(region_id).strip()
    summary = {"region_id": target, "region_saved": False, "mappings": 0, "content": 0, "failures": 0}
    async with _lock:
        client = _client(settings)
        # 1. Locate the exact cityRegionId via the existing cursor flow and persist it.
        region: Optional[dict] = None
        region_cursor: Optional[str] = None
        while region is None:
            rows, nxt, more = await content.fetch_regions_page(client, region_cursor)
            region = next((r for r in rows if r["city_region_id"] == target), None)
            if region is not None or not more or not nxt:
                break
            region_cursor = nxt
        if region is None:
            summary["error"] = "cityRegionId not returned by fetch-city-regionIds"
            return summary
        await repo.upsert_regions([region])
        summary["region_saved"] = True
        # 2. Mappings for exactly this region (region_id attached to every row).
        page = 0
        first_ids: list[str] = []
        while True:
            mappings, more = await content.fetch_mapping_page(
                client, page=page, country_name=region.get("country_name"), region_ids=[target]
            )
            for m in mappings:
                m["region_id"] = target
            await repo.upsert_mappings(mappings)
            summary["mappings"] += len(mappings)
            for m in mappings:
                if len(first_ids) < TEST_REGION_MAX_CONTENT:
                    first_ids.append(m["tj_hotel_id"])
            if not more or not mappings:
                break
            page += 1
        if first_ids:
            try:
                raw = await content.fetch_content(client, first_ids)
                items = [i for i in (content.normalise_content(r) for r in raw) if i]
                saved = set(await repo.save_content(items))
                summary["content"] = len(saved)
                summary["failures"] = len(first_ids) - len(saved)
                missing = [i for i in first_ids if i not in saved]
                if missing:
                    await repo.mark_content_failed(missing)
            except Exception as exc:
                logger.warning("hotel_test_region_content_failed",
                               extra=log_extra(kind=type(exc).__name__, size=len(first_ids)))
                await repo.mark_content_failed(first_ids)
                summary["failures"] = len(first_ids)
    return summary


async def status(settings: Settings) -> dict:
    repo = HotelCatalogueRepository(settings)
    if not repo.enabled:
        return {"configured": False}
    states = {s["sync_type"]: {k: v for k, v in s.items() if k != "cursor"} for s in await repo.all_states()}
    return {"configured": True, "running": is_running(), "states": states, "counts": await repo.counts()}


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "incremental"
    if mode == "test-region":
        if len(sys.argv) < 3:
            raise SystemExit("usage: python -m app.services.hotel_catalogue_sync test-region <cityRegionId>")
        print(asyncio.run(run_test_region(int(sys.argv[2]))))
    else:
        runner = run_full_sync if mode == "full" else run_incremental_sync
        print(asyncio.run(runner()))
