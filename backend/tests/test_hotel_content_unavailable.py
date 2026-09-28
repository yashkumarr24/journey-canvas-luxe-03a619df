"""CONTENT_UNAVAILABLE classification in the full-sync content phase (no network/DB)."""

import asyncio
import inspect
from pathlib import Path

import httpx
import pytest

from app.repositories.hotel_catalogue import HotelCatalogueRepository
from app.services import hotel_catalogue_sync as sync

IDS = [f"h{i:03d}" for i in range(100)]


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    async def no_sleep(_):
        return None
    monkeypatch.setattr(sync.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(sync.content, "normalise_content", lambda r: {"id": r["tjHotelId"]})


def use_fetch(monkeypatch, fn):
    monkeypatch.setattr(sync.content, "fetch_content", fn)


class Repo:
    def __init__(self, batches):
        self.batches = [list(b) for b in batches]
        self.saved, self.failed, self.unavailable, self.states = [], [], [], []

    async def pending_content_ids(self, _s, _n):
        return self.batches.pop(0) if self.batches else []

    async def save_content_batch(self, items):
        ids = [i["id"] for i in items]
        self.saved += ids
        return ids

    async def mark_content_failed(self, ids):
        self.failed += ids

    async def mark_content_unavailable(self, ids):
        self.unavailable += ids

    async def put_state(self, _t, f):
        self.states.append(f)


def run(repo):
    return asyncio.run(sync._content_phase_full(repo, None, "now", 0, 0))


def test_network_failure_stays_failed(monkeypatch):
    async def boom(_c, ids):
        raise httpx.ConnectError("x")
    use_fetch(monkeypatch, boom)
    repo = Repo([IDS])
    assert run(repo) == (0, 100, 0)
    assert repo.failed == IDS and repo.unavailable == [] and repo.saved == []


def test_empty_hotels_is_unavailable(monkeypatch):
    async def empty(_c, ids):
        return []
    use_fetch(monkeypatch, empty)
    repo = Repo([IDS])
    assert run(repo) == (0, 0, 100)
    assert repo.unavailable == IDS and repo.failed == [] and repo.saved == []
    assert repo.states[-1]["unavailable_count"] == 100


def test_partial_saves_returned_and_marks_missing_unavailable(monkeypatch):
    async def partial(_c, ids):
        return [{"tjHotelId": i} for i in ids[:97]]
    use_fetch(monkeypatch, partial)
    repo = Repo([IDS])
    assert run(repo) == (97, 0, 3)
    assert repo.saved == IDS[:97] and repo.unavailable == IDS[97:] and repo.failed == []


def test_returned_but_unnormalisable_is_failed_not_unavailable(monkeypatch):
    async def fetch(_c, ids):
        return [{"tjHotelId": i} for i in ids]
    use_fetch(monkeypatch, fetch)
    monkeypatch.setattr(sync.content, "normalise_content",
                        lambda r: None if r["tjHotelId"] == "h000" else {"id": r["tjHotelId"]})
    repo = Repo([IDS])
    assert run(repo) == (99, 1, 0)
    assert repo.failed == ["h000"] and repo.unavailable == []


def test_full_sync_completes_with_only_unavailable(monkeypatch):
    async def empty(_c, ids):
        return []
    use_fetch(monkeypatch, empty)

    class FullRepo(Repo):
        enabled = True
        async def get_state(self, t):
            return {"status": "partial", "cursor": {"stage": "content"}} if t == "full" else {"last_update_time": "x"}

    repo = FullRepo([IDS[:50]])
    monkeypatch.setattr(sync, "HotelCatalogueRepository", lambda _s: repo)
    monkeypatch.setattr(sync, "_client", lambda _s: None)
    out = asyncio.run(sync.run_full_sync(object()))
    assert out == {"status": "completed", "processed": 0, "failed": 0, "unavailable": 50}
    final = repo.states[-1]
    assert final["status"] == "completed" and final["cursor"] is None and final["last_success_at"]


class Db:
    def __init__(self):
        self.updates, self.upserts = [], []

    async def update(self, table, values, filters):
        self.updates.append((table, values))

    async def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows))


def repo_with_db():
    r = HotelCatalogueRepository.__new__(HotelCatalogueRepository)
    r._db = Db()
    return r


def test_mark_unavailable_sets_stamp_and_clears_error():
    r = repo_with_db()
    asyncio.run(r.mark_content_unavailable(["a"]))
    table, values = r._db.updates[0]
    assert table == "hotel_mappings"
    assert values["content_unavailable_at"] and values["content_error_at"] is None
    assert "content_synced_at" not in values


def test_mapping_refresh_clears_unavailable():
    r = repo_with_db()
    asyncio.run(r.upsert_mappings([{"tj_hotel_id": "a"}], reset_content=True))
    row = r._db.upserts[0][1][0]
    assert row["content_unavailable_at"] is None and row["content_error_at"] is None
    assert row["content_synced_at"] is None


def test_save_content_clears_unavailable():
    src = inspect.getsource(HotelCatalogueRepository.save_content)
    assert '"content_unavailable_at": None' in src
    mig = (Path(__file__).parents[1] / "db/migrations/0017_hotel_content_availability.sql").read_text()
    assert "content_unavailable_at = null" in mig


def test_pending_rpc_excludes_unavailable():
    mig = (Path(__file__).parents[1] / "db/migrations/0017_hotel_content_availability.sql").read_text()
    body = mig.split("hotel_catalogue_pending_content_ids(", 1)[1].split("$$;", 1)[0]
    assert body.count("content_unavailable_at is null") == 2
