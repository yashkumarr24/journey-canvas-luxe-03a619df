"""pending_content_ids() via the 0016 RPC.

No network, no real DB: the Supabase client is a stub that emulates the
RPC semantics (normal first, fill from retryable, dedupe, sort, limit).
"""

import asyncio

from app.repositories.hotel_catalogue import HotelCatalogueRepository

RPC = "hotel_catalogue_pending_content_ids"
STARTED = "2026-09-27T00:00:00Z"


class FakeDb:
    def __init__(self, normal, retryable=None):
        self.normal = sorted(normal)
        self.retryable = sorted(retryable or [])
        self.calls: list[tuple[str, dict]] = []

    async def rpc(self, function, args):
        self.calls.append((function, dict(args)))
        limit = args["p_limit"]
        ids = self.normal[:limit]
        if len(ids) < limit:
            ids = ids + self.retryable[: limit - len(ids)]
        return sorted(set(ids))[:limit]

    async def select(self, *a, **k):  # must never be used any more
        raise AssertionError("REST table select must not be used")


def make_repo(normal, retryable=None):
    repo = HotelCatalogueRepository.__new__(HotelCatalogueRepository)
    repo._db = FakeDb(normal, retryable)
    return repo


def run(repo, limit=100):
    return asyncio.run(repo.pending_content_ids(STARTED, limit))


def test_hundred_normal_rows_single_rpc_call():
    repo = make_repo([f"{i:04d}" for i in range(150)])
    ids = run(repo)
    assert ids == [f"{i:04d}" for i in range(100)]
    assert repo._db.calls == [(RPC, {"p_run_started_at": STARTED, "p_limit": 100})]


def test_fewer_normal_rows_filled_with_retryable():
    repo = make_repo(["b", "d"], ["a", "c"])
    assert run(repo) == ["a", "b", "c", "d"]


def test_duplicates_removed():
    repo = make_repo(["a", "b"], ["b", "c"])
    assert run(repo) == ["a", "b", "c"]


def test_rpc_duplicate_output_still_deduped():
    repo = make_repo([])
    async def dup_rpc(function, args):
        return ["b", "a", "b"]
    repo._db.rpc = dup_rpc
    assert run(repo) == ["a", "b"]


def test_no_pending_rows():
    assert run(make_repo([], [])) == []


def test_limit_respected():
    repo = make_repo(["a", "b", "c"], ["d", "e"])
    assert run(repo, limit=4) == ["a", "b", "c", "d"]
    assert repo._db.calls[0][1]["p_limit"] == 4


def test_zero_limit_makes_no_call():
    repo = make_repo(["a"])
    assert run(repo, limit=0) == []
    assert repo._db.calls == []
