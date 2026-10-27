"""Large-city regressions using synthetic provider fixtures, no external calls."""
import asyncio
import time
from types import SimpleNamespace

import httpx
import pytest

from app.core.auth import AuthContext
from app.core.config import Settings
from app.integrations.tripjack import hotels as tj
from app.integrations.tripjack.client import TripJackClient
from app.integrations.tripjack.exceptions import TripJackRateLimitError, TripJackTimeoutError
from app.integrations.tripjack.listing_dispatch import ListingDispatch
from app.services import hotel_search as svc, hotel_sessions
from tests.test_hotel_listing import body, hotel, ids, req


class Client:
    def __init__(self, fail_batch=None, slow_batch=None):
        self.calls = []
        self.active = self.peak = self.cancelled = 0
        self.fail_batch, self.slow_batch = fail_batch, slow_batch

    async def post(self, path, payload, **kwargs):
        index = (int(payload['hids'][0]) - 100000000000) // 100
        self.calls.append((index, payload, kwargs))
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            await asyncio.sleep(1 if index == self.slow_batch else .002 * (3 - index % 3))
            if index == self.fail_batch:
                raise TripJackTimeoutError('synthetic_timeout')
            return body([hotel(str(h)) for h in payload['hids']], cid=f'batch-{index}')
        except asyncio.CancelledError:
            self.cancelled += 1
            raise
        finally:
            self.active -= 1


@pytest.fixture
def fast_dispatch(monkeypatch):
    guard = ListingDispatch(3, 10000)
    monkeypatch.setattr(tj, 'listing_dispatch', lambda *_: guard)
    return guard


def test_dubai_6684_ids_67_batches_bounded_out_of_order_context(fast_dispatch):
    client = Client()
    results, sid, _ = asyncio.run(tj.search_hotels(client, SimpleNamespace(), req(), hids=ids(6684)))
    assert len(client.calls) == 67
    assert sorted(len(p['hids']) for _, p, _ in client.calls) == [84] + [100] * 66
    assert len(results) == 6684 and results.completed_batches == 67 and results.failed_batches == 0
    assert client.peak == 3 and client.active == 0
    assert [r.id for r in results] == ids(6684)
    assert sid == 'batch-0'
    assert results.provider_search_ids[ids(1, 3600)[0]] == 'batch-36'
    assert len({p['correlationId'] for _, p, _ in client.calls}) == 67
    assert all(k['retries'] == 0 and p['timeoutMs'] <= 13000 for _, p, k in client.calls)


def test_batch_37_failure_keeps_all_other_results(fast_dispatch):
    client = Client(fail_batch=36)
    results, _, _ = asyncio.run(tj.search_hotels(client, SimpleNamespace(), req(), hids=ids(6684)))
    assert len(client.calls) == 67 and len(results) == 6584
    assert results.completed_batches == 66 and results.failed_batches == 1
    assert results.incomplete_reason == 'provider_failure'
    assert ids(1, 3600)[0] not in results.provider_search_ids
    assert results.provider_search_ids[ids(1, 6600)[0]] == 'batch-66'


def test_deadline_retains_successes_and_cancels_pending_workers(fast_dispatch):
    client = Client(slow_batch=0)
    started = time.monotonic()
    results, _, _ = asyncio.run(tj.search_hotels(client, SimpleNamespace(), req(), hids=ids(6684), budget_seconds=.04))
    assert time.monotonic() - started < .5
    assert 0 < len(results) < 6684
    assert results.completed_batches + results.failed_batches == 67
    assert results.failed_batches > 0 and results.incomplete_reason == 'timeout'
    assert client.active == 0 and client.cancelled > 0


def test_no_usable_results_deadline_is_provider_timeout(fast_dispatch):
    with pytest.raises(TripJackTimeoutError):
        asyncio.run(tj.search_hotels(Client(slow_batch=0), SimpleNamespace(), req(), hids=ids(100), budget_seconds=.01))
    assert isinstance(svc._map_provider_error(TripJackTimeoutError()), svc.HotelProviderTimeoutError)
    assert svc.HotelProviderTimeoutError.status_code == 504


def test_rate_limit_stops_dispatch_and_applies_shared_cooldown(fast_dispatch):
    class RateClient(Client):
        async def post(self, path, payload, **kw):
            self.calls.append(payload)
            exc = TripJackRateLimitError()
            exc.retry_after_seconds = 5
            raise exc
    client = RateClient()
    started = time.monotonic()
    with pytest.raises(TripJackRateLimitError):
        asyncio.run(tj.search_hotels(client, SimpleNamespace(), req(), hids=ids(6684)))
    assert len(client.calls) == 1
    assert fast_dispatch.cooldown_until >= started + 5


