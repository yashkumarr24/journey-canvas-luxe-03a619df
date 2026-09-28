"""Full-sync content persistence is split into small atomic RPC chunks."""

import asyncio

import httpx
import pytest

from app.services import hotel_catalogue_sync as sync

IDS = [f"h{i:03d}" for i in range(100)]


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    async def no_sleep(_):
        return None
    monkeypatch.setattr(sync.asyncio, "sleep", no_sleep)
    fetches: list[list[str]] = []

    async def fetch(_client, ids):
        fetches.append(list(ids))
        return [{"id": i} for i in ids]
    monkeypatch.setattr(sync.content, "fetch_content", fetch)
    monkeypatch.setattr(sync.content, "normalise_content", lambda r: r)
    return fetches


class Repo:
    def __init__(self, fail_chunk=None, fail_times=0):
        self.batches = [list(IDS)]
        self.fail_chunk, self.fail_times = fail_chunk, fail_times
        self.calls: list[list[str]] = []
        self.committed: list[str] = []
        self.states: list[dict] = []
        self._fails = 0

    async def pending_content_ids(self, _s, n):
        assert n == 100  # TripJack fetch batch unchanged
        return self.batches.pop(0) if self.batches else []

    async def save_content_batch(self, items):
        ids = [i["id"] for i in items]
        self.calls.append(ids)
        if self.fail_chunk is not None and ids[0] == IDS[self.fail_chunk * sync.CONTENT_DB_CHUNK]:
            if self._fails < self.fail_times:
                self._fails += 1
                raise httpx.ReadTimeout("t")
        self.committed += ids
        return ids

    async def mark_content_failed(self, ids):
        return None

    async def put_state(self, _t, f):
        self.states.append(f)


def run(repo):
    return asyncio.run(sync._content_phase_full(repo, None, "now", 0, 0))[:2]


def test_100_hotels_split_into_20_25_chunks(_fast):
    repo = Repo()
    assert run(repo) == (100, 0)
    assert 20 <= sync.CONTENT_DB_CHUNK <= 25
    assert all(len(c) <= 25 for c in repo.calls) and len(repo.calls) == 5
    assert len(_fast) == 1  # one TripJack fetch


def test_each_chunk_independent_call():
    repo = Repo()
    run(repo)
    assert [i for c in repo.calls for i in c] == IDS


def test_failed_chunk_retried_alone(_fast):
    repo = Repo(fail_chunk=2, fail_times=3)
    assert run(repo) == (100, 0)
    firsts = [c[0] for c in repo.calls]
    assert firsts.count(IDS[40]) == 4
    assert firsts.count(IDS[0]) == 1 and firsts.count(IDS[20]) == 1
    assert len(_fast) == 1  # no TripJack re-fetch


def test_earlier_chunks_stay_saved_when_later_fails():
    repo = Repo(fail_chunk=3, fail_times=99)
    with pytest.raises(sync.StatePersistenceError):
        run(repo)
    assert repo.committed == IDS[:60]
    assert repo.states[-1]["processed_count"] == 60


def test_pending_lookup_unchanged():
    repo = Repo()
    run(repo)
    assert repo.batches == []
