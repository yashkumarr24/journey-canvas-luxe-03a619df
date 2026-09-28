"""Hotel V3 review (/hms/v3/hotel/review): confirmed 4-field request, reply
parsing, optionId handling, errors and leakage. Mocked only (fixture mirrors
the reply confirmed on live UAT from the VPS)."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.integrations.tripjack import hotel_wire as wire
from app.integrations.tripjack import hotels as tj
from app.integrations.tripjack.client import TripJackClient
from app.integrations.tripjack.exceptions import (
    TripJackBadRequestError,
    TripJackTimeoutError,
    TripJackUpstreamError,
)
from app.services import hotel_search as svc
from app.services import hotel_sessions as sessions
from tests.test_hotel_detail import FakeClient, option, reply, session

HID = "100000001897"
LEAKS = ("LIST-CORR", "RH-secret", "BK-SECRET", "gstClaimableAmount", "commercial",
         "gstType", "onholdAllowed", "reissued-id", "req-secret")


def review_reply(opt=None, hid=HID, **extra):
    b = {"correlationId": "LIST-CORR", "tjHotelId": hid, "hotelName": "Live Name",
         "bookingId": "BK-SECRET", "option": option() if opt is None else opt,
         "onholdAllowed": "true", "status": {"success": True}}
    b.update(extra)
    return b


def selected():
    return tj._room_option(option(), "INR")


def review(client, **kw):
    args = dict(listing_correlation_id="LIST-CORR", provider_hotel_id=HID, selected=selected(),
                review_hash="RH-secret", currency="INR")
    args.update(kw)
    return asyncio.run(tj.review_option(client, SimpleNamespace(), **args))


# ------------------------------------------------------------------ request


def test_exact_confirmed_request_and_correlation_reuse():
    c = FakeClient([review_reply()])
    review(c)
    path, p = c.calls[0]
    assert path == wire.HOTEL_REVIEW_PATH
    assert p == {"correlationId": "LIST-CORR", "optionId": "opt-1", "reviewHash": "RH-secret", "hid": HID}
    for absent in ("checkIn", "checkOut", "rooms", "currency", "nationality", "searchId", "hotelId"):
        assert absent not in p


def test_hid_always_string():
    p = wire.build_review_payload(listing_correlation_id="c", hid=100000001897, option_id="o", review_hash="h")
    assert p["hid"] == "100000001897" and isinstance(p["hid"], str)


@pytest.mark.parametrize("field", ["listing_correlation_id", "hid", "option_id", "review_hash"])
def test_missing_inputs_rejected(field):
    kw = dict(listing_correlation_id="c", hid="1", option_id="o", review_hash="h")
    kw[field] = ""
    with pytest.raises(ValueError):
        wire.build_review_payload(**kw)


# ------------------------------------------------------------------ parsing


def test_success_price_parsing_no_double_count():
    r = review(FakeClient([review_reply()]))
    room = r.room
    assert room.total_price.amount == 2136.07  # authoritative, mf/mft not re-added
    assert room.management_fee.amount == 20.0 and room.management_fee_tax.amount == 3.6
    assert room.meal_plan == "Breakfast" and room.inclusions == ["Wifi"]
    assert room.cancellation.refundable is True
    assert r.booking_id == "BK-SECRET" and r.option_id_changed is False


def test_price_change_is_taken_from_review():
    r = review(FakeClient([review_reply(option(total=2200.0, base=2176.4))]))
    assert r.room.total_price.amount == 2200.0


def test_wrong_hotel_and_failed_status_rejected():
    with pytest.raises(ValueError, match="mismatch"):
        review(FakeClient([review_reply(hid="999")]))
    with pytest.raises(ValueError):
        tj.normalize_review_response({"status": {"success": False}}, provider_hotel_id=HID,
                                     selected=selected(), currency="INR")
    with pytest.raises(ValueError):
        tj.normalize_review_response(["x"], provider_hotel_id=HID, selected=selected(), currency="INR")


def test_missing_or_unpriced_option_rejected():
    with pytest.raises(ValueError, match="no_option"):
        review(FakeClient([review_reply(opt={})]))
    bad = option()
    bad["pricing"].pop("totalPrice")
    with pytest.raises(ValueError, match="no_option"):
        review(FakeClient([review_reply(opt=bad)]))


def test_reissued_option_id_accepted_only_when_same_product():
    r = review(FakeClient([review_reply(option(oid="reissued-id"))]))
    assert r.option_id_changed is True and r.returned_option_id == "reissued-id"
    assert r.room.id == "opt-1"  # browser-facing id stays the selected one
    with pytest.raises(ValueError, match="option_mismatch"):
        review(FakeClient([review_reply(option(oid="reissued-id", optionType="CRCM"))]))
    two_rooms = option(oid="reissued-id", roomInfo=[{"id": "a"}, {"id": "b"}])
    with pytest.raises(ValueError, match="option_mismatch"):
        review(FakeClient([review_reply(two_rooms)]))


def test_v3_error_envelope_code_is_read_without_request_id():
    import httpx

    resp = httpx.Response(409, json={"status": {"success": False},
                                     "error": {"code": "OPTION_SOLD_OUT", "message": "m", "requestId": "req-secret"}})
    client = TripJackClient.__new__(TripJackClient)
    with pytest.raises(TripJackBadRequestError) as info:
        client._interpret(resp, "hotel_review")
    assert info.value.provider_code == "OPTION_SOLD_OUT"
    assert "req-secret" not in str(info.value)


# ------------------------------------------------------------------ service


@pytest.fixture
def flow(monkeypatch):
    client = FakeClient([])
    captured: dict = {}
    monkeypatch.setattr(svc, "_provider", lambda settings: (client, SimpleNamespace(search_retries=0)))
    monkeypatch.setattr(svc.hotel_session_limiter, "check", lambda *_: None)
    monkeypatch.setattr(svc, "client_identity", lambda *a: "x")

    async def fake_get(*, settings, search_id):
        return session()

    async def fake_create(**kw):
        captured.update(kw)
        s = SimpleNamespace(token="rev-tok", hotel=kw["hotel"], room=kw["room"], stay=kw["stay"],
                            currency=kw["currency"], previous_total=kw["previous_total"],
                            requirements=kw["requirements"])
        return s, None

    monkeypatch.setattr(sessions, "get_search_session", fake_get)
    monkeypatch.setattr(sessions, "create_review_session", fake_create)
    monkeypatch.setattr(sessions, "expires_at_iso", lambda s: "2026-10-01T00:00:00Z")
    monkeypatch.setattr(sessions, "seconds_left", lambda s: 600)
    monkeypatch.setattr(svc, "_requirements", lambda s: svc._requirements_for(s.room, s.hotel))
    return client, captured


def select(rate_id="opt-1"):
    payload = SimpleNamespace(search_id="tok", hotel_id=HID, rate_id=rate_id, guest_token=None)
    auth = SimpleNamespace(user_id=None, is_authenticated=False)
    return asyncio.run(svc.select_room(request=None, payload=payload, auth=auth, settings=None))


def test_service_success_and_no_leakage(flow):
    client, captured = flow
    client.replies += [reply(), review_reply()]
    resp = select()
    assert [c[0] for c in client.calls] == [wire.HOTEL_PRICING_PATH, wire.HOTEL_REVIEW_PATH]
    assert client.calls[1][1]["correlationId"] == "LIST-CORR" and client.calls[1][1]["reviewHash"] == "RH-secret"
    assert captured["provider_review_hash"] == "RH-secret" and captured["provider_option_id"] == "opt-1"
    assert resp.total_payable.amount == 2136.07 and resp.status == "reviewed"
    text = json.dumps(resp.model_dump(by_alias=True, mode="json"))
    for leak in LEAKS:
        assert leak not in text


def test_service_option_not_in_detail_is_unavailable(flow):
    client, _ = flow
    client.replies += [reply()]
    with pytest.raises(svc.HotelRoomUnavailableError):
        select("forged-option")
    assert len(client.calls) == 1  # review never called


def test_service_missing_review_hash_is_unavailable(flow):
    client, _ = flow
    client.replies += [reply(reviewHash=None)]
    with pytest.raises(svc.HotelRoomUnavailableError):
        select()
    assert len(client.calls) == 1


@pytest.mark.parametrize("exc,expected", [
    (TripJackBadRequestError("x", provider_code="OPTION_SOLD_OUT"), svc.HotelRoomUnavailableError),
    (TripJackBadRequestError("x", provider_code="SEARCH_SESSION_EXPIRED"), svc.HotelSearchExpiredError),
    (TripJackTimeoutError("apikey=XYZ"), svc.HotelProviderTimeoutError),
    (TripJackUpstreamError("raw body"), svc.HotelProviderUnavailableError),
])
def test_service_provider_errors_mapped(flow, exc, expected):
    client, _ = flow
    client.replies += [reply(), exc]
    with pytest.raises(expected) as info:
        select()
    for leak in ("apikey", "XYZ", "raw body"):
        assert leak not in str(info.value.message)


def test_service_unusable_review_never_falls_back_to_detail_price(flow):
    client, _ = flow
    client.replies += [reply(), review_reply(hid="999")]
    with pytest.raises(svc.HotelRoomUnavailableError):
        select()


def test_service_review_price_change_reported(flow):
    client, _ = flow
    client.replies += [reply(), review_reply(option(total=2200.0, base=2176.4))]
    resp = select()
    assert resp.status == "price_changed" and resp.total_payable.amount == 2200.0
