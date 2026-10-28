"""Progressive hotel search recovery: interruption must never read as complete.

Simulates a worker restart after the initial batches: the in-process progress
entry is gone and the background task is dead, but the durable search session
survives. The progress endpoint must then report partial/interrupted (so the
UI keeps the incomplete-search warning and retry), never "complete".

All synthetic, no external calls. Dubai-scale = 6,684 IDs / 67 batches.
"""
import asyncio
from types import SimpleNamespace

from app.core.auth import AuthContext
from app.core.config import Settings
from app.integrations.tripjack import hotels as tj
from app.integrations.tripjack.listing_dispatch import ListingDispatch
from app.services import hotel_progress, hotel_search as svc, hotel_sessions
from tests.test_hotel_listing import body, hotel, ids, req
from tests.test_hotel_progressive_search import Client


import pytest  # noqa: E402  (kept with fixtures below)


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


def _poll(search_id, offset=0):
    return svc.search_progress(request=None, search_id=search_id, offset=offset,
                               auth=AuthContext(user_id=None), settings=Settings())


def test_restart_after_initial_batches_reports_interrupted_not_complete(fast_dispatch, service_stub):
    """Kill the background task mid-search, drop the entry: poll must not say complete."""
    service_stub['client'] = Client()
    service_stub['hids'] = ids(6684)

    async def run():
        response = await svc.search_hotels(request=None, payload=req(),
                                           auth=AuthContext(user_id=None), settings=Settings())
        assert response.loading is True
        entry = hotel_progress.get(response.search_id)
        assert entry is not None and entry.task is not None

        # Simulate the worker dying mid-continuation: the task is cancelled
        # before it can record a finish, and the in-process entry is lost.
        entry.task.cancel()
        await asyncio.gather(entry.task, return_exceptions=True)
        hotel_progress._entries.pop(response.search_id, None)
        assert hotel_progress.get(response.search_id) is None

        snapshot = await _poll(response.search_id)
        assert snapshot.status == 'partial'  # never 'complete', never 'loading'
        assert snapshot.incomplete_reason == 'interrupted'
        assert snapshot.total_batches == 67
        # Only the batches that landed before the interruption are served.
        assert len(snapshot.results) == len(response.results) > 0
        assert snapshot.next_offset == len(response.results)
        returned = {r.id for r in snapshot.results}
        assert len(returned) == len(snapshot.results)  # no duplicates
        return response

    asyncio.run(run())


def test_restart_after_full_completion_still_reports_complete(fast_dispatch, service_stub):
    """A search whose continuation finished persists 'complete' and survives a restart."""
    service_stub['client'] = Client()
    service_stub['hids'] = ids(6684)

    async def run():
        response = await svc.search_hotels(request=None, payload=req(),
                                           auth=AuthContext(user_id=None), settings=Settings())
        entry = hotel_progress.get(response.search_id)
        await entry.task
        assert entry.status == 'complete'

        hotel_progress._entries.pop(response.search_id, None)  # restart
        snapshot = await _poll(response.search_id)
        assert snapshot.status == 'complete'
        assert snapshot.incomplete_reason is None
        assert snapshot.completed_batches == 67 and snapshot.total_batches == 67
        assert snapshot.next_offset == 6684
        tail = await _poll(response.search_id, offset=6684)
        assert tail.results == [] and tail.status == 'complete'

    asyncio.run(run())


def test_restart_after_partial_completion_keeps_partial(fast_dispatch, service_stub):
    """A continuation that finished with a failed batch persists 'partial'."""
    service_stub['client'] = Client(fail_batches={36})
    service_stub['hids'] = ids(6684)

    async def run():
        response = await svc.search_hotels(request=None, payload=req(),
                                           auth=AuthContext(user_id=None), settings=Settings())
        entry = hotel_progress.get(response.search_id)
        await entry.task
        assert entry.status == 'partial'

        hotel_progress._entries.pop(response.search_id, None)  # restart
        snapshot = await _poll(response.search_id)
        assert snapshot.status == 'partial'
        assert snapshot.incomplete_reason == 'provider_failure'
        assert snapshot.failed_batches == 1 and snapshot.completed_batches == 66
        assert snapshot.next_offset == 6584

    asyncio.run(run())


def test_continuation_finish_persists_progress_on_session(fast_dispatch, service_stub):
    """The durable session carries the final progress state after the run."""
    service_stub['client'] = Client()
    service_stub['hids'] = ids(6684)

    async def run():
        response = await svc.search_hotels(request=None, payload=req(),
                                           auth=AuthContext(user_id=None), settings=Settings())
        entry = hotel_progress.get(response.search_id)
        await entry.task
        session = await hotel_sessions.get_search_session(settings=Settings(),
                                                          search_id=response.search_id)
        assert session is not None and session.progress is not None
        assert session.progress['status'] == 'complete'
        assert session.progress['completed_batches'] == 67
        assert session.progress['total_batches'] == 67

    asyncio.run(run())


def test_interrupted_search_keeps_persisted_loading_state(fast_dispatch, service_stub):
    """Cancellation must not overwrite the stored 'loading' progress."""
    service_stub['client'] = Client()
    service_stub['hids'] = ids(6684)

    async def run():
        response = await svc.search_hotels(request=None, payload=req(),
                                           auth=AuthContext(user_id=None), settings=Settings())
        entry = hotel_progress.get(response.search_id)
        entry.task.cancel()
        await asyncio.gather(entry.task, return_exceptions=True)
        session = await hotel_sessions.get_search_session(settings=Settings(),
                                                          search_id=response.search_id)
        assert session.progress['status'] == 'loading'  # unfinished stays unfinished

    asyncio.run(run())


def test_small_city_without_progress_entry_still_complete(fast_dispatch, service_stub):
    """Synchronous searches persist 'complete' up front; nothing changes for them."""
    service_stub['client'] = Client()
    service_stub['hids'] = ids(200)

    async def run():
        response = await svc.search_hotels(request=None, payload=req(),
                                           auth=AuthContext(user_id=None), settings=Settings())
        assert response.loading is False
        assert hotel_progress.get(response.search_id) is None
        snapshot = await _poll(response.search_id)
        assert snapshot.status == 'complete' and snapshot.next_offset == 200
        assert snapshot.total_batches == 2
        assert snapshot.completed_batches >= 1

    asyncio.run(run())


def test_legacy_session_without_progress_reports_complete(service_stub):
    """Sessions persisted before migration 0028 have no progress: keep old behavior."""
    from app.schemas.hotels import HotelResult

    async def run():
        session = await hotel_sessions.create_search_session(
            settings=Settings(), destination='Dubai', check_in='2026-11-01',
            check_out='2026-11-03', nights=2, rooms=req().rooms, nationality=None,
            results=[HotelResult(id='h1', name='Sea View')],
            provider_search_id=None, currency='INR', user_id=None,
        )
        assert session.progress is None
        snapshot = await _poll(session.id)
        assert snapshot.status == 'complete'
        assert snapshot.completed_batches == 0 and snapshot.total_batches == 0

    asyncio.run(run())
