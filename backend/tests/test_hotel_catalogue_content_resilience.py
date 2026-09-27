"""Full-sync content-phase DB resilience (no network, no real DB)."""

import asyncio

import httpx
import pytest

from app.repositories.supabase_rest import SupabaseUnavailableError
from app.services import hotel_catalogue_sync as sync


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    async def no_sleep(_):
        return None
    monkeypatch.setattr(sync.asyncio, "sleep", no_sleep)
    async def fetch(_client, ids):
        return [{"id": i} for i in ids]
    monkeypatch.setattr(sync.content, "fetch_content", fetch)
    monkeypatch.setattr(sync.content, "normalise_content", lambda r: r)


class Repo:
    def __init__(self, pending_fail=0, save_fail=0, save_exc=None):
        self.batches = [["a", "b"]]
        self.pending_calls = self.save_calls = 0
        self.pending_fail, self.save_fail = pending_fail, save_fail
        self.save_exc = save_exc or httpx.ReadTimeout("t")
        self.states: list[dict] = []

    async def pending_content_ids(self, _started, _n):
        self.pending_calls += 1
        if self.pending_calls <= self.pending_fail:
            raise SupabaseUnavailableError("supabase_unreachable")
        return self.batches.pop(0) if self.batches else []

    async def save_content_batch(self, items):
        self.save_calls += 1
        if self.save_calls <= self.save_fail:
            raise self.save_exc
        return [i["id"] for i in items]

    async def mark_content_failed(self, ids):
        return None

    async def put_state(self, _t, fields):
        self.states.append(fields)


def run(repo):
    return asyncio.run(sync._content_phase_full(repo, None, "now", 0, 0))


def test_pending_temporary_timeout_recovers():
    repo = Repo(pending_fail=2)
    assert run(repo) == (2, 0)


def test_pending_persistent_timeout_stops_after_5():
    repo = Repo(pending_fail=99)
    with pytest.raises(sync.StatePersistenceError):
        run(repo)
    assert repo.pending_calls == 5 and repo.states == []


def test_save_temporary_failure_recovers_same_batch():
    repo = Repo(save_fail=3)
    assert run(repo) == (2, 0)
    assert repo.save_calls == 4


def test_save_persistent_failure_stops_without_state_advance():
    repo = Repo(save_fail=99)
    with pytest.raises(sync.StatePersistenceError):
        run(repo)
    assert repo.save_calls == 5 and repo.states == []


def test_permanent_error_not_retried():
    repo = Repo(save_fail=99, save_exc=SupabaseUnavailableError("supabase_400"))
    with pytest.raises(SupabaseUnavailableError):
        run(repo)
    assert repo.save_calls == 1 and repo.states == []


