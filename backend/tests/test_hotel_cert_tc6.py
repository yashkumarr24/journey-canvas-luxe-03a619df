"""Mocked tests for Test Case 6 (hold -> cancel). No real TripJack call."""

import argparse
import asyncio
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc4 as tc4
from app.diagnostics import hotel_cert_tc6 as tc6
from app.diagnostics import hotel_listing_uat as uat

SAMPLE_NAMES = {
    "TJ Test Hotel Cancel Request.json", "TJ Test Hotel Cancel Response.json",
    "TJ test Hotel Hold Request.json", "TJ test Hotel Hold Response.json",
    "TJ test Hotel Search Request.json", "TJ test Hotel Search Response.json",
    "TJ test Hotel cancellation policy Request.json", "TJ test Hotel cancellation policy Response.json",
    "TJ test Hotel review Request.json", "TJ test Hotel review Response.json",
    "TJ test hotel booking detail Request.json", "TJ test hotel booking detail Response.json",
    "TJ test hotel detail after cancel Response.json",
    "TJ test hotelDetail-search Request.json", "TJ test hotelDetail-search Response.json",
}
BASE = "https://apitest-hotel-booker.tripjack.com"
POLICY = {"isRefundable": True, "penalties": [{"amount": 0.0}]}


def _review(hold=True, success=True):
    return {"status": {"success": success}, "bookingId": "TGP6", "onholdAllowed": hold,
            "option": {"optionId": "o1", "pricing": {"totalPrice": 13969.25}, "cancellation": POLICY}}


def _ns(**kw):
    base = dict(destination="Mumbai", days_ahead=30, hotel_id="", execute_uat_book=False, confirm="",
                max_candidates=30, cancel_poll_attempts=36, contact_email="", contact_phone="",
                pan="", lead_guest="", out_dir="x")
    base.update(kw)
    return argparse.Namespace(**base)


