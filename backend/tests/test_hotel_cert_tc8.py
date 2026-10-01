import argparse
import asyncio
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc4 as tc4
from app.diagnostics import hotel_cert_tc8 as tc8
from app.diagnostics import hotel_listing_uat as uat

SAMPLE_NAMES = {
    "TJ test Hotel Book Request.json", "TJ test Hotel Book Response.json",
    "TJ test Hotel Search Request.json", "TJ test Hotel Search Response.json",
    "TJ test Hotel cancellation policy Request.json", "TJ test Hotel cancellation policy Response.json",
    "TJ test Hotel review Request.json", "TJ test Hotel review Response.json",
    "TJ test hotel booking detail Request.json", "TJ test hotel booking detail Response.json",
    "TJ test hotelDetail-search Request.json", "TJ test hotelDetail-search Response.json",
}
BASE = "https://apitest-hotel-booker.tripjack.com"
REVIEW = {"status": {"success": True}, "bookingId": "TGP9", "onholdAllowed": True,
          "option": {"optionId": "o1", "pricing": {"totalPrice": 68656.9833},
                     "cancellation": {"isRefundable": True, "penalties": []}}}


def _ns(**kw):
    base = dict(destination="Mumbai", days_ahead=30, hotel_id="", execute_uat_book=False, confirm="",
                max_candidates=30, contact_email="", contact_phone="", pan="", lead_guest="", out_dir="x")
    base.update(kw)
    return argparse.Namespace(**base)