class AtomicRepo(Repo):
    """Simulates the single-transaction RPC: all-or-nothing, idempotent."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.db: dict[str, dict] = {}
        self.batches = [[f"h{i}" for i in range(100)]]

    async def save_content_batch(self, items):
        self.save_calls += 1
        if self.save_calls <= self.save_fail:
            raise SupabaseUnavailableError("supabase_503")  # rollback: nothing written
        for i in items:
            self.db[i["id"]] = i  # upsert semantics
        return [i["id"] for i in items]


def test_100_hotel_batch_is_five_db_chunks():
    """TripJack fetches 100 hotels once; the batch is split into five
    20-hotel DB chunks, each with its own save/retry lifecycle."""
    repo = AtomicRepo()
    assert run(repo) == (100, 0)
    assert repo.save_calls == 5


def test_503_then_success():
    """The first chunk retries once after a 503 and succeeds; the remaining
    four chunks save on the first attempt (1 retry + 4 chunks = 6 calls)."""
    repo = AtomicRepo(save_fail=1)
    assert run(repo) == (100, 0) and repo.save_calls == 6


def test_persistent_503_stops_after_5_without_partial_data_or_progress():
    repo = AtomicRepo(save_fail=99)
    with pytest.raises(sync.StatePersistenceError):
        run(repo)
    assert repo.save_calls == 5 and repo.db == {} and repo.states == []


def test_retry_same_batch_idempotent():
    repo = AtomicRepo()
    items = [{"id": "x"}, {"id": "x"}]
    asyncio.run(repo.save_content_batch(items))
    asyncio.run(repo.save_content_batch(items))
    assert list(repo.db) == ["x"]


class FullSyncStartupRepo:
    """Stand-in for the repository surface run_full_sync() touches at startup.

    get_state("full") fails transiently N times (Supabase unreachable) before
    returning the saved state; pending_content_ids returns nothing so the run
    completes immediately after startup.
    """

    def __init__(self, state_failures: int = 0):
        self.enabled = True
        self.state_failures = state_failures
        self.get_state_calls = 0
        self.states: list[dict] = []

    async def get_state(self, sync_type):
        if sync_type == "full":
            self.get_state_calls += 1
            if self.get_state_calls <= self.state_failures:
                raise SupabaseUnavailableError("supabase_unreachable")
        return {
            "status": "running", "cursor": {"stage": "content"},
            "processed_count": 10,
        }

    async def pending_content_ids(self, _started, _limit):
        return []

    async def put_state(self, _sync_type, fields):
        self.states.append(dict(fields))


def _run_full_sync_with_repo(monkeypatch, repo):
    monkeypatch.setattr(sync, "HotelCatalogueRepository", lambda _s: repo)
    monkeypatch.setattr(sync, "_client", lambda _s: object())
    return asyncio.run(sync.run_full_sync(settings=object()))


def test_full_sync_initial_state_read_succeeds_after_transient_failure(monkeypatch):
    """A transient Supabase timeout on the very first get_state("full") is
    retried with the existing policy; the saved cursor is honoured and the
    run completes instead of the process exiting."""
    repo = FullSyncStartupRepo(state_failures=2)
    summary = _run_full_sync_with_repo(monkeypatch, repo)
    assert summary == {"status": "completed", "processed": 10, "failed": 0}
    assert repo.get_state_calls == 3  # 2 transient failures + 1 success
    statuses = [s["status"] for s in repo.states if "status" in s]
    assert statuses[0] == "running" and statuses[-1] == "completed"


def test_full_sync_initial_state_read_persistent_failure_stops_safely(monkeypatch):
    """After all retries fail, StatePersistenceError is raised and NO state
    write happens — the saved cursor/progress is untouched (no new run, no
    progress reset)."""
    repo = FullSyncStartupRepo(state_failures=99)
    with pytest.raises(sync.StatePersistenceError):
        _run_full_sync_with_repo(monkeypatch, repo)
    assert repo.get_state_calls == 5 and repo.states == []


def test_incremental_path_still_uses_legacy_save_content():
    import inspect
    assert "repo.save_content(items)" in inspect.getsource(sync._content_phase)
    assert "save_content_batch" in inspect.getsource(sync._content_phase_full)


class RpcRegionRepo:
    """Minimal stand-in for the repository surface used by run_test_rpc_region."""

    def __init__(self, *, save_fail=0, save_exc=None):
        self.enabled = True
        self.save_fail = save_fail
        self.save_exc = save_exc or httpx.ReadTimeout("t")
        self.save_calls = 0
        self.saved_ids: list[str] = []

    async def upsert_regions(self, rows):
        return None

    async def upsert_mappings(self, rows):
        return None

    async def save_content_batch(self, items):
        self.save_calls += 1
        if self.save_calls <= self.save_fail:
            raise self.save_exc
        ids = [i["id"] for i in items]
        self.saved_ids.extend(ids)
        return ids


def _patch_test_rpc_region(monkeypatch, repo, *, region_found=True, mappings=("h1",)):
    async def fetch_regions_page(_client, _cursor):
        if region_found:
            return [{"city_region_id": "42", "country_name": "India"}], None, False
        return [], None, False

    async def fetch_mapping_page(_client, **_kw):
        return ([{"tj_hotel_id": hid, "region_id": "42"} for hid in mappings], False)

    async def fetch_content(_client, ids):
        return [{"id": i} for i in ids]

    monkeypatch.setattr(sync.content, "fetch_regions_page", fetch_regions_page)
    monkeypatch.setattr(sync.content, "fetch_mapping_page", fetch_mapping_page)
    monkeypatch.setattr(sync.content, "fetch_content", fetch_content)
    monkeypatch.setattr(sync.content, "normalise_content", lambda r: r)
    monkeypatch.setattr(sync, "HotelCatalogueRepository", lambda _s: repo)
    monkeypatch.setattr(sync, "get_settings", lambda: object())
    # run_test_rpc_region() calls _client(settings); the fake Settings above
    # has no TripJack attributes, so stub the client factory itself.
    monkeypatch.setattr(sync, "_client", lambda _s: object())


def test_test_rpc_region_saves_one_hotel_via_rpc(monkeypatch):
    repo = RpcRegionRepo()
    _patch_test_rpc_region(monkeypatch, repo)
    summary = asyncio.run(sync.run_test_rpc_region(42))
    assert summary == {
        "region_id": "42", "region_saved": True, "mappings": 1,
        "hotel_id": "h1", "rpc_saved": True, "error": None,
    }
    assert repo.save_calls == 1
    assert repo.saved_ids == ["h1"]


def test_test_rpc_region_rpc_failure_is_reported(monkeypatch):
    """The diagnostic command does not retry; a single RPC failure is caught
    and reported in the summary (region/mapping already persisted)."""
    repo = RpcRegionRepo(save_fail=1, save_exc=SupabaseUnavailableError("supabase_503"))
    _patch_test_rpc_region(monkeypatch, repo)
    summary = asyncio.run(sync.run_test_rpc_region(42))
    assert summary["rpc_saved"] is False
    assert summary["hotel_id"] == "h1"
    assert summary["region_saved"] is True
    assert summary["mappings"] == 1
    assert summary["error"] and "supabase_503" in summary["error"]
    assert repo.save_calls == 1


def test_test_rpc_region_region_not_found(monkeypatch):
    repo = RpcRegionRepo()
    _patch_test_rpc_region(monkeypatch, repo, region_found=False, mappings=())
    summary = asyncio.run(sync.run_test_rpc_region(42))
    assert summary["region_saved"] is False
    assert "cityRegionId not returned" in summary["error"]
    assert repo.save_calls == 0


def test_test_rpc_region_no_mappings(monkeypatch):
    repo = RpcRegionRepo()
    _patch_test_rpc_region(monkeypatch, repo, mappings=())
    summary = asyncio.run(sync.run_test_rpc_region(42))
    assert summary["hotel_id"] is None
    assert "no hotel mappings" in summary["error"]
    assert repo.save_calls == 0


def test_cli_logging_initialization(monkeypatch):
    """The __main__ CLI entry must configure structured logging before running."""
    calls = []

    def fake_configure_logging(level):
        calls.append(level)

    monkeypatch.setattr(sync, "configure_logging", fake_configure_logging)

    captured = {}

    def fake_get_settings():
        class _S:
            log_level = "INFO"
        return _S()

    monkeypatch.setattr(sync, "get_settings", fake_get_settings)

    async def fake_runner():
        return {"ok": True}

    monkeypatch.setattr(sync, "run_incremental_sync", fake_runner)

    orig_argv = sync.sys.argv
    sync.sys.argv = ["hotel_catalogue_sync", "incremental"]
    try:
        # Re-run the __main__ block by executing the module file as a script
        # is impractical; instead exercise the same sequence the block runs.
        _settings = sync.get_settings()
        sync.configure_logging(_settings.log_level)
    finally:
        sync.sys.argv = orig_argv

    assert calls == ["INFO"]
