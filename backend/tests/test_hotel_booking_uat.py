"""Mocked tests for the hotel Book UAT diagnostic. No real calls, no bookings."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.diagnostics import hotel_listing_uat as diag
from tests.test_hotel_review_uat import DETAIL_REPLY, HID, REVIEW_REPLY, _session

SECRETS = ("KEY-SECRET", "TGS-SECRET-BOOKING", "ops@secret.test", "9876500000", "ABCPE1234F",
           "hash-secret", "listing-corr", "Secret Hotel Name", "HCN-SECRET", "Uat", "Diagnostic")

DETAILS_REPLY = {
    "order": {"bookingId": "TGS-SECRET-BOOKING", "amount": 2136.07, "markup": 0,
              "deliveryInfo": {"emails": ["ops@secret.test"]}, "status": "ON_HOLD", "createdOn": "x"},
    "itemInfos": {"HOTEL": {"hInfo": {"name": "Secret Hotel Name", "ops": [
        {"tp": 2136.07, "ddt": "2026-10-20", "ipr": False, "ipm": False,
         "cnp": {"ifra": True, "pd": [{"am": 0}, {"am": 2000}]}}]}}},
    "hotelConfirmationNumber": "HCN-SECRET",
    "status": {"success": True, "httpStatus": 200},
}


def test_hold_payload_documented_shape_never_has_payment():
    p = diag.build_uat_book_payload(booking_id="B1", rooms=[{"adults": 2, "childAges": [5]}, {"adults": 1}],
                                    email="e@x", phone="1")
    assert set(p) == {"bookingId", "roomTravellerInfo", "deliveryInfo", "type"}
    assert p["type"] == "HOTEL" and "paymentInfos" not in p
    rooms = p["roomTravellerInfo"]
    assert [len(r["travellerInfo"]) for r in rooms] == [3, 1]
    assert [t["pt"] for t in rooms[0]["travellerInfo"]] == ["ADULT", "ADULT", "CHILD"]
    assert rooms[0]["travellerInfo"][2]["ti"] == "Master"
    leads = [r["travellerInfo"][0]["fN"] for r in rooms]
    assert len(set(leads)) == len(leads)  # lead pax unique across rooms
    assert p["deliveryInfo"] == {"emails": ["e@x"], "contacts": ["1"], "code": ["+91"]}
    assert all("pan" not in t for r in rooms for t in r["travellerInfo"])


def test_pan_passport_gst_only_when_given():
    p = diag.build_uat_book_payload(booking_id="B", rooms=[{"adults": 1}], email="e", phone="1",
                                    pan="P", passport="N", gst_info={"gstNumber": "g", "registeredName": "r"})
    t = p["roomTravellerInfo"][0]["travellerInfo"][0]
    assert t["pan"] == "P" and t["pNum"] == "N" and p["gstInfo"]["gstNumber"] == "g"
    with pytest.raises(ValueError):
        diag.build_uat_book_payload(booking_id="", rooms=[], email="e", phone="1")


def test_requirements_from_review():
    r = diag.book_requirements(REVIEW_REPLY)
    assert r["booking_id_present"] is True and r["pan_required"] is False
    assert r["gst_info_needed"] is False and r["onhold_allowed"] is True
    assert r["hold_deadline_present"] is True and r["review_total_price"] == 2136.07
    reseller = json.loads(json.dumps(REVIEW_REPLY))
    reseller["option"]["compliance"]["gstType"] = "RESELLER"
    assert diag.book_requirements(reseller)["gst_info_needed"] is True
    assert "TGS-SECRET-BOOKING" not in json.dumps(r)


def test_summaries_are_safe():
    b = diag.book_summary({"bookingId": "TGS-SECRET-BOOKING", "status": {"success": True}, "metaInfo": {}})
    assert b["booking_id_present"] is True and b["status_success"] is True
    d = diag.booking_details_summary(DETAILS_REPLY)
    assert d["order_status"] == "ON_HOLD" and d["order_amount"] == 2136.07
    assert d["option_refundable"] is True and d["option_penalties_count"] == 2
    text = json.dumps([b, d])
    for secret in SECRETS:
        assert secret not in text
    e = diag.book_summary({"status": {"success": False}, "error": {"code": "X", "message": "m", "requestId": "r"}})
    assert e["errors"] == [{"code": "X", "message": "m"}]


def test_booker_host_must_be_uat(monkeypatch):
    monkeypatch.setenv("TRIPJACK_HOTEL_BOOKER_URL", "https://hotel-booker.tripjack.com")
    with pytest.raises(SystemExit):
        diag._booker_base()
    monkeypatch.delenv("TRIPJACK_HOTEL_BOOKER_URL")
    assert diag._booker_base() == diag.UAT_BOOKER_BASE_URL


def _args(**kw):
    base = dict(search_id="tok", hotel_id="", option_id="", destination="Goa", days_ahead=30, nights=1,
                adults=2, execute_uat_hold=False, confirm="", contact_email="", contact_phone="",
                pan="", passport="", poll_attempts=2, cancel_after=False)
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.fixture
def wired(monkeypatch):
    calls: list = []
    booker: list = []

    async def fake_post(config, payload, path=diag.HOTEL_LISTING_PATH):
        calls.append(path)
        return 200, {diag.HOTEL_PRICING_PATH: DETAIL_REPLY, diag.HOTEL_REVIEW_PATH: REVIEW_REPLY}[path], 0.1

    async def fake_booker(config, path, payload):
        booker.append((path, payload))
        if path == diag.HOTEL_BOOK_PATH:
            return 200, {"bookingId": "TGS-SECRET-BOOKING", "status": {"success": True}, "metaInfo": {}}, 0.1
        if path.startswith(diag.HOTEL_CANCEL_BOOKING_PATH):
            return 200, {"status": {"success": True}}, 0.1
        return 200, DETAILS_REPLY, 0.1

    async def fake_get(*, settings, search_id):
        return _session()

    async def no_sleep(_):
        return None

    from app.services import hotel_sessions

    monkeypatch.setattr(diag, "_config", lambda: (object(), SimpleNamespace(api_key="KEY-SECRET")))
    monkeypatch.setattr(diag, "_raw_post", fake_post)
    monkeypatch.setattr(diag, "_booker_post", fake_booker)
    monkeypatch.setattr(diag.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(hotel_sessions, "get_search_session", fake_get)
    return calls, booker


def test_dry_run_never_calls_book(wired, capsys):
    calls, booker = wired
    asyncio.run(diag.run_book(_args()))
    assert calls == [diag.HOTEL_PRICING_PATH, diag.HOTEL_REVIEW_PATH]
    assert booker == []
    out = capsys.readouterr().out
    assert "DRY RUN" in out and "paymentInfos included: False" in out
    for secret in SECRETS:
        assert secret not in out


@pytest.mark.parametrize("kw", [
    dict(execute_uat_hold=True, confirm="yes", contact_email="ops@secret.test", contact_phone="9876500000"),
    dict(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE),
])
def test_execute_requires_phrase_and_contact(wired, kw):
    _, booker = wired
    with pytest.raises(SystemExit):
        asyncio.run(diag.run_book(_args(**kw)))
    assert booker == []


def test_execute_hold_polls_and_cancels_safely(wired, capsys):
    _, booker = wired
    asyncio.run(diag.run_book(_args(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE,
                                    contact_email="ops@secret.test", contact_phone="9876500000",
                                    cancel_after=True)))
    paths = [b[0] for b in booker]
    assert paths[0] == diag.HOTEL_BOOK_PATH and "paymentInfos" not in booker[0][1]
    assert booker[0][1]["bookingId"] == "TGS-SECRET-BOOKING"  # Review bookingId drives Book
    assert paths[1] == diag.HOTEL_BOOKING_DETAILS_PATH  # stops at terminal ON_HOLD
    assert paths[2].startswith(diag.HOTEL_CANCEL_BOOKING_PATH)
    out = capsys.readouterr().out
    assert "order_status=ON_HOLD" in out
    for secret in SECRETS:
        assert secret not in out


def test_pan_required_blocks_execute_without_pan(wired, monkeypatch):
    rev = json.loads(json.dumps(REVIEW_REPLY))
    rev["option"]["compliance"]["panRequired"] = True

    async def fake_post(config, payload, path=diag.HOTEL_LISTING_PATH):
        return 200, {diag.HOTEL_PRICING_PATH: DETAIL_REPLY, diag.HOTEL_REVIEW_PATH: rev}[path], 0.1

    monkeypatch.setattr(diag, "_raw_post", fake_post)
    with pytest.raises(SystemExit, match="PAN"):
        asyncio.run(diag.run_book(_args(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE,
                                        contact_email="e", contact_phone="1")))


def test_failed_review_stops_before_book(wired, monkeypatch):
    _, booker = wired

    async def fake_post(config, payload, path=diag.HOTEL_LISTING_PATH):
        if path == diag.HOTEL_PRICING_PATH:
            return 200, DETAIL_REPLY, 0.1
        return 409, {"status": {"success": False}, "error": {"code": "OPTION_SOLD_OUT"}}, 0.1

    monkeypatch.setattr(diag, "_raw_post", fake_post)
    with pytest.raises(SystemExit, match="Review failed"):
        asyncio.run(diag.run_book(_args()))
    assert booker == []
