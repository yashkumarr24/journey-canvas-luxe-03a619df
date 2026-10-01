import argparse
import asyncio
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc4 as tc4
from app.diagnostics import hotel_cert_tc10 as tc10
from app.diagnostics import hotel_cert_tc11 as tc11
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
POLICY = {"isRefundable": True, "penalties": [{"amount": 0}]}
NONREFUNDABLE_POLICY = {"isRefundable": False, "penalties": [{"amount": 25568.3585}]}


def _review(hold=False, refundable=True):
    policy = POLICY if refundable else NONREFUNDABLE_POLICY
    return {"status": {"success": True}, "bookingId": "TGP5", "onholdAllowed": hold,
            "option": {"optionId": "o1", "pricing": {"totalPrice": 25568.3585}, "cancellation": policy}}


def _ns(**kw):
    base = dict(destination="Mumbai", days_ahead=30, hotel_id="", execute_uat_book=False, confirm="",
                max_instant_candidates=30, cancel_poll_attempts=36, contact_email="", contact_phone="",
                pan="", lead_guest="", out_dir="x")
    base.update(kw)
    return argparse.Namespace(**base)


def _full(monkeypatch, after="CANCELLED", booked="SUCCESS", hold=False, pay=True, refundable=True):
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)
    r = tc4.Recorder()
    r.record("hms/v3/hotel/listing", {"rooms": [], "apikey": "SECRET"}, {"hotels": []})
    r.record("hms/v3/hotel/pricing", {"hid": "h1"}, {"options": []})
    r.record("hms/v3/hotel/review", {"hid": "h1", "optionId": "o1", "reviewHash": "rh"}, _review(hold, refundable))
    book = {"bookingId": "TGP5", "type": "HOTEL"}
    if pay:
        book["paymentInfos"] = [{"amount": 25568.3585}]
    r.record("oms/v3/hotel/book", book, {"bookingId": "TGP5", "status": {"success": True}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP5"}, {"order": {"status": booked}})
    r.record("oms/v3/hotel/cancel-booking/TGP5", None, {"status": {"success": True, "httpStatus": 200}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP5"}, {"order": {"status": after}})
    return r


def test_occupancy_and_filenames():
    assert tc11.TC11_ROOMS == [{"adults": 2, "childAges": [6]}]
    assert tc11.TC11_NIGHTS == 1
    assert set(tc11.FILENAMES) == SAMPLE_NAMES and len(tc11.FILENAMES) == 15
    assert "TJ test hotel detail after cancel Request.json" not in tc11.FILENAMES
    args = tc11.build_args(_ns())
    assert args.rooms == tc11.TC11_ROOMS and args.nights == 1


def test_export_structure(monkeypatch, tmp_path):
    z = tc11.export(_full(monkeypatch), tmp_path)
    folder = tmp_path / "Test Case 11"
    assert {p.name for p in folder.iterdir()} == SAMPLE_NAMES
    assert (folder / "TJ Test Hotel Cancel Request.json").read_text() == f"{BASE}/oms/v3/hotel/cancel-booking/TGP5"
    req = json.loads((folder / "TJ test Hotel cancellation policy Request.json").read_text())
    assert (req["hid"], req["optionId"], req["reviewHash"]) == ("h1", "o1", "rh") and "_note" in req
    resp = json.loads((folder / "TJ test Hotel cancellation policy Response.json").read_text())
    assert resp == {"hid": "h1", "optionId": "o1", "cancellationPolicy": POLICY}
    after = json.loads((folder / "TJ test hotel detail after cancel Response.json").read_text())
    assert after["order"]["status"] == "CANCELLED"
    with zipfile.ZipFile(z) as zf:
        assert set(zf.namelist()) == {f"Test Case 11/{n}" for n in SAMPLE_NAMES}
        assert "SECRET" not in "".join(zf.read(n).decode() for n in zf.namelist())
    assert z.name == "Test_Case_11.zip"


@pytest.mark.parametrize("kw,msg", [
    (dict(after="CANCELLATION_PENDING"), "not CANCELLED"),
    (dict(booked="PAYMENT_SUCCESS"), "not SUCCESS"),
    (dict(pay=False), "paymentInfos"),
    (dict(refundable=False), "not refundable"),
])
def test_export_refusals(monkeypatch, tmp_path, kw, msg):
    with pytest.raises(SystemExit, match=msg):
        tc11.export(_full(monkeypatch, **kw), tmp_path)
    assert not (tmp_path / "Test_Case_11.zip").exists()


class _Result:
    rate = 1


class _Session:
    provider_search_id = "corr"
    check_in, check_out = "2026-07-01", "2026-07-02"
    currency = "INR"
    results = {"h1": _Result()}


def _patch(monkeypatch, calls, statuses, hold=False, reviews=None):
    monkeypatch.setattr(uat, "_config", lambda: (object(), object()))
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)

    async def via_search(args, settings):
        await uat._raw_post(None, {"rooms": []}, uat.HOTEL_LISTING_PATH)
        return _Session()
    monkeypatch.setattr(uat, "_session_via_search", via_search)
    monkeypatch.setattr(uat, "_rooms_from_session", lambda s: tc11.TC11_ROOMS)

    async def raw_post(config, payload, path=uat.HOTEL_LISTING_PATH):
        if path == uat.HOTEL_PRICING_PATH:
            return 200, {"reviewHash": "rh", "options": []}, 0.1
        if reviews is not None:
            return 200, reviews.pop(0) if len(reviews) > 1 else reviews[0], 0.1
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
    assert asyncio.run(tc11.run(_ns(pan="ABCDE1234F"))) is None
    assert calls == []


def test_holdable_refundable_review_is_booked_instantly(monkeypatch, tmp_path):
    # The sample's Review had onholdAllowed=true and was still booked instantly.
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLED"], hold=True)
    z = asyncio.run(tc11.run(_ns(out_dir=str(tmp_path), **REAL)))
    assert calls[0] == uat.HOTEL_BOOK_PATH and z.name == "Test_Case_11.zip"


def test_failed_review_never_books(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"], reviews=[{"status": {"success": False}}])
    with pytest.raises(SystemExit, match="NO REFUNDABLE OPTION"):
        asyncio.run(tc11.run(_ns(**REAL)))
    assert calls == []


def test_real_flow_books_one_room_with_child_age_6(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLED"])
    asyncio.run(tc11.run(_ns(out_dir=str(tmp_path), **REAL)))
    book = json.loads((tmp_path / "Test Case 11" / "TJ test Hotel Book Request.json").read_text())
    rooms = book["roomTravellerInfo"]
    assert [len(r["travellerInfo"]) for r in rooms] == [3]
    kids = [t for r in rooms for t in r["travellerInfo"] if t["pt"] == "CHILD"]
    assert [k["age"] for k in kids] == [6] and all("pan" not in k for k in kids)
    assert "passport" not in json.dumps(book).lower()
    adults = [t for r in rooms for t in r["travellerInfo"] if t["pt"] == "ADULT"]
    assert len(adults) == 2 and all(a.get("pan") == "ABCDE1234F" for a in adults)
    assert [c for c in calls if tc4.is_cancel_path(c)] == [f"{uat.HOTEL_CANCEL_BOOKING_PATH}/TGP5"]


def test_logs_hide_secrets(monkeypatch, tmp_path, capsys):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLED"])
    asyncio.run(tc11.run(_ns(out_dir=str(tmp_path), lead_guest="Fresh Name", **REAL)))
    out = capsys.readouterr().out
    for secret in ("ABCDE1234F", "ops@flynfeel.in", "9000000000", "Fresh Name", '"rh"', "TGP5"):
        assert secret not in out


def test_review_is_refundable_rule():
    assert tc10.review_is_refundable(_review()) is True
    assert tc10.review_is_refundable(_review(refundable=False)) is False
    assert tc10.review_is_refundable({"option": {"cancellation": {"isRefundable": "true"}}}) is True
    assert tc10.review_is_refundable({"option": {"cancellation": {}}}) is False
    assert tc10.review_is_refundable({}) is False


def test_nonrefundable_first_option_skipped_for_refundable(monkeypatch, tmp_path):
    calls = []
    reviews = [_review(refundable=False), _review(refundable=True)]
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLED"], reviews=reviews)
    z = asyncio.run(tc11.run(_ns(out_dir=str(tmp_path), **REAL)))
    assert calls[0] == uat.HOTEL_BOOK_PATH
    resp = json.loads((tmp_path / "Test Case 11" / "TJ test Hotel review Response.json").read_text())
    assert resp["option"]["cancellation"]["isRefundable"] is True
    assert z.name == "Test_Case_11.zip"


def test_no_refundable_instant_option_stops_safely(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"], reviews=[_review(refundable=False)])
    with pytest.raises(SystemExit, match="NO REFUNDABLE OPTION"):
        asyncio.run(tc11.run(_ns(out_dir=str(tmp_path), **REAL)))
    assert calls == []
    assert not (tmp_path / "Test_Case_11.zip").exists()


def test_real_flow_waits_for_cancelled_and_exports(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLATION_PENDING", "CANCELLED"])
    z = asyncio.run(tc11.run(_ns(out_dir=str(tmp_path), lead_guest="Fresh Name", **REAL)))
    assert calls[0] == uat.HOTEL_BOOK_PATH
    book = json.loads((tmp_path / "Test Case 11" / "TJ test Hotel Book Request.json").read_text())
    assert book["paymentInfos"] == [{"amount": 25568.3585}]
    lead = book["roomTravellerInfo"][0]["travellerInfo"][0]
    assert (lead["fN"], lead["lN"]) == ("Fresh", "Name")
    assert z.name == "Test_Case_11.zip"


def test_no_cancel_unless_success(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["FAILED"])
    with pytest.raises(SystemExit, match="Cancel NOT called"):
        asyncio.run(tc11.run(_ns(**REAL)))
    assert not any(tc4.is_cancel_path(c) for c in calls)


def test_never_cancelled_no_export(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLATION_PENDING"])
    with pytest.raises(SystemExit, match="not CANCELLED"):
        asyncio.run(tc11.run(_ns(out_dir=str(tmp_path), cancel_poll_attempts=3, **REAL)))
    assert not (tmp_path / "Test_Case_11.zip").exists()


@pytest.mark.parametrize("name,first,last", [
    ("Rohit Mehta", "Rohit", "Mehta"),
    ("Test Guest Five", "Test", "Guest Five"),
    ("  Rohit   Mehta ", "Rohit", "Mehta"),
])
def test_lead_guest_valid(name, first, last):
    assert tc10.parse_lead_guest(name) == (first, last)


@pytest.mark.parametrize("name", ["Rohit", "A B C D", "Rohit M3hta", "Rohit O'Neil", "R Mehta", "Rohit-K Mehta"])
def test_lead_guest_invalid(name):
    with pytest.raises(SystemExit, match="--lead-guest"):
        tc10.parse_lead_guest(name)


@pytest.mark.parametrize("name,first,last", [("Test Guest Five", "Test", "Guest Five"), ("Rohit Mehta", "Rohit", "Mehta")])
def test_dry_run_with_lead_guest_no_crash(monkeypatch, capsys, name, first, last):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"])
    seen = {}
    orig = tc10.build_payload

    def spy(review, session, args):
        payload, failures = orig(review, session, args)
        seen["lead"], seen["failures"] = payload["roomTravellerInfo"][0]["travellerInfo"][0], failures
        return payload, failures
    monkeypatch.setattr(tc10, "build_payload", spy)
    assert asyncio.run(tc11.run(_ns(pan="ABCDE1234F", lead_guest=name))) is None
    assert calls == [] and (seen["lead"]["fN"], seen["lead"]["lN"]) == (first, last)
    assert seen["failures"] == [] or all("email" in f or "phone" in f for f in seen["failures"])
    assert name not in capsys.readouterr().out


def test_real_run_three_word_name_books(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLED"])
    asyncio.run(tc11.run(_ns(out_dir=str(tmp_path), **{**REAL, "lead_guest": "Test Guest Five"})))
    book = json.loads((tmp_path / "Test Case 11" / "TJ test Hotel Book Request.json").read_text())
    lead = book["roomTravellerInfo"][0]["travellerInfo"][0]
    assert (lead["fN"], lead["lN"]) == ("Test", "Guest Five")


def test_cancel_request_has_no_body(monkeypatch, tmp_path):
    seen = []
    _patch(monkeypatch, [], ["SUCCESS", "CANCELLED"])
    inner = uat._booker_post

    async def spy(config, path, payload):
        if tc4.is_cancel_path(path):
            seen.append(payload)
        return await inner(config, path, payload)
    monkeypatch.setattr(uat, "_booker_post", spy)
    asyncio.run(tc11.run(_ns(out_dir=str(tmp_path), **REAL)))
    assert seen == [None]
