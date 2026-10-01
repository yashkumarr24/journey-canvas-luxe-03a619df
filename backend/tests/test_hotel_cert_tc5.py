import argparse
import asyncio
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc4 as tc4
from app.diagnostics import hotel_cert_tc5 as tc5
from app.diagnostics import hotel_listing_uat as uat

SAMPLE_NAMES = {
    "TJ Test Hotel Cancel Request.json", "TJ Test Hotel Cancel Response.json",
    "TJ test Hotel Book Request.json", "TJ test Hotel Book Response.json",
    "TJ test Hotel Search Request.json", "TJ test Hotel Search Response.json",
    "TJ test Hotel cancellation policy Request.json", "TJ test Hotel cancellation policy Response.json",
    "TJ test Hotel review Request.json", "TJ test Hotel review Response.json",
    "TJ test hotel booking detail Request.json", "TJ test hotel booking detail Response.json",
    "TJ test hotel detail after cancel Response.json",
    "TJ test hotelDetail-search Request.json", "TJ test hotelDetail-search Response.json",
}
BASE = "https://apitest-hotel-booker.tripjack.com"
POLICY = {"isRefundable": False, "penalties": [{"amount": 25568.3585}]}


def _review(hold=False):
    return {"status": {"success": True}, "bookingId": "TGP5", "onholdAllowed": hold,
            "option": {"optionId": "o1", "pricing": {"totalPrice": 25568.3585}, "cancellation": POLICY}}


def _ns(**kw):
    base = dict(destination="Mumbai", days_ahead=30, hotel_id="", execute_uat_book=False, confirm="",
                max_instant_candidates=30, cancel_poll_attempts=36, contact_email="", contact_phone="",
                pan="", lead_guest="", out_dir="x")
    base.update(kw)
    return argparse.Namespace(**base)