def _full(monkeypatch, after="CANCELLED", booked="ON_HOLD", hold=True, pay=False):
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)
    r = tc4.Recorder()
    r.record("hms/v3/hotel/listing", {"rooms": [], "apikey": "SECRET"}, {"hotels": []})
    r.record("hms/v3/hotel/pricing", {"hid": "h1"}, {"options": []})
    r.record("hms/v3/hotel/review", {"hid": "h1", "optionId": "o1", "reviewHash": "rh"}, _review(hold))
    book = {"bookingId": "TGP6", "type": "HOTEL"}
    if pay:
        book["paymentInfos"] = [{"amount": 1.0}]
    r.record("oms/v3/hotel/book", book, {"bookingId": "TGP6", "status": {"success": True}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP6"}, {"order": {"status": booked}})
    r.record("oms/v3/hotel/cancel-booking/TGP6", None, {"status": {"success": True, "httpStatus": 200}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP6"}, {"order": {"status": after}})
    return r


def test_occupancy_and_filenames():
    assert tc6.TC6_ROOMS == [{"adults": 2, "childAges": [2, 3]}, {"adults": 3, "childAges": [2]},
                             {"adults": 2, "childAges": [2]}]
    assert tc6.TC6_NIGHTS == 1
    assert set(tc6.FILENAMES) == SAMPLE_NAMES and len(tc6.FILENAMES) == 15


def test_export_structure(monkeypatch, tmp_path):
    z = tc6.export(_full(monkeypatch), tmp_path)
    folder = tmp_path / "Test Case 6"
    assert {p.name for p in folder.iterdir()} == SAMPLE_NAMES
    assert (folder / "TJ Test Hotel Cancel Request.json").read_text() == f"{BASE}/oms/v3/hotel/cancel-booking/TGP6"
    req = json.loads((folder / "TJ test Hotel cancellation policy Request.json").read_text())
    assert (req["hid"], req["optionId"], req["reviewHash"]) == ("h1", "o1", "rh")
    resp = json.loads((folder / "TJ test Hotel cancellation policy Response.json").read_text())
    assert resp == {"hid": "h1", "optionId": "o1", "cancellationPolicy": POLICY}
    hold = json.loads((folder / "TJ test Hotel Hold Request.json").read_text())
    assert "paymentInfos" not in hold
    with zipfile.ZipFile(z) as zf:
        assert set(zf.namelist()) == {f"Test Case 6/{n}" for n in SAMPLE_NAMES}
        assert "SECRET" not in "".join(zf.read(n).decode() for n in zf.namelist())
    assert z.name == "Test_Case_6.zip"


@pytest.mark.parametrize("kw,msg", [
    (dict(after="CANCELLATION_PENDING"), "not CANCELLED"),
    (dict(booked="SUCCESS"), "not ON_HOLD"),
    (dict(hold=False), "onholdAllowed=true"),
    (dict(pay=True), "paymentInfos"),
])
def test_export_refusals(monkeypatch, tmp_path, kw, msg):
    with pytest.raises(SystemExit, match=msg):
        tc6.export(_full(monkeypatch, **kw), tmp_path)
    assert not (tmp_path / "Test_Case_6.zip").exists()


class _Result:
    rate = 1


class _Session:
    provider_search_id = "corr"
    check_in, check_out = "2026-07-05", "2026-07-06"
    currency = "INR"
    results = {"h1": _Result()}


def _patch(monkeypatch, calls, statuses, reviews=None):
    monkeypatch.setattr(uat, "_config", lambda: (object(), object()))
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)

    async def via_search(args, settings):
        await uat._raw_post(None, {"rooms": []}, uat.HOTEL_LISTING_PATH)
        return _Session()
    monkeypatch.setattr(uat, "_session_via_search", via_search)
    monkeypatch.setattr(uat, "_rooms_from_session", lambda s: tc6.TC6_ROOMS)
    reviews = reviews if reviews is not None else [_review()]

    async def raw_post(config, payload, path=uat.HOTEL_LISTING_PATH):
        if path == uat.HOTEL_PRICING_PATH:
            return 200, {"reviewHash": "rh", "options": []}, 0.1
        if path == uat.HOTEL_REVIEW_PATH:
            return 200, reviews.pop(0) if len(reviews) > 1 else reviews[0], 0.1
        return 200, {"hotels": []}, 0.1
    monkeypatch.setattr(uat, "_raw_post", raw_post)
    monkeypatch.setattr(uat, "_detail_candidates", lambda d, o: [{"optionId": "o1"}, {"optionId": "o2"}])

    async def booker_post(config, path, payload):
        calls.append((path, payload))
        if path == uat.HOTEL_BOOK_PATH:
            return 200, {"bookingId": "TGP6", "status": {"success": True}}, 0.1
        if tc4.is_cancel_path(path):
            return 200, {"status": {"success": True, "httpStatus": 200}}, 0.1
        return 200, {"order": {"status": statuses.pop(0) if len(statuses) > 1 else statuses[0]}}, 0.1
    monkeypatch.setattr(uat, "_booker_post", booker_post)

    async def no_sleep(_):
        return None
    monkeypatch.setattr(tc4.asyncio, "sleep", no_sleep)


REAL = dict(execute_uat_book=True, confirm="CREATE-UAT-BOOK", pan="ABCDE1234F",
            contact_email="ops@flynfeel.in", contact_phone="9000000000", lead_guest="Fresh Name")


def test_dry_run_never_books_or_cancels(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["ON_HOLD"])
    assert asyncio.run(tc6.run(_ns(pan="ABCDE1234F"))) is None
    assert calls == []


def test_wrong_phrase_refused(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["ON_HOLD"])
    with pytest.raises(SystemExit, match="CREATE-UAT-BOOK"):
        asyncio.run(tc6.run(_ns(**{**REAL, "confirm": "yes"})))
    assert calls == []


def test_non_holdable_skipped_then_none_stops(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["ON_HOLD"], reviews=[_review(hold=False)])
    with pytest.raises(SystemExit, match="NO HOLD-ELIGIBLE OPTION"):
        asyncio.run(tc6.run(_ns(out_dir=str(tmp_path), **REAL)))
    assert calls == [] and not (tmp_path / "Test_Case_6.zip").exists()


def test_failed_review_then_holdable_used(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["ON_HOLD", "CANCELLED"], reviews=[_review(success=False), _review()])
    z = asyncio.run(tc6.run(_ns(out_dir=str(tmp_path), **REAL)))
    assert z.name == "Test_Case_6.zip"


def test_real_flow_hold_cancel_export(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["PENDING", "ON_HOLD", "CANCELLATION_PENDING", "CANCELLED"])
    z = asyncio.run(tc6.run(_ns(out_dir=str(tmp_path), **REAL)))
    path, payload = calls[0]
    assert path == uat.HOTEL_BOOK_PATH and "paymentInfos" not in payload
    assert not any(p == uat.HOTEL_CONFIRM_BOOK_PATH for p, _ in calls)
    folder = tmp_path / "Test Case 6"
    hold = json.loads((folder / "TJ test Hotel Hold Request.json").read_text())
    assert "paymentInfos" not in hold
    lead = hold["roomTravellerInfo"][0]["travellerInfo"][0]
    assert (lead["fN"], lead["lN"]) == ("Fresh", "Name")
    sizes = [len(b["travellerInfo"]) for b in hold["roomTravellerInfo"]]
    assert sizes == [4, 4, 3]
    bd = json.loads((folder / "TJ test hotel booking detail Response.json").read_text())
    assert bd["order"]["status"] == "ON_HOLD"
    after = json.loads((folder / "TJ test hotel detail after cancel Response.json").read_text())
    assert after["order"]["status"] == "CANCELLED"
    assert z.name == "Test_Case_6.zip"


def test_no_cancel_unless_on_hold(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["FAILED"])
    with pytest.raises(SystemExit, match="Cancel NOT called"):
        asyncio.run(tc6.run(_ns(**REAL)))
    assert not any(tc4.is_cancel_path(p) for p, _ in calls)


def test_never_cancelled_no_export(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["ON_HOLD", "CANCELLATION_PENDING"])
    with pytest.raises(SystemExit, match="not CANCELLED"):
        asyncio.run(tc6.run(_ns(out_dir=str(tmp_path), cancel_poll_attempts=3, **REAL)))
    assert not (tmp_path / "Test_Case_6.zip").exists()
