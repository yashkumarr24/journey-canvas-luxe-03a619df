"""pending_content_ids() two-query split (migrations 0014/0015 index match).

No network, no real DB: the repository's Supabase client is replaced with a
stub that records the filters it receives and returns canned rows.
"""

import asyncio

from app.repositories.hotel_catalogue import HotelCatalogueRepository


class FakeDb:
    def __init__(self, normal, retryable=None):
        self.normal = normal
        self.retryable = retryable if retryable is not None else []
        self.calls: list[dict] = []

    async def select(self, table, *, columns, filters, limit, order):
        self.calls.append({"filters": dict(filters), "limit": limit, "order": order})
        if "content_error_at" in filters and filters["content_error_at"] == "is.null":
            rows = self.normal
        else:
            rows = self.retryable
        return [{"tj_hotel_id": i} for i in rows[:limit]]


def make_repo(normal, retryable=None):
    repo = HotelCatalogueRepository.__new__(HotelCatalogueRepository)
    repo._db = FakeDb(normal, retryable)
    return repo


BASE = {"content_synced_at": "is.null", "is_deleted": "is.false"}


def run(repo, limit=100, started="2026-09-27T00:00:00Z"):
    return asyncio.run(repo.pending_content_ids(started, limit))


def test_hundred_normal_pending_rows_single_query():
    repo = make_repo([f"h{i:03d}" for i in range(100)])
    assert run(repo) == [f"h{i:03d}" for i in range(100)]
    assert len(repo._db.calls) == 1
    assert repo._db.calls[0]["filters"] == {**BASE, "content_error_at": "is.null"}
    assert repo._db.calls[0]["limit"] == 100
    assert repo._db.calls[0]["order"] == "tj_hotel_id"


def test_fewer_than_limit_adds_retryable_query():
    repo = make_repo(["h001", "h002"], retryable=["h005", "h006"])
    assert run(repo) == ["h001", "h002", "h005", "h006"]
    assert len(repo._db.calls) == 2
    retry_call = repo._db.calls[1]
    assert retry_call["filters"] == {**BASE, "content_error_at": "lt.2026-09-27T00:00:00Z"}
    assert retry_call["limit"] == 98  # only the remaining slot is requested
    assert retry_call["order"] == "tj_hotel_id"


def test_duplicate_ids_between_queries_are_removed():
    repo = make_repo(["h001", "h002"], retryable=["h002", "h003"])
    assert run(repo) == ["h001", "h002", "h003"]


def test_no_pending_rows_returns_empty_without_second_query():
    repo = make_repo([], retryable=[])
    assert run(repo) == []
    assert len(repo._db.calls) == 2  # normal query returned 0, retryable query ran
    assert repo._db.calls[1]["limit"] == 100


def test_limit_is_respected():
    repo = make_repo([f"h{i:03d}" for i in range(100)], retryable=[f"r{i:03d}" for i in range(50)])
    # normal query alone fills the 100 limit; retryable branch is skipped
    assert len(run(repo)) == 100
    assert len(repo._db.calls) == 1

    repo2 = make_repo([f"h{i:03d}" for i in range(30)], retryable=[f"r{i:03d}" for i in range(50)])
    out = run(repo2, limit=40)
    assert out == [f"h{i:03d}" for i in range(30)] + [f"r{i:03d}" for i in range(10)]
    assert repo2._db.calls[1]["limit"] == 10


def test_result_sorted_by_hotel_id():
    repo = make_repo(["h050", "h010"], retryable=["h030", "h001"])
    assert run(repo) == ["h001", "h010", "h030", "h050"]
