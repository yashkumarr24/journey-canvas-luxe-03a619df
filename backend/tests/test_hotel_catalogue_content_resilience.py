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

    async def save_content(self, items):
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