def _full(monkeypatch, booked="SUCCESS", pay=True):
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)
    r = tc8.Recorder()
    r.record("hms/v3/hotel/listing", {"rooms": [], "apikey": "SECRET"}, {"hotels": []})
    r.record("hms/v3/hotel/pricing", {"hid": "1"}, {"options": []})
    r.record("hms/v3/hotel/review", {"hid": "1", "optionId": "o1", "reviewHash": "h"}, REVIEW)
    book = {"bookingId": "TGP9", "type": "HOTEL"}
    if pay:
        book["paymentInfos"] = [{"amount": 68656.9833}]
    r.record("oms/v3/hotel/book", book, {"bookingId": "TGP9", "status": {"success": True}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP9"}, {"order": {"status": booked}})
    return r


def test_occupancy_and_filenames():
    assert tc8.TC8_ROOMS == [{"adults": 3, "childAges": []}, {"adults": 3, "childAges": []}]
    assert tc8.TC8_NIGHTS == 1
    assert set(tc8.FILENAMES) == SAMPLE_NAMES and len(tc8.FILENAMES) == 12


def test_export_structure(monkeypatch, tmp_path):
    z = tc8.export(_full(monkeypatch), tmp_path)
    folder = tmp_path / "Test Case 8"
    assert {p.name for p in folder.iterdir()} == SAMPLE_NAMES
    detail = json.loads((folder / "TJ test hotel booking detail Response.json").read_text())
    assert detail["order"]["status"] == "SUCCESS"
    cancel = json.loads((folder / "TJ test Hotel cancellation policy Request.json").read_text())
    assert cancel["hid"] == "1" and cancel["optionId"] == "o1" and cancel["reviewHash"] == "h"
    with zipfile.ZipFile(z) as zf:
        assert set(zf.namelist()) == {f"Test Case 8/{n}" for n in SAMPLE_NAMES}
        text = "".join(zf.read(n).decode() for n in zf.namelist())
    assert "SECRET" not in text and z.name == "Test Case 8.zip"


@pytest.mark.parametrize("kw,msg", [
    (dict(pay=False), "paymentInfos"),
    (dict(booked="FAILED"), "not SUCCESS"),
])
def test_export_refusals(monkeypatch, tmp_path, kw, msg):
    with pytest.raises(SystemExit, match=msg):
        tc8.export(_full(monkeypatch, **kw), tmp_path)


def test_export_refuses_cancel_or_confirm_steps(monkeypatch, tmp_path):
    r = _full(monkeypatch)
    r.pairs["cancel"] = ("url", {"status": {"success": True}})
    with pytest.raises(SystemExit, match="confirm-hold or cancel"):
        tc8.export(r, tmp_path)


def test_export_refuses_missing_step(monkeypatch, tmp_path):
    r = _full(monkeypatch)
    del r.pairs["booking_detail"]
    with pytest.raises(SystemExit, match="booking_detail"):
        tc8.export(r, tmp_path)


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
        await uat._raw_post(None, {"rooms": []}, uat.HOTEL_LISTING_PATH)
        return _Session()
    monkeypatch.setattr(uat, "_session_via_search", via_search)
    monkeypatch.setattr(uat, "_rooms_from_session", lambda s: tc8.TC8_ROOMS)

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
        return 200, {"order": {"status": statuses.pop(0)}}, 0.1
    monkeypatch.setattr(uat, "_booker_post", booker_post)

    async def no_sleep(_):
        return None
    monkeypatch.setattr(tc4.asyncio, "sleep", no_sleep)


def test_dry_run_never_books(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, [])
    assert asyncio.run(tc8.run(_ns(pan="ABCDE1234F"))) is None
    assert calls == []


def test_wrong_phrase_refused(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, [])
    with pytest.raises(SystemExit, match="CREATE-UAT-BOOK"):
        asyncio.run(tc8.run(_ns(execute_uat_book=True, confirm="NO", pan="ABCDE1234F",
                                contact_email="ops@flynfeel.in", contact_phone="9000000000")))
    assert calls == []


def test_real_flow_books_and_exports(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"])
    z = asyncio.run(tc8.run(_ns(execute_uat_book=True, confirm="CREATE-UAT-BOOK", pan="ABCDE1234F",
                                contact_email="ops@flynfeel.in", contact_phone="9000000000",
                                lead_guest="Rohit Mehta", out_dir=str(tmp_path))))
    assert calls[0] == uat.HOTEL_BOOK_PATH
    assert not any(tc4.is_cancel_path(c) for c in calls)
    folder = tmp_path / "Test Case 8"
    book = json.loads((folder / "TJ test Hotel Book Request.json").read_text())
    assert book["paymentInfos"] == [{"amount": 68656.9833}]
    assert [len(b["travellerInfo"]) for b in book["roomTravellerInfo"]] == [3, 3]
    travellers = [t for b in book["roomTravellerInfo"] for t in b["travellerInfo"]]
    assert all(t["pt"] == "ADULT" and t["pan"] == "ABCDE1234F" for t in travellers)
    assert "passport" not in json.dumps(book).lower()
    lead = book["roomTravellerInfo"][0]["travellerInfo"][0]
    assert lead["fN"] == "Rohit" and lead["lN"] == "Mehta" and lead["isLeadGuest"] is True
    assert z.name == "Test Case 8.zip"


def test_lead_guest_three_word_name_accepted(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"])
    z = asyncio.run(tc8.run(_ns(execute_uat_book=True, confirm="CREATE-UAT-BOOK", pan="ABCDE1234F",
                                contact_email="ops@flynfeel.in", contact_phone="9000000000",
                                lead_guest="Test Guest Twenty", out_dir=str(tmp_path))))
    book = json.loads((tmp_path / "Test Case 8" / "TJ test Hotel Book Request.json").read_text())
    lead = book["roomTravellerInfo"][0]["travellerInfo"][0]
    assert lead["fN"] == "Test" and lead["lN"] == "Guest Twenty"
    assert z.name == "Test Case 8.zip"


def test_dry_run_accepts_three_word_lead_name(monkeypatch, capsys):
    calls = []
    _patch(monkeypatch, calls, [])
    assert asyncio.run(tc8.run(_ns(pan="ABCDE1234F", lead_guest="Test Guest Twenty"))) is None
    assert calls == []
    assert "Test Guest Twenty" not in capsys.readouterr().out


@pytest.mark.parametrize("bad", ["Single", "Four Word Name Here", "Rohit123 Mehta", "R Mehta"])
def test_lead_guest_invalid_formats_refused(monkeypatch, bad):
    calls = []
    _patch(monkeypatch, calls, [])
    with pytest.raises(SystemExit, match="--lead-guest"):
        asyncio.run(tc8.run(_ns(pan="ABCDE1234F", lead_guest=bad)))
    assert calls == []


def test_no_export_when_booking_fails(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["FAILED"])
    with pytest.raises(SystemExit, match="not SUCCESS"):
        asyncio.run(tc8.run(_ns(execute_uat_book=True, confirm="CREATE-UAT-BOOK", pan="ABCDE1234F",
                                contact_email="ops@flynfeel.in", contact_phone="9000000000",
                                out_dir=str(tmp_path))))
    assert not (tmp_path / "Test Case 8.zip").exists()


def test_cases_1_to_7_untouched():
    from app.diagnostics import hotel_cert_tc7 as tc7
    assert tc7.ZIP_NAME == "Test_Case_7.zip" and len(tc7.TC7_ROOMS) == 5
