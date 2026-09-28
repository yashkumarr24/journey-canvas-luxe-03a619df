"""Hotel V3 detail (/hms/v3/hotel/pricing): request shape, session reuse,
confirmed response parsing, reviewHash propagation, pricing rule, errors.

Mocked only. Fixture follows the reply confirmed on live UAT from the VPS.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.integrations.tripjack import hotel_wire as wire
from app.integrations.tripjack import hotels as tj
from app.integrations.tripjack.exceptions import (
    TripJackAuthError,
    TripJackTimeoutError,
    TripJackUpstreamError,
)
from app.schemas.hotels import HotelOccupancy, HotelResult
from app.services import hotel_search as svc
from app.services import hotel_sessions as sessions


def option(oid="opt-1", base=2112.47, taxes=0.0, mf=20.0, mft=3.6, total=2136.07, **extra):
    o = {
        "optionId": oid, "optionType": "SRSM",
        "roomInfo": [{"id": "r1", "name": "Deluxe Room", "adults": 2, "children": 0}],
        "inclusions": ["Wifi"], "mealBasis": "Breakfast", "deadlineDateTime": "2026-10-20T12:00:00",
        "pricing": {"basePrice": base, "currency": "INR", "discount": 0, "gstClaimableAmount": 0,
                    "mf": mf, "mft": mft, "taxes": taxes, "totalPrice": total},
        "commercial": {"type": "NET", "commission": 0},
        "compliance": {"gstType": "NA", "panRequired": True, "passportRequired": False},
        "cancellation": {"isRefundable": True, "penalties": [
            {"from": "2026-09-01T00:00:00", "to": "2026-10-20T23:59:59", "amount": 0},
            {"from": "2026-10-20T23:59:59", "to": "2026-10-29T00:00:00", "amount": 2136.07}]},
    }
    o.update(extra)
    return o


def reply(options=None, hid="100000001897", **extra):
    b = {"hotelId": hid, "hotelName": "Live Name", "nationality": "106",
         "options": [option()] if options is None else options,
         "reviewHash": "RH-secret", "status": {"success": True}, "correlationId": "LIST-CORR"}
    b.update(extra)
    return b


class FakeClient:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls: list[tuple[str, dict]] = []

    async def post(self, path, payload, *, retries=0, operation=""):
        self.calls.append((path, payload))
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


Cfg = SimpleNamespace(search_retries=0)


def fallback():
    return HotelResult(id="100000001897", name="Catalogue Name", star_rating=4.0,
                       thumbnail_url="https://img/x.jpg", amenities=["Pool"])


def price(client, **kw):
    args = dict(listing_correlation_id="LIST-CORR", provider_hotel_id="100000001897",
                check_in="2026-10-28", check_out="2026-10-29",
                rooms=[{"adults": 2, "childAges": [5]}, {"adults": 1, "childAges": []}],
                nationality="IN", currency="INR", fallback=fallback())
    args.update(kw)
    return asyncio.run(tj.hotel_pricing(client, Cfg, **args))


# ------------------------------------------------------------------ request


def test_exact_flat_request_shape():
    c = FakeClient([reply()])
    price(c)
    path, p = c.calls[0]
    assert path == wire.HOTEL_PRICING_PATH
    assert p == {
        "checkIn": "2026-10-28", "checkOut": "2026-10-29", "correlationId": "LIST-CORR",
        "currency": "INR", "hid": "100000001897", "nationality": "106",
        "rooms": [{"adults": 2, "children": 1, "childAge": [5]}, {"adults": 1}],
        "timeoutMs": 13000,
    }
    for legacy in ("searchId", "hotelId", "hids", "searchQuery"):
        assert legacy not in p


def test_hid_is_string_and_correlation_reused():
    p = wire.build_pricing_payload(listing_correlation_id="X", hid=123, check_in="a", check_out="b",
                                   rooms=[{"adults": 1}], nationality="106", currency="inr")
    assert p["hid"] == "123" and p["correlationId"] == "X" and p["currency"] == "INR"


def test_missing_correlation_rejected():
    with pytest.raises(ValueError):
        wire.build_pricing_payload(listing_correlation_id="", hid="1", check_in="a", check_out="b",
                                   rooms=[], nationality=None, currency=None)


# ----------------------------------------------------------------- response


def test_parses_confirmed_reply_and_total_is_authoritative():
    r = price(FakeClient([reply()]))
    d = r.detail
    assert d.id == "100000001897" and d.name == "Live Name"
    [room] = d.rooms
    assert room.id == "opt-1" and room.meal_plan == "Breakfast"
    assert room.total_price.amount == 2136.07  # NOT 2159.67 (no mf/mft double count)
    assert room.base_price.amount == 2112.47 and room.taxes.amount == 0
    assert room.management_fee.amount == 20.0 and room.management_fee_tax.amount == 3.6
    assert room.pan_required is True and room.passport_required is False
    assert room.cancellation.refundable is True
    assert room.cancellation.free_cancellation_until == "2026-10-20T23:59:59"
    assert d.rate.total_price.amount == 2136.07


def test_catalogue_enrichment_preserved_live_price_wins():
    d = price(FakeClient([reply()])).detail
    assert d.star_rating == 4.0 and d.thumbnail_url == "https://img/x.jpg" and d.amenities == ["Pool"]
    assert d.rate.total_price.amount == 2136.07


def test_review_hash_returned_server_side_only():
    r = price(FakeClient([reply()]))
    assert r.review_hash == "RH-secret"
    dumped = json.dumps(r.detail.model_dump(by_alias=True, mode="json"))
    for leak in ("RH-secret", "reviewHash", "LIST-CORR", "gstClaimableAmount", "commercial", "deadlineDateTime"):
        assert leak not in dumped


def test_multiple_options_and_invalid_options_dropped():
    opts = [option("a", total=3000), option("b", total=2000),
            {"optionType": "SRSM", "pricing": {"totalPrice": 1}},       # no optionId
            {"optionId": "c", "pricing": {"basePrice": 1}},            # no totalPrice
            "junk"]
    d = price(FakeClient([reply(options=opts)])).detail
    assert sorted(r.id for r in d.rooms) == ["a", "b"]
    assert d.rate.total_price.amount == 2000


def test_no_options_gives_no_rooms():
    d = price(FakeClient([reply(options=[])])).detail
    assert d.rooms == []


def test_status_failure_and_mismatched_hotel_rejected():
    with pytest.raises(ValueError):
        price(FakeClient([reply(status={"success": False})]))
    with pytest.raises(ValueError):
        price(FakeClient([reply(hid="999")]))
    with pytest.raises(ValueError):
        price(FakeClient([["not", "a", "dict"]]))


# ------------------------------------------------------------------ service


def session(**kw):
    s = sessions.SearchSession(
        id="tok", row_id=None, destination="Goa", check_in="2026-10-28", check_out="2026-10-29", nights=1,
        rooms=[HotelOccupancy(adults=2, child_ages=[5]), HotelOccupancy(adults=1)],
        nationality="IN", currency="INR", results={"100000001897": fallback()},
        provider_search_id="LIST-CORR", expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    for k, v in kw.items():
        setattr(s, k, v)
    return s


@pytest.fixture
def wired(monkeypatch):
    client = FakeClient([])
    monkeypatch.setattr(svc, "_provider", lambda settings: (client, Cfg))
    return client


def test_service_uses_session_dates_rooms_currency_nationality(wired):
    wired.replies.append(reply())
    detail, rh = asyncio.run(svc._priced_hotel(settings=None, session=session(),
                                               provider_hotel_id="100000001897", fallback=fallback()))
    _, p = wired.calls[0]
    assert p["correlationId"] == "LIST-CORR" and p["hid"] == "100000001897"
    assert p["checkIn"] == "2026-10-28" and p["checkOut"] == "2026-10-29"
    assert p["rooms"] == [{"adults": 2, "children": 1, "childAge": [5]}, {"adults": 1}]
    assert p["currency"] == "INR" and p["nationality"] == "106"
    assert rh == "RH-secret" and detail.rooms[0].total_price.amount == 2136.07


def test_service_without_listing_correlation_is_expired(wired):
    with pytest.raises(svc.HotelSearchExpiredError):
        asyncio.run(svc._priced_hotel(settings=None, session=session(provider_search_id=None),
                                      provider_hotel_id="100000001897", fallback=fallback()))
    assert wired.calls == []


def test_service_no_rooms_is_unavailable(wired):
    wired.replies.append(reply(options=[]))
    with pytest.raises(svc.HotelRoomUnavailableError):
        asyncio.run(svc._priced_hotel(settings=None, session=session(),
                                      provider_hotel_id="100000001897", fallback=fallback()))


@pytest.mark.parametrize("exc,expected", [
    (TripJackTimeoutError("upstream said apikey=XYZ"), svc.HotelProviderTimeoutError),
    (TripJackAuthError("IP 1.2.3.4 not whitelisted"), svc.HotelProviderUnavailableError),
    (TripJackUpstreamError("raw body {...}"), svc.HotelProviderUnavailableError),
])
def test_provider_errors_sanitised(wired, exc, expected):
    wired.replies.append(exc)
    with pytest.raises(expected) as info:
        asyncio.run(svc._priced_hotel(settings=None, session=session(),
                                      provider_hotel_id="100000001897", fallback=fallback()))
    text = str(info.value.message)
    for leak in ("apikey", "XYZ", "1.2.3.4", "raw body"):
        assert leak not in text


def test_parse_failure_maps_to_not_found(wired):
    wired.replies.append(reply(hid="other"))
    with pytest.raises(svc.HotelNotFoundError):
        asyncio.run(svc._priced_hotel(settings=None, session=session(),
                                      provider_hotel_id="100000001897", fallback=fallback()))


def test_select_room_propagates_pricing_review_hash(wired, monkeypatch):
    wired.replies.append(reply())
    captured = {}

    async def fake_get(*, settings, search_id):
        return session()

    async def fake_review(*a, **k):
        return None, None  # review gave no hash -> pricing reviewHash kept

    async def fake_create(**kw):
        captured.update(kw)
        raise RuntimeError("stop")

    monkeypatch.setattr(sessions, "get_search_session", fake_get)
    monkeypatch.setattr(tj, "review_option", fake_review)
    monkeypatch.setattr(sessions, "create_review_session", fake_create)
    monkeypatch.setattr(svc.hotel_session_limiter, "check", lambda *_: None)
    monkeypatch.setattr(svc, "client_identity", lambda *a: "x")
    payload = SimpleNamespace(search_id="tok", hotel_id="100000001897", rate_id="opt-1", guest_token=None)
    auth = SimpleNamespace(user_id=None, is_authenticated=False)
    with pytest.raises(RuntimeError):
        asyncio.run(svc.select_room(request=None, payload=payload, auth=auth, settings=None))
    assert captured["provider_review_hash"] == "RH-secret"
    assert captured["room"].total_price.amount == 2136.07
