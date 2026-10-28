"""In-process progress for progressive hotel searches.

A progressive search returns its first Listing batches immediately, then keeps
asking TripJack for the rest in a background task on THIS worker. The progress
entry is therefore process-local by design: it mirrors the background task,
which cannot move between workers.

If an entry is missing (restart, another worker, expiry), the API falls back
to the durable search session and reports its stored results as complete —
never as still loading, never as lost.

Entries expire with the search session and the store is capped, so abandoned
searches cannot grow memory without bound. No prices, guest data or provider
payloads live here beyond what the search session itself already holds.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.schemas.hotels import HotelResult

MAX_PROGRESS_ENTRIES = 500

STATUS_LOADING = "loading"
STATUS_COMPLETE = "complete"
STATUS_PARTIAL = "partial"


@dataclass
class SearchProgress:
    search_id: str
    total_batches: int
    expires_at_epoch: float  # wall clock, for the API response
    sweep_at: float  # monotonic, for the store sweep
    status: str = STATUS_LOADING
    completed_batches: int = 0
    failed_batches: int = 0
    incomplete_reason: Optional[str] = None
    results: List[HotelResult] = field(default_factory=list)
    provider_search_ids: Dict[str, str] = field(default_factory=dict)
    task: Optional["asyncio.Task[None]"] = None  # strong ref: GC must never kill it
    seen: set = field(default_factory=set)

    @property
    def expires_at_iso(self) -> str:
        return datetime.fromtimestamp(self.expires_at_epoch, tz=timezone.utc).isoformat(timespec="seconds")


_entries: Dict[str, SearchProgress] = {}


def _sweep() -> None:
    now = time.monotonic()
    for key in [k for k, v in _entries.items() if v.sweep_at <= now]:
        _entries.pop(key, None)
    while len(_entries) > MAX_PROGRESS_ENTRIES:
        _entries.pop(next(iter(_entries)))


def begin(
    *,
    search_id: str,
    total_batches: int,
    results: List[HotelResult],
    provider_search_ids: Dict[str, str],
    completed_batches: int,
    failed_batches: int,
    ttl_seconds: float,
) -> SearchProgress:
    _sweep()
    entry = SearchProgress(
        search_id=search_id,
        total_batches=total_batches,
        expires_at_epoch=time.time() + ttl_seconds,
        sweep_at=time.monotonic() + ttl_seconds,
        completed_batches=completed_batches,
        failed_batches=failed_batches,
    )
    append(entry, results=results, provider_search_ids=provider_search_ids,
           completed_batches=0, failed_batches=0)
    _entries[search_id] = entry
    return entry


def append(
    entry: SearchProgress,
    *,
    results: List[HotelResult],
    provider_search_ids: Dict[str, str],
    completed_batches: int,
    failed_batches: int,
) -> List[HotelResult]:
    """Merge a finished batch. Returns only the hotels not seen before."""
    fresh: List[HotelResult] = []
    for result in results:
        if result.id in entry.seen:
            continue
        entry.seen.add(result.id)
        entry.results.append(result)
        fresh.append(result)
    entry.provider_search_ids.update(provider_search_ids)
    entry.completed_batches += completed_batches
    entry.failed_batches += failed_batches
    return fresh


def finish(entry: SearchProgress, *, incomplete_reason: Optional[str]) -> None:
    entry.incomplete_reason = incomplete_reason
    entry.status = (
        STATUS_PARTIAL if (entry.failed_batches > 0 or incomplete_reason) else STATUS_COMPLETE
    )


def get(search_id: str) -> Optional[SearchProgress]:
    _sweep()
    return _entries.get(search_id)