def _full(monkeypatch, after="CANCELLED", booked="SUCCESS", hold=False, pay=True):
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)
    r = tc4.Recorder()
    r.record("hms/v3/hotel/listing", {"rooms": [], "apikey": "SECRET"}, {"hotels": []})
    r.record("hms/v3/hotel/pricing", {"hid": "h1"}, {"options": []})
    r.record("hms/v3/hotel/review", {"hid": "h1", "optionId": "o1", "reviewHash": "rh"}, _review(hold))
    book = {"bookingId": "TGP5", "type": "HOTEL"}
    if pay:
        book["paymentInfos"] = [{"amount": 25568.3585}]
    r.record("oms/v3/hotel/book", book, {"bookingId": "TGP5", "status": {"success": True}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP5"}, {"order": {"status": booked}})
    r.record("oms/v3/hotel/cancel-booking/TGP5", None, {"status": {"success": True, "httpStatus": 200}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP5"}, {"order": {"status": after}})
    return r


def test_occupancy_and_filenames():
    assert tc5.TC5_ROOMS == [{"adults": 4, "childAges": [2, 3]}] and tc5.TC5_NIGHTS == 1
    assert set(tc5.FILENAMES) == SAMPLE_NAMES and len(tc5.FILENAMES) == 15


def test_export_structure(monkeypatch, tmp_path):
    z = tc5.export(_full(monkeypatch), tmp_path)
    folder = tmp_path / "Test Case 5"
    assert {p.name for p in folder.iterdir()} == SAMPLE_NAMES
    assert (folder / "TJ Test Hotel Cancel Request.json").read_text() == f"{BASE}/oms/v3/hotel/cancel-booking/TGP5"
    req = json.loads((folder / "TJ test Hotel cancellation policy Request.json").read_text())
    assert (req["hid"], req["optionId"], req["reviewHash"]) == ("h1", "o1", "rh") and "_note" in req
    resp = json.loads((folder / "TJ test Hotel cancellation policy Response.json").read_text())
    assert resp == {"hid": "h1", "optionId": "o1", "cancellationPolicy": POLICY}
    after = json.loads((folder / "TJ test hotel detail after cancel Response.json").read_text())
    assert after["order"]["status"] == "CANCELLED"
    with zipfile.ZipFile(z) as zf:
        assert set(zf.namelist()) == {f"Test Case 5/{n}" for n in SAMPLE_NAMES}
        assert "SECRET" not in "".join(zf.read(n).decode() for n in zf.namelist())
    assert z.name == "Test_Case_5.zip"


@pytest.mark.parametrize("kw,msg", [
    (dict(after="CANCELLATION_PENDING"), "not CANCELLED"),
    (dict(booked="PAYMENT_SUCCESS"), "not SUCCESS"),
    (dict(hold=True), "onholdAllowed=false"),
    (dict(pay=False), "paymentInfos"),
])
def test_export_refusals(monkeypatch, tmp_path, kw, msg):
    with pytest.raises(SystemExit, match=msg):
        tc5.export(_full(monkeypatch, **kw), tmp_path)
    assert not (tmp_path / "Test_Case_5.zip").exists()


class _Result:
    rate = 1


class _Session:
    provider_search_id = "corr"
    check_in, check_out = "2026-07-01", "2026-07-02"
    currency = "INR"
    results = {"h1": _Result()}


def _patch(monkeypatch, calls, statuses, hold=False):
    monkeypatch.setattr(uat, "_config", lambda: (object(), object()))
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)

    async def via_search(args, settings):
        await uat._raw_post(None, {"rooms": []}, uat.HOTEL_LISTING_PATH)
        return _Session()
    monkeypatch.setattr(uat, "_session_via_search", via_search)
    monkeypatch.setattr(uat, "_rooms_from_session", lambda s: tc5.TC5_ROOMS)

    async def raw_post(config, payload, path=uat.HOTEL_LISTING_PATH):
        if path == uat.HOTEL_PRICING_PATH:
            return 200, {"reviewHash": "rh", "options": []}, 0.1
        return 200, _review(hold), 0.1
    monkeypatch.setattr(uat, "_raw_post", raw_post)
    monkeypatch.setattr(uat, "_detail_candidates", lambda d, o: [{"optionId": "o1"}])

    async def booker_post(config, path, payload):
        calls.append(path)
        if path == uat.HOTEL_BOOK_PATH:
            return 200, {"bookingId": "TGP5", "status": {"success": True}}, 0.1
        if tc4.is_cancel_path(path):
            return 200, {"status": {"success": True, "httpStatus": 200}}, 0.1
        return 200, {"order": {"status": statuses.pop(0) if len(statuses) > 1 else statuses[0]}}, 0.1
    monkeypatch.setattr(uat, "_booker_post", booker_post)

    async def no_sleep(_):
        return None
    monkeypatch.setattr(tc4.asyncio, "sleep", no_sleep)


REAL = dict(execute_uat_book=True, confirm="CREATE-UAT-BOOK", pan="ABCDE1234F",
            contact_email="ops@flynfeel.in", contact_phone="9000000000")


def test_dry_run_never_books(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"])
    assert asyncio.run(tc5.run(_ns(pan="ABCDE1234F"))) is None
    assert calls == []


def test_holdable_review_never_books(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"], hold=True)
    with pytest.raises(SystemExit, match="NO INSTANT-ELIGIBLE"):
        asyncio.run(tc5.run(_ns(**REAL)))
    assert calls == []


def test_real_flow_waits_for_cancelled_and_exports(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLATION_PENDING", "CANCELLED"])
    z = asyncio.run(tc5.run(_ns(out_dir=str(tmp_path), lead_guest="Fresh Name", **REAL)))
    assert calls[0] == uat.HOTEL_BOOK_PATH
    book = json.loads((tmp_path / "Test Case 5" / "TJ test Hotel Book Request.json").read_text())
    assert book["paymentInfos"] == [{"amount": 25568.3585}]
    lead = book["roomTravellerInfo"][0]["travellerInfo"][0]
    assert (lead["fN"], lead["lN"]) == ("Fresh", "Name")
    assert z.name == "Test_Case_5.zip"


def test_no_cancel_unless_success(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["FAILED"])
    with pytest.raises(SystemExit, match="Cancel NOT called"):
        asyncio.run(tc5.run(_ns(**REAL)))
    assert not any(tc4.is_cancel_path(c) for c in calls)


def test_never_cancelled_no_export(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLATION_PENDING"])
    with pytest.raises(SystemExit, match="not CANCELLED"):
        asyncio.run(tc5.run(_ns(out_dir=str(tmp_path), cancel_poll_attempts=3, **REAL)))
    assert not (tmp_path / "Test_Case_5.zip").exists()


@pytest.mark.parametrize("name,first,last", [
    ("Rohit Mehta", "Rohit", "Mehta"),
    ("Test Guest Five", "Test", "Guest Five"),
    ("  Rohit   Mehta ", "Rohit", "Mehta"),
])
def test_lead_guest_valid(name, first, last):
    assert tc5.parse_lead_guest(name) == (first, last)


@pytest.mark.parametrize("name", ["Rohit", "A B C D", "Rohit M3hta", "Rohit O'Neil", "R Mehta", "Rohit-K Mehta"])
def test_lead_guest_invalid(name):
    with pytest.raises(SystemExit, match="--lead-guest"):
        tc5.parse_lead_guest(name)


@pytest.mark.parametrize("name,first,last", [("Test Guest Five", "Test", "Guest Five"), ("Rohit Mehta", "Rohit", "Mehta")])
def test_dry_run_with_lead_guest_no_crash(monkeypatch, capsys, name, first, last):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"])
    seen = {}
    orig = tc5.build_payload

    def spy(review, session, args):
        payload, failures = orig(review, session, args)
        seen["lead"], seen["failures"] = payload["roomTravellerInfo"][0]["travellerInfo"][0], failures
        return payload, failures
    monkeypatch.setattr(tc5, "build_payload", spy)
    assert asyncio.run(tc5.run(_ns(pan="ABCDE1234F", lead_guest=name))) is None
    assert calls == [] and (seen["lead"]["fN"], seen["lead"]["lN"]) == (first, last)
    assert seen["failures"] == [] or all("email" in f or "phone" in f for f in seen["failures"])
    assert name not in capsys.readouterr().out


def test_real_run_three_word_name_books(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLED"])
    asyncio.run(tc5.run(_ns(out_dir=str(tmp_path), **{**REAL, "lead_guest": "Test Guest Five"})))
    book = json.loads((tmp_path / "Test Case 5" / "TJ test Hotel Book Request.json").read_text())
    lead = book["roomTravellerInfo"][0]["travellerInfo"][0]
    assert (lead["fN"], lead["lN"]) == ("Test", "Guest Five")
