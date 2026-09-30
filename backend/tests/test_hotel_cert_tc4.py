import argparse
import asyncio
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc4 as tc4
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
REVIEW = {"status": {"success": True}, "bookingId": "TGP9", "onholdAllowed": True,
          "option": {"optionId": "o1", "pricing": {"totalPrice": 56165.1447},
                     "cancellation": {"isRefundable": True, "penalties": []}}}


def _ns(**kw):
    base = dict(destination="Mumbai", days_ahead=30, hotel_id="", execute_uat_book=False, confirm="",
                max_candidates=30, contact_email="", contact_phone="", pan="", lead_guest="", out_dir="x")
    base.update(kw)
    return argparse.Namespace(**base)


def _full(monkeypatch, after="CANCELLATION_PENDING", booked="SUCCESS", cancel_ok=True, pay=True):
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)
    r = tc4.Recorder()
    r.record("hms/v3/hotel/listing", {"rooms": [], "apikey": "SECRET"}, {"hotels": []})
    r.record("hms/v3/hotel/pricing", {"hid": "1"}, {"options": []})
    r.record("hms/v3/hotel/review", {"hid": "1", "optionId": "o1", "reviewHash": "h"}, REVIEW)
    book = {"bookingId": "TGP9", "type": "HOTEL"}
    if pay:
        book["paymentInfos"] = [{"amount": 56165.1447}]
    r.record("oms/v3/hotel/book", book, {"bookingId": "TGP9", "status": {"success": True}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP9"}, {"order": {"status": booked}})
    r.record("oms/v3/hotel/cancel-booking/TGP9", None, {"status": {"success": cancel_ok, "httpStatus": 200}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP9"}, {"order": {"status": after}})
    return r


def test_occupancy_and_filenames():
    assert tc4.TC4_ROOMS == [{"adults": 1, "childAges": [2, 3]}, {"adults": 2, "childAges": [2]},
                             {"adults": 1, "childAges": [2]}, {"adults": 1, "childAges": []},
                             {"adults": 1, "childAges": []}]
    assert tc4.TC4_NIGHTS == 1
    assert set(tc4.FILENAMES) == SAMPLE_NAMES and len(tc4.FILENAMES) == 15


def test_export_structure(monkeypatch, tmp_path):
    z = tc4.export(_full(monkeypatch), tmp_path)
    folder = tmp_path / "Test Case 4"
    assert {p.name for p in folder.iterdir()} == SAMPLE_NAMES
    assert (folder / "TJ Test Hotel Cancel Request.json").read_text() == f"{BASE}/oms/v3/hotel/cancel-booking/TGP9"
    after = json.loads((folder / "TJ test hotel detail after cancel Response.json").read_text())
    assert after["order"]["status"] == "CANCELLATION_PENDING"
    pre = json.loads((folder / "TJ test hotel booking detail Response.json").read_text())
    assert pre["order"]["status"] == "SUCCESS"
    with zipfile.ZipFile(z) as zf:
        assert set(zf.namelist()) == {f"Test Case 4/{n}" for n in SAMPLE_NAMES}
        text = "".join(zf.read(n).decode() for n in zf.namelist())
    assert "SECRET" not in text and z.name == "Test_Case_4.zip"


@pytest.mark.parametrize("kw,msg", [
    (dict(pay=False), "paymentInfos"),
    (dict(booked="FAILED"), "not successful"),
    (dict(cancel_ok=False), "cancel-booking"),
    (dict(after="SUCCESS"), "no cancellation"),
])
def test_export_refusals(monkeypatch, tmp_path, kw, msg):
    with pytest.raises(SystemExit, match=msg):
        tc4.export(_full(monkeypatch, **kw), tmp_path)


def test_export_refuses_missing_cancel(monkeypatch, tmp_path):
    r = _full(monkeypatch)
    del r.pairs["cancel"]
    with pytest.raises(SystemExit, match="cancel"):
        tc4.export(r, tmp_path)


class _Result:
    rate = 1


class _Session:
    provider_search_id = "corr"
    check_in, check_out = "2026-06-25", "2026-06-26"
    currency = "INR"
    results = {"h1": _Result()}


def _patch(monkeypatch, booker_calls, statuses):
    monkeypatch.setattr(uat, "_config", lambda: (object(), object()))
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)

    async def via_search(args, settings):
        return _Session()
    monkeypatch.setattr(uat, "_session_via_search", via_search)
    monkeypatch.setattr(uat, "_rooms_from_session", lambda s: tc4.TC4_ROOMS)

    async def raw_post(config, payload, path=uat.HOTEL_LISTING_PATH):
        if path == uat.HOTEL_PRICING_PATH:
            return 200, {"reviewHash": "h", "options": []}, 0.1
        return 200, REVIEW, 0.1
    monkeypatch.setattr(uat, "_raw_post", raw_post)
    monkeypatch.setattr(uat, "_detail_candidates", lambda d, o: [{"optionId": "o1"}])

    async def booker_post(config, path, payload):
        booker_calls.append(path)
        if path == uat.HOTEL_BOOK_PATH:
            return 200, {"bookingId": "TGP9", "status": {"success": True}}, 0.1
        if tc4.is_cancel_path(path):
            return 200, {"status": {"success": True, "httpStatus": 200}}, 0.1
        return 200, {"order": {"status": statuses.pop(0)}}, 0.1
    monkeypatch.setattr(uat, "_booker_post", booker_post)

    async def no_sleep(_):
        return None
    monkeypatch.setattr(tc4.asyncio, "sleep", no_sleep)


def test_dry_run_never_books_or_cancels(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, [])
    assert asyncio.run(tc4.run(_ns(pan="ABCDE1234F"))) is None
    assert calls == []


def test_wrong_phrase_refused(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, [])
    with pytest.raises(SystemExit, match="CREATE-UAT-BOOK"):
        asyncio.run(tc4.run(_ns(execute_uat_book=True, confirm="NO", pan="ABCDE1234F",
                                contact_email="uat@example.com", contact_phone="9000000000")))
    assert calls == []


def test_real_flow_books_cancels_and_exports(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLATION_PENDING"])
    z = asyncio.run(tc4.run(_ns(execute_uat_book=True, confirm="CREATE-UAT-BOOK", pan="ABCDE1234F",
                                contact_email="uat@example.com", contact_phone="9000000000", out_dir=str(tmp_path))))
    assert calls[0] == uat.HOTEL_BOOK_PATH and any(tc4.is_cancel_path(c) for c in calls)
    folder = tmp_path / "Test Case 4"
    book = json.loads((folder / "TJ test Hotel Book Request.json").read_text())
    assert book["paymentInfos"] == [{"amount": 56165.1447}]
    assert [len(b["travellerInfo"]) for b in book["roomTravellerInfo"]] == [3, 3, 2, 1, 1]
    kids = [t for b in book["roomTravellerInfo"] for t in b["travellerInfo"] if t["pt"] == "CHILD"]
    assert [k["age"] for k in kids] == [2, 3, 2, 2] and all("pan" not in k for k in kids)
    assert z.name == "Test_Case_4.zip"


def test_no_cancel_when_booking_fails(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["FAILED"])
    with pytest.raises(SystemExit, match="Cancel NOT called"):
        asyncio.run(tc4.run(_ns(execute_uat_book=True, confirm="CREATE-UAT-BOOK", pan="ABCDE1234F",
                                contact_email="uat@example.com", contact_phone="9000000000")))
    assert not any(tc4.is_cancel_path(c) for c in calls)