def test_pacing_shared_across_simultaneous_searches(monkeypatch):
    guard = ListingDispatch(2, 100)
    monkeypatch.setattr(tj, 'listing_dispatch', lambda *_: guard)
    class TimestampClient(Client):
        def __init__(self):
            super().__init__()
            self.starts = []
        async def post(self, *a, **kw):
            self.starts.append(time.monotonic())
            return await super().post(*a, **kw)
    async def run():
        client = TimestampClient()
        await asyncio.gather(*(tj.search_hotels(client, SimpleNamespace(), req(), hids=ids(250)) for _ in range(2)))
        assert client.peak <= 2 and len(client.starts) == 6
        assert all(b - a >= .009 for a, b in zip(client.starts, client.starts[1:]))
    asyncio.run(run())


@pytest.mark.parametrize('header,expected', [('7', 7), ('bad', 60), ('NaN', 60)])
def test_listing_retry_after_is_parsed_without_changing_booking_behavior(header, expected):
    client = TripJackClient(SimpleNamespace())
    response = httpx.Response(429, headers={'Retry-After': header}, json={'status': {'success': False}})
    with pytest.raises(TripJackRateLimitError) as caught:
        client._interpret(response, 'hotel_listing')
    assert caught.value.retry_after_seconds == expected
    with pytest.raises(TripJackRateLimitError) as other:
        client._interpret(response, 'hotel_book')
    assert not hasattr(other.value, 'retry_after_seconds')


def test_full_service_partial_response_and_lightweight_catalogue_reads(monkeypatch):
    static_calls = []
    class Repo:
        enabled = True
        def __init__(self, *_): pass
        async def resolve_hids(self, *a, **kw): return ids(6684)
        async def names_for(self, page):
            assert len(page) <= 500
            return {hid: 'Fixture hotel' for hid in page}
        async def static_for(self, page):
            static_calls.extend(page)
            return {}
    monkeypatch.setattr(svc, 'HotelCatalogueRepository', Repo)
    monkeypatch.setattr(svc, '_provider', lambda _: (None, None))
    monkeypatch.setattr(svc.hotel_search_limiter, 'check', lambda _: None)
    monkeypatch.setattr(svc, 'client_identity', lambda *_: 'test')
    async def listing(*a, **kw):
        assert 0 < kw['budget_seconds'] <= 30
        rows = tj.HotelListingResults()
        rows.extend(tj.normalize_listing_response(body([hotel('one')]), currency='INR').results)
        rows.completed_batches, rows.failed_batches = 36, 31
        rows.provider_search_ids = {'one': 'batch-one'}
        return rows, 'batch-one', 'INR'
    monkeypatch.setattr(tj, 'search_hotels', listing)
    async def run():
        response = await svc.search_hotels(request=None, payload=req(), auth=AuthContext(user_id=None), settings=Settings())
        assert response.partial and response.completed_batches == 36 and response.failed_batches == 31
        assert static_calls == ['one']  # never enrich every mapped city hotel
        session = await hotel_sessions.get_search_session(settings=Settings(), search_id=response.search_id)
        assert session.provider_search_ids == {'one': 'batch-one'}
    asyncio.run(run())


def test_total_request_budget_includes_catalogue_lookup(monkeypatch):
    class Repo:
        enabled = True
        def __init__(self, *_): pass
        async def resolve_hids(self, *a, **kw): await asyncio.sleep(1)
    monkeypatch.setattr(svc, 'HotelCatalogueRepository', Repo)
    monkeypatch.setattr(svc, '_provider', lambda _: (None, None))
    monkeypatch.setattr(svc.hotel_search_limiter, 'check', lambda _: None)
    monkeypatch.setattr(svc, 'client_identity', lambda *_: 'test')
    settings = Settings().model_copy(update={'hotel_search_budget_seconds': .02})
    with pytest.raises(svc.HotelProviderTimeoutError):
        asyncio.run(svc.search_hotels(request=None, payload=req(), auth=AuthContext(user_id=None), settings=settings))


def test_slow_session_persistence_keeps_usable_search_in_existing_memory_fallback(monkeypatch):
    cancelled = []
    class Repo:
        async def create_search(self, *_):
            try: await asyncio.sleep(1)
            finally: cancelled.append(True)
    monkeypatch.setattr(hotel_sessions, '_repo', lambda _: Repo())
    async def run():
        session = await hotel_sessions.create_search_session(settings=Settings(), destination='Dubai',
            check_in='2026-12-01', check_out='2026-12-03', nights=2, rooms=req().rooms,
            nationality='AE', results=[], provider_search_id='batch', provider_search_ids={'one': 'batch'},
            currency='INR', user_id=None, persist_timeout_seconds=.01)
        assert hotel_sessions._memory.searches[session.id].provider_search_ids == {'one': 'batch'}
        assert cancelled == [True]
    asyncio.run(run())