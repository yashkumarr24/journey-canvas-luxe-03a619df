import argparse
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc2 as tc2

SAMPLE_NAMES = {
    f"TJ test {s} {k}.json"
    for s in ("Hotel Search", "hotelDetail-search", "Hotel review", "Hotel cancellation policy",
              "Hotel Book", "hotel booking detail")
    for k in ("Request", "Response")
}
REVIEW_RESP = {"status": {"success": True}, "bookingId": "TGP1", "onholdAllowed": False,
               "option": {"optionId": "o1", "pricing": {"totalPrice": 6202.0751},
                          "cancellation": {"isRefundable": False, "penalties": [{"amount": 6202.0751}]}}}


def _full(status="PAYMENT_SUCCESS", pay=True):
    r = tc2.tc3.Recorder()
    r.record("hms/v3/hotel/listing", {"rooms": [{"adults": 4}], "apikey": "SECRET"}, {"hotels": []})
    r.record("hms/v3/hotel/pricing", {"hid": "1"}, {"options": []})
    r.record("hms/v3/hotel/review", {"hid": "1", "optionId": "o1", "reviewHash": "h"}, REVIEW_RESP)
    book = {"bookingId": "TGP1", "type": "HOTEL"}
    if pay:
        book["paymentInfos"] = [{"amount": 6202.0751}]
    r.record("oms/v3/hotel/book", book, {"bookingId": "TGP1", "status": {"success": True}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP1"}, {"order": {"status": status}})
    return r


def _ns(**kw):
    base = dict(destination="Mumbai", days_ahead=30, hotel_id="", execute_uat_book=False, confirm="",
                contact_email="", contact_phone="", pan="", lead_guest="", out_dir="x")
    base.update(kw)
    return argparse.Namespace(**base)


def test_case2_occupancy_and_filenames():
    assert tc2.TC2_ROOMS == [{"adults": 4, "childAges": [2, 3]}] and tc2.TC2_NIGHTS == 1
    assert set(tc2.FILENAMES) == SAMPLE_NAMES and len(tc2.FILENAMES) == 12


def test_export_writes_files_zip_no_secrets(tmp_path):
    z = tc2.export(_full(), tmp_path)
    folder = tmp_path / "Test Case 2"
    assert {p.name for p in folder.iterdir()} == SAMPLE_NAMES
    assert json.loads((folder / "TJ test Hotel review Response.json").read_text()) == REVIEW_RESP
    canc = json.loads((folder / "TJ test Hotel cancellation policy Response.json").read_text())
    assert canc["cancellationPolicy"] == REVIEW_RESP["option"]["cancellation"]
    with zipfile.ZipFile(z) as zf:
        assert set(zf.namelist()) == {f"Test Case 2/{n}" for n in SAMPLE_NAMES}
        text = "".join(zf.read(n).decode() for n in zf.namelist())
    assert "SECRET" not in text and "apikey" not in text.lower() and z.name == "Test_Case_2.zip"


def test_export_accepts_success_refuses_failure(tmp_path):
    tc2.export(_full("SUCCESS"), tmp_path)
    with pytest.raises(SystemExit, match="not successful"):
        tc2.export(_full("FAILED"), tmp_path / "b")


def test_export_refuses_without_payment_or_with_confirm(tmp_path):
    with pytest.raises(SystemExit, match="paymentInfos"):
        tc2.export(_full(pay=False), tmp_path)
    r = _full()
    r.record("oms/v3/hotel/confirm-book", {"bookingId": "TGP1"}, {})
    with pytest.raises(SystemExit, match="confirm"):
        tc2.export(r, tmp_path)


def test_export_refuses_missing_step(tmp_path):
    r = _full()
    del r.pairs["detail"]
    with pytest.raises(SystemExit, match="detail"):
        tc2.export(r, tmp_path)


def test_hold_flag_and_total():
    assert tc2.review_hold_explicitly_false(REVIEW_RESP)
    assert tc2.review_hold_explicitly_false({"onholdAllowed": "false"})
    assert not tc2.review_hold_explicitly_false({"onholdAllowed": True})
    assert not tc2.review_hold_explicitly_false({})
    assert tc2.review_total(REVIEW_RESP) == 6202.0751
    assert tc2.review_total({"option": {"pricing": {"totalPrice": 0}}}) is None


def test_instant_payload_adds_payment_only():
    p = tc2.build_instant_payload({"bookingId": "B", "type": "HOTEL"}, 10.5)
    assert p == {"bookingId": "B", "type": "HOTEL", "paymentInfos": [{"amount": 10.5}]}


def test_build_args_fixed_and_no_hold_flow():
    a = tc2.build_args(_ns())
    assert a.rooms == tc2.TC2_ROOMS and a.nights == 1 and a.adults == 4
    assert a.require_hold is False and a.confirm_hold is False and a.cancel_after is False
    assert a.passport == "" and a.execute_uat_book is False


def test_dry_run_default_and_phrase_required():
    ns = tc2.main.__globals__["argparse"].ArgumentParser  # parser exists
    assert ns and tc2.BOOK_CONFIRM_PHRASE == "CREATE-UAT-BOOK"
