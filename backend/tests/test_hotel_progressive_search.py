"""Progressive hotel search: initial window + background continuation.

All synthetic, no external calls. Dubai-scale = 6,684 IDs / 67 batches.
The continuation must reuse the same paced dispatch guard (no rate increase),
append without duplicates, and never report partial results as complete.
"""
import asyncio
from types import SimpleNamespace

import pytest

from app.core.auth import AuthContext
from app.core.config import Settings
from app.integrations.tripjack import hotels as tj
from app.integrations.tripjack.exceptions import TripJackRateLimitError, TripJackTimeoutError
from app.integrations.tripjack.listing_dispatch import ListingDispatch
from app.services import hotel_progress, hotel_search as svc, hotel_sessions
from tests.test_hotel_listing import body, hotel, ids, req


class Client:
    """Fake TripJack HTTP client. fail_batches raise, slow_batches sleep 1s."""

    def __init__(self, fail_batches=(), rate_limit_batch=None, duplicate_everything=False):
        self.calls = []
        self.fail_batches = set(fail_batches)
        self.rate_limit_batch = rate_limit_batch
        self.duplicate_everything = duplicate_everything

    async def post(self, path, payload, **kwargs):
        index = (int(payload['hids'][0]) - 100000000000) // 100
        self.calls.append(index)
        await asyncio.sleep(.002)
        if index in self.fail_batches:
            raise TripJackTimeoutError('synthetic_timeout')
        if index == self.rate_limit_batch:
            raise TripJackRateLimitError('synthetic_429')
        hotels = [hotel('dup')] if self.duplicate_everything else [hotel(str(h)) for h in payload['hids']]
        return body(hotels, cid=f'batch-{index}')


@pytest.fixture
def fast_dispatch(monkeypatch):
    guard = ListingDispatch(3, 10000)
    monkeypatch.setattr(tj, 'listing_dispatch', lambda *_: guard)
    return guard


@pytest.fixture
def service_stub(monkeypatch):
    """Service wired to the memory session store and a controllable client."""
    state = {'hids': [], 'client': None}

    class Repo:
        enabled = True

        def __init__(self, *_):
            pass

        async def resolve_hids(self, *a, **kw):
            return state['hids']

        async def names_for(self, page):
            return {}

        async def static_for(self, page):
            return {}

    monkeypatch.setattr(svc, 'HotelCatalogueRepository', Repo)
    monkeypatch.setattr(svc, '_provider',
                        lambda _: (state['client'], SimpleNamespace(
                            hotel_listing_concurrency=3, hotel_listing_starts_per_second=2.0)))
    monkeypatch.setattr(svc.hotel_search_limiter, 'check', lambda _: None)
    monkeypatch.setattr(svc.hotel_session_limiter, 'check', lambda _: None)
    monkeypatch.setattr(svc, 'client_identity', lambda *_: 'test')
    return state


async def _run_search(state, n):
    state['hids'] = ids(n)
    response = await svc.search_hotels(request=None, payload=req(),
                                       auth=AuthContext(user_id=None), settings=Settings())
    entry = hotel_progress.get(response.search_id) if response.loading else None
    if entry is not None:
        await entry.task
    return response, entry


def test_large_city_initial_window_then_background_completes(fast_dispatch, service_stub):
    service_stub['client'] = Client()

    async def run():
        return await _run_search(service_stub, 6684)

    response, entry = asyncio.run(run())
    assert response.loading is True and response.total_batches == 67
    assert 0 < len(response.results) <= 400  # initial window only
    assert response.partial is False
    assert entry is not None and entry.status == 'complete'
    assert entry.completed_batches == 67 and entry.failed_batches == 0
    assert len(entry.results) == 6684
    assert len({r.id for r in entry.results}) == 6684  # no duplicates
    assert len(service_stub['client'].calls) == 67
    # Late arrivals merged into the durable session for detail/review.
    session = asyncio.run(hotel_sessions.get_search_session(settings=Settings(), search_id=response.search_id))
    assert session is not None and len(session.results) == 6684
    assert session.provider_search_ids[ids(1, 3600)[0]] == 'batch-36'


def test_small_city_completes_in_initial_response(fast_dispatch, service_stub):
    service_stub['client'] = Client()

    async def run():
        return await _run_search(service_stub, 200)

    response, entry = asyncio.run(run())
    assert response.loading is False and response.total_batches == 2
    assert len(response.results) == 200
    assert entry is None  # no background task for small destinations
    assert hotel_progress.get(response.search_id) is None


