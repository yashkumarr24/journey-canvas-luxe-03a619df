"""Hotel-to-checkout linkage, mocked persistence only; no external requests."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.repositories.hotel_bookings import HotelBookingRepository
from app.schemas.hotels import HotelGuestDetailsRequest
from app.services import hotel_booking as bk, hotel_search as svc, hotel_sessions as sessions
from tests.test_hotel_booking import contact, guests, review_session, settings


def create(session=None):
    return bk.create_draft(
        settings=settings(), review_session=session or review_session(),
        booking_reference="FNFHA1B2C3", guests=guests(), contact=contact(),
        special_requests=None, nationality="IN",
    )


@pytest.mark.parametrize("guest", [False, True])
def test_single_rpc_preserves_server_price_owner_contact(monkeypatch, guest):
    session = review_session(total=2136.07, user_id=None if guest else "owner")
    session.guest_token_hash = "server-hash" if guest else None
    calls = []

    async def rpc(function, args):
        calls.append((function, args))
        return [{**args["p_draft"], "id": "hotel-id", "booking_id": "parent-id"}]

    repo = HotelBookingRepository(settings())
    repo._db = SimpleNamespace(enabled=True, rpc=rpc)
    monkeypatch.setattr(bk, "HotelBookingRepository", lambda _: repo)
    result = asyncio.run(create(session))
    assert len(calls) == 1
    assert calls[0][0] == "hotel_create_linked_draft"
    sent = calls[0][1]["p_draft"]
    assert sent["total_amount"] == 2136.07
    assert sent["currency"] == "INR"
    assert sent["user_id"] == session.user_id
    assert sent["guest_token_hash"] == session.guest_token_hash
    assert sent["contact"] == {"email": "ops@flynfeel.in", "phone": "9876543210", "dial_code": "+91"}
    assert result.booking_id == "parent-id"
    assert result.booking_reference == "FNFHA1B2C3"


def test_retry_returns_canonical_persisted_reference(monkeypatch):
    row = bk.HotelBooking(
        booking_reference="FNFH123ABC", review_token="r" * 48,
        provider_hotel_id="1", provider_option_id="2", total_amount=2136.07,
        booking_id="parent-id",
    ).row()
    repo = SimpleNamespace(enabled=True, create_linked_draft=AsyncMock(return_value={**row, "id": "hotel-id"}))
    monkeypatch.setattr(bk, "HotelBookingRepository", lambda _: repo)
    first, retry = asyncio.run(create()), asyncio.run(create())
    assert first.booking_reference == retry.booking_reference == "FNFH123ABC"
    assert first.booking_id == retry.booking_id == "parent-id"


@pytest.mark.parametrize("reply", [None, {}, {"id": "hotel-id"}, {"booking_id": "parent-id"}])
def test_incomplete_persistence_fails_without_memory_fallback(monkeypatch, reply):
    repo = SimpleNamespace(enabled=True, create_linked_draft=AsyncMock(return_value=reply))
    monkeypatch.setattr(bk, "HotelBookingRepository", lambda _: repo)
    bk._memory.by_ref.clear()
    with pytest.raises(bk.HotelBookingUnavailableError):
        asyncio.run(create())
    assert bk._memory.by_ref == {}


def test_unconfigured_database_refuses_draft():
    with pytest.raises(bk.HotelBookingUnavailableError):
        asyncio.run(create())


def test_repository_error_fails_closed(monkeypatch):
    repo = SimpleNamespace(enabled=True, create_linked_draft=AsyncMock(side_effect=RuntimeError("private")))
    monkeypatch.setattr(bk, "HotelBookingRepository", lambda _: repo)
    with pytest.raises(bk.HotelBookingUnavailableError) as error:
        asyncio.run(create())
    assert "private" not in str(error.value)


@pytest.mark.parametrize("fails", [False, True])
def test_guest_submission_only_awaits_payment_after_linkage(monkeypatch, fails):
    session = review_session(pan_required=False)
    payload = HotelGuestDetailsRequest(review_token=session.token, guests=guests(), contact=contact())
    monkeypatch.setattr(svc.hotel_session_limiter, "check", lambda _: None)
    monkeypatch.setattr(svc, "client_identity", lambda *_: "client")
    monkeypatch.setattr(sessions, "get_review_session", AsyncMock(return_value=session))
    recorder = AsyncMock()
    monkeypatch.setattr(sessions, "record_guest_details", recorder)
    creator = AsyncMock(
        side_effect=RuntimeError("persist failed") if fails else None,
        return_value=SimpleNamespace(booking_reference="FNFH123ABC", booking_id="parent-id"),
    )
    monkeypatch.setattr(bk, "create_draft", creator)
    call = svc.submit_guests(request=SimpleNamespace(), payload=payload,
                             auth=SimpleNamespace(user_id="u1", is_authenticated=True), settings=settings())
    if fails:
        with pytest.raises(bk.HotelBookingUnavailableError):
            asyncio.run(call)
        recorder.assert_not_awaited()
    else:
        response = asyncio.run(call)
        assert response.status == "awaiting_payment"
        assert response.booking_reference == "FNFH123ABC"
        assert recorder.await_args.kwargs["booking_reference"] == "FNFH123ABC"
        assert response.total_price.amount == 2136.07