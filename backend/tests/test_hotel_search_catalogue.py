"""Catalogue and batch-context regressions; synthetic fixtures, no external calls."""
import asyncio
from datetime import date, timedelta
import pytest
from app.integrations.tripjack import hotels, hotel_content
from app.integrations.tripjack.exceptions import TripJackTimeoutError
from app.repositories.hotel_catalogue import HotelCatalogueRepository
from app.core.config import Settings
from app.services import hotel_sessions
from app.schemas.hotels import HotelSearchRequest
from tests.test_hotel_listing import FakeClient, Cfg, body, hotel, ids, req


def test_100_id_limit_and_all_completed_batches_retained():
    client = FakeClient([body([hotel(str(i)) for i in range(100)], cid='a'),
                         body([hotel(str(i)) for i in range(100, 200)], cid='b'),
                         body([hotel(str(i)) for i in range(200, 250)], cid='c')])
    result, _, _ = asyncio.run(hotels.search_hotels(client, Cfg, req(), hids=ids(250)))
    assert [len(c['hids']) for c in client.calls] == [100, 100, 50]
    assert len(result) == 250
    assert result.provider_search_ids['0'] == 'a'
    assert result.provider_search_ids['100'] == 'b'
    assert result.provider_search_ids['249'] == 'c'


def test_failed_middle_batch_preserves_later_completed_results():
    client = FakeClient([body([hotel('one')], cid='a'), TripJackTimeoutError('timeout'),
                         body([hotel('three')], cid='c')])
    result, _, _ = asyncio.run(hotels.search_hotels(client, Cfg, req(), hids=ids(250)))
    assert [r.id for r in result] == ['one', 'three']
    assert result.failed_batches == 1 and result.completed_batches == 2


def test_empty_completed_batch_plus_failure_is_failure_not_no_availability():
    client = FakeClient([body([]), TripJackTimeoutError('timeout')])
    with pytest.raises(TripJackTimeoutError):
        asyncio.run(hotels.search_hotels(client, Cfg, req(), hids=ids(150)))


def test_missing_response_envelope_is_temporary_failure():
    client = FakeClient([{'status': {'success': True}}])
    with pytest.raises(Exception):
        asyncio.run(hotels.search_hotels(client, Cfg, req(), hids=ids(2)))


def test_catalogue_ids_are_keyset_paged_without_200_id_truncation():
    repo = HotelCatalogueRepository(Settings())
    calls = []
    class DB:
        async def rpc(self, fn, args):
            calls.append(args)
            start = 500 if args['p_after'] else 0
            end = 601 if start else 500
            return [{'tj_hotel_id': f'{i:04d}'} for i in range(start, end)]
    repo._db = DB()
    result = asyncio.run(repo.resolve_hids('Dubai, United Arab Emirates', kind='city', selected_id='region'))
    assert len(result) == 601
    assert calls[1]['p_after'] == '0499'
    assert calls[0]['p_kind'] == 'city' and calls[0]['p_id'] == 'region'


def test_selection_requires_both_kind_and_id():
    ci = date.today() + timedelta(days=10)
    with pytest.raises(ValueError):
        HotelSearchRequest(destination='Dubai', destination_kind='city', check_in=ci,
                           check_out=ci + timedelta(days=2), rooms=[{'adults': 2}])


def test_persisted_context_restores_nationality_and_batch_ids():
    result = hotels.normalize_listing_response(body([hotel('one')]), currency='INR').results[0]
    restored = hotel_sessions._search_from_row({
        'expires_at': (hotel_sessions._now() + timedelta(minutes=10)).isoformat(),
        'nationality': 'AE', 'provider_search_id': 'first', 'provider_search_ids': {'one': 'second'},
        'results': [result.model_dump(by_alias=True)], 'room_info': [{'adults': 3, 'childAges': [7]}],
    })
    assert restored.nationality == 'AE' and restored.provider_search_ids == {'one': 'second'}
    assert restored.rooms[0].adults == 3 and restored.rooms[0].child_ages == [7]


def test_more_without_cursor_never_silently_completes():
    with pytest.raises(ValueError):
        hotel_content._cursor_paging({'hasMore': True})


def test_mapping_uses_documented_zero_based_page_metadata():
    assert hotel_content._page_paging({'pageable': {'pageNumber': 0, 'totalPages': 2}}, 0)
    assert not hotel_content._page_paging({'pageable': {'pageNumber': 1, 'totalPages': 2}}, 1)
    with pytest.raises(ValueError):
        hotel_content._page_paging({'pageable': {'pageNumber': 0, 'totalPages': 2}}, 1)


def test_detail_uses_selected_hotels_batch_context(monkeypatch):
    from app.services import hotel_search
    from app.schemas.hotels import HotelDetailRequest, HotelDetail
    from app.core.auth import AuthContext
    result = hotels.normalize_listing_response(body([hotel('one')]), currency='INR').results[0]
    session = hotel_sessions.SearchSession(id='a' * 48, row_id=None, destination='Test city',
        check_in='2026-12-01', check_out='2026-12-04', nights=3, rooms=[], nationality='AE',
        currency='INR', results={'one': result}, provider_search_id='first',
        expires_at=hotel_sessions._now() + timedelta(minutes=10), provider_search_ids={'one': 'second'})
    async def get_session(**kwargs): return session
    async def priced(**kwargs):
        assert kwargs['session'].provider_search_id == 'second'
        assert kwargs['session'].nationality == 'AE'
        return HotelDetail(id='one', name='Test property'), None
    monkeypatch.setattr(hotel_search.sessions, 'get_search_session', get_session)
    monkeypatch.setattr(hotel_search, '_priced_hotel', priced)
    monkeypatch.setattr(hotel_search.hotel_session_limiter, 'check', lambda _: None)
    monkeypatch.setattr(hotel_search, 'client_identity', lambda *_: 'test')
    response = asyncio.run(hotel_search.hotel_detail(request=None,
        payload=HotelDetailRequest(search_id='a' * 48, hotel_id='one'),
        auth=AuthContext(user_id=None), settings=Settings()))
    assert response.hotel.id == 'one'
    assert session.provider_search_id == 'first'