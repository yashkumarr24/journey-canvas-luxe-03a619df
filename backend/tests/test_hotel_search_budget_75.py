"""75s full-request budget regressions: 6,684 IDs / 67 batches must fit.

Chain under test (all synthetic, no external calls):
  browser 90s > Vercel proxy 95s > backend budget 75s (max 85)
    > Listing cap 55s > 67 paced starts (~33.5s) + 13s worst batch.
"""
import asyncio
import time
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.core.auth import AuthContext
from app.core.config import Settings
from app.integrations.tripjack import hotels as tj
from app.integrations.tripjack.listing_dispatch import ListingDispatch
from app.services import hotel_search as svc
from tests.test_hotel_listing import body, hotel, ids, req
from tests.test_hotel_listing_budget import Client


@pytest.fixture
def fast_dispatch(monkeypatch):
    guard = ListingDispatch(3, 10000)
    monkeypatch.setattr(tj, 'listing_dispatch', lambda *_: guard)
    return guard


def test_budget_default_is_75_and_hard_max_is_85(monkeypatch):
    assert Settings().hotel_search_budget_seconds == 75
    monkeypatch.setenv('HOTEL_SEARCH_BUDGET_SECONDS', '85')
    assert Settings().hotel_search_budget_seconds == 85
    monkeypatch.setenv('HOTEL_SEARCH_BUDGET_SECONDS', '86')
    with pytest.raises(ValidationError):
        Settings()


def test_budget_chain_fits_hosting_limits():
    """67 batches at conservative pacing finish inside every outer limit."""
    total = Settings().hotel_search_budget_seconds
    batches, starts_per_second, worst_batch = 67, 2.0, 13.0
    listing_worst = (batches - 1) / starts_per_second + worst_batch  # 46s
    listing_cap = 55.0
    pre_post = 8.0 + 3.0 + 2.0 + 2.0  # catalogue + names + enrich + persist
    assert listing_worst < listing_cap
    assert pre_post + listing_cap <= total
    assert total <= 85 < 90 < 95  # backend max < browser < Vercel proxy


def test_service_passes_initial_window_budget_with_default_budget(monkeypatch):
    class Repo:
        enabled = True
        def __init__(self, *_): pass
        async def resolve_hids(self, *a, **kw): return ids(200)
        async def names_for(self, page): return {}
        async def static_for(self, page): return {}
    monkeypatch.setattr(svc, 'HotelCatalogueRepository', Repo)
    monkeypatch.setattr(svc, '_provider', lambda _: (None, None))
    monkeypatch.setattr(svc.hotel_search_limiter, 'check', lambda _: None)
    monkeypatch.setattr(svc, 'client_identity', lambda *_: 'test')
    captured = {}
    async def listing(*a, **kw):
        captured['budget'] = kw['budget_seconds']
        rows = tj.HotelListingResults()
        rows.extend(tj.normalize_listing_response(body([hotel('one')]), currency='INR').results)
        rows.completed_batches, rows.failed_batches = 2, 0
        return rows, 'batch-one', 'INR'
    monkeypatch.setattr(tj, 'search_hotels', listing)
    async def run():
        response = await svc.search_hotels(request=None, payload=req(), auth=AuthContext(user_id=None), settings=Settings())
        assert not response.partial and response.completed_batches == 2
    asyncio.run(run())
    # Progressive search: the request's only call is the initial window
    # (200 IDs = 2 batches <= initial window); the 55s cap now bounds the
    # background continuation, covered in test_hotel_progressive_search.py.
    assert 0 < captured['budget'] <= Settings().hotel_search_initial_seconds


def test_dubai_6684_ids_67_batches_complete_within_55s_listing_budget(fast_dispatch):
    client = Client()
    started = time.monotonic()
    results, sid, _ = asyncio.run(tj.search_hotels(client, SimpleNamespace(), req(), hids=ids(6684), budget_seconds=55.0))
    assert time.monotonic() - started < 55.0
    assert len(client.calls) == 67
    assert results.completed_batches == 67 and results.failed_batches == 0
    assert results.incomplete_reason is None and len(results) == 6684
    assert sid == 'batch-0'


def test_tight_listing_budget_still_returns_partial_timeout_not_silent_success(fast_dispatch):
    client = Client(slow_batch=0)
    results, _, _ = asyncio.run(tj.search_hotels(client, SimpleNamespace(), req(), hids=ids(6684), budget_seconds=.04))
    assert 0 < len(results) < 6684
    assert results.completed_batches + results.failed_batches == 67
    assert results.incomplete_reason == 'timeout'


def test_full_request_budget_exhaustion_is_retryable_504(monkeypatch):
    class Repo:
        enabled = True
        def __init__(self, *_): pass
        async def resolve_hids(self, *a, **kw): await asyncio.sleep(1)
    monkeypatch.setattr(svc, 'HotelCatalogueRepository', Repo)
    monkeypatch.setattr(svc, '_provider', lambda _: (None, None))
    monkeypatch.setattr(svc.hotel_search_limiter, 'check', lambda _: None)
    monkeypatch.setattr(svc, 'client_identity', lambda *_: 'test')
    settings = Settings().model_copy(update={'hotel_search_budget_seconds': .02})
    with pytest.raises(svc.HotelProviderTimeoutError) as caught:
        asyncio.run(svc.search_hotels(request=None, payload=req(), auth=AuthContext(user_id=None), settings=settings))
    assert caught.value.status_code == 504