def test_background_batch_failure_marks_partial_and_keeps_results(fast_dispatch, service_stub):
    service_stub['client'] = Client(fail_batches={36})

    async def run():
        return await _run_search(service_stub, 6684)

    response, entry = asyncio.run(run())
    assert response.loading is True
    assert entry.status == 'partial'  # never reported as complete
    assert entry.completed_batches == 66 and entry.failed_batches == 1
    assert entry.incomplete_reason == 'provider_failure'
    assert len(entry.results) == 6584
    assert ids(1, 3600)[0] not in entry.provider_search_ids


def test_initial_window_failure_still_delivers_via_background(fast_dispatch, service_stub):
    service_stub['client'] = Client(fail_batches={0, 1, 2, 3})

    async def run():
        return await _run_search(service_stub, 6684)

    response, entry = asyncio.run(run())
    # The request still answers instead of erroring: empty but loading.
    assert response.loading is True and response.results == []
    assert response.partial is True and response.failed_batches == 4
    assert entry.status == 'partial'
    assert entry.completed_batches == 63 and entry.failed_batches == 4
    assert len(entry.results) == 6284


def test_duplicate_hotels_across_batches_appear_once(fast_dispatch, service_stub):
    service_stub['client'] = Client(duplicate_everything=True)

    async def run():
        return await _run_search(service_stub, 6684)

    response, entry = asyncio.run(run())
    assert entry.status == 'complete'
    assert len(entry.results) == 1 and entry.results[0].id == 'dup'
    assert entry.completed_batches == 67


def test_rate_limit_stops_continuation_and_stays_explicit(fast_dispatch, service_stub):
    service_stub['client'] = Client(rate_limit_batch=10)

    async def run():
        return await _run_search(service_stub, 6684)

    response, entry = asyncio.run(run())
    assert entry.status == 'partial'
    assert entry.incomplete_reason == 'rate_limited'
    # Dispatch stopped at the 429: no burst of remaining batches was started.
    assert len(service_stub['client'].calls) <= 13
    assert entry.failed_batches == 67 - entry.completed_batches


def test_progress_poll_slices_by_offset_without_duplicates(fast_dispatch, service_stub):
    service_stub['client'] = Client()

    async def run():
        response, entry = await _run_search(service_stub, 6684)
        first = await svc.search_progress(request=None, search_id=response.search_id, offset=0,
                                          auth=AuthContext(user_id=None), settings=Settings())
        assert first.status == 'complete' and first.next_offset == 6684
        second = await svc.search_progress(request=None, search_id=response.search_id,
                                           offset=len(response.results),
                                           auth=AuthContext(user_id=None), settings=Settings())
        assert second.next_offset == 6684
        initial_ids = {r.id for r in response.results}
        assert all(r.id not in initial_ids for r in second.results)
        assert len(second.results) == 6684 - len(response.results)
        return response

    asyncio.run(run())


def test_progress_unknown_search_id_is_expired_not_loading(service_stub):
    async def run():
        with pytest.raises(svc.HotelSearchExpiredError):
            await svc.search_progress(request=None, search_id='x' * 48, offset=0,
                                      auth=AuthContext(user_id=None), settings=Settings())

    asyncio.run(run())


def test_progress_falls_back_to_session_as_complete_without_entry(fast_dispatch, service_stub):
    """Small city: no progress entry, session fallback reports complete."""
    service_stub['client'] = Client()

    async def run():
        response, _ = await _run_search(service_stub, 200)
        snapshot = await svc.search_progress(request=None, search_id=response.search_id, offset=0,
                                             auth=AuthContext(user_id=None), settings=Settings())
        assert snapshot.status == 'complete'
        assert snapshot.next_offset == 200 and len(snapshot.results) == 200
        tail = await svc.search_progress(request=None, search_id=response.search_id, offset=200,
                                         auth=AuthContext(user_id=None), settings=Settings())
        assert tail.results == [] and tail.next_offset == 200

    asyncio.run(run())


def test_progress_rejects_malformed_search_id(service_stub):
    async def run():
        with pytest.raises(svc.HotelSearchRejectedError):
            await svc.search_progress(request=None, search_id='bad id!', offset=0,
                                      auth=AuthContext(user_id=None), settings=Settings())

    asyncio.run(run())
