import argparse
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc3 as tc3

SAMPLE_NAMES = {
    "TJ test Hotel Confirm Hold Booking Request.json", "TJ test Hotel Confirm Hold Booking Response.json",
    "TJ test Hotel Hold Request.json", "TJ test Hotel Hold Response.json",
    "TJ test Hotel Search Request.json", "TJ test Hotel Search Response.json",
    "TJ test Hotel cancellation policy Request.json", "TJ test Hotel cancellation policy Response.json",
    "TJ test Hotel review Request.json", "TJ test Hotel review Response.json",
    "TJ test hotel booking detail Request.json", "TJ test hotel booking detail Response.json",
    "TJ test hotelDetail-search Request.json", "TJ test hotelDetail-search Response.json",
}
REVIEW_RESP = {"status": {"success": True}, "bookingId": "TGP1", "onholdAllowed": True,
               "option": {"optionId": "o1", "cancellation": {"isRefundable": True, "penalties": [{"amount": 0.0}]}}}


def _full(status="SUCCESS"):
    r = tc3.Recorder()
    r.record("/hms/v3/hotel/listing", {"rooms": [], "apikey": "SECRET"}, {"hotels": [{"hotelId": "1"}]})
    r.record("hms/v3/hotel/listing", {"page": 2}, {"hotels": []})  # later page ignored
    r.record("hms/v3/hotel/pricing", {"hid": "1"}, {"options": [], "reviewHash": "h"})
    r.record("hms/v3/hotel/review", {"hid": "1", "optionId": "o1", "reviewHash": "h"}, REVIEW_RESP)
    r.record("oms/v3/hotel/book", {"bookingId": "TGP1", "roomTravellerInfo": []}, {"bookingId": "TGP1"})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP1"}, {"order": {"status": "ON_HOLD"}})
    r.record("oms/v3/hotel/confirm-book", {"bookingId": "TGP1", "paymentInfos": [{"amount": 10.0}]},
             {"status": {"success": True}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP1"}, {"order": {"status": status}})
    return r


def test_tc3_rooms_exact():
    assert tc3.TC3_ROOMS == [{"adults": 2, "childAges": [2, 3]}, {"adults": 3, "childAges": [2]},
                             {"adults": 2, "childAges": [2]}]


def test_filenames_match_sample():
    assert set(tc3.FILENAMES) == SAMPLE_NAMES and len(tc3.FILENAMES) == 14


def test_export_writes_14_files_and_zip(tmp_path):
    z = tc3.export(_full(), tmp_path)
    folder = tmp_path / "Test Case 3"
    assert {p.name for p in folder.iterdir()} == SAMPLE_NAMES
    with zipfile.ZipFile(z) as zf:
        assert {n.split("/", 1)[1] for n in zf.namelist()} == SAMPLE_NAMES
        assert all(n.startswith("Test Case 3/") for n in zf.namelist())
    # Response structure preserved exactly.
    assert json.loads((folder / "TJ test Hotel review Response.json").read_text()) == REVIEW_RESP
    # First listing page kept, final booking detail kept.
    assert json.loads((folder / "TJ test Hotel Search Response.json").read_text()) == {"hotels": [{"hotelId": "1"}]}
    assert json.loads((folder / "TJ test hotel booking detail Response.json").read_text())["order"]["status"] == "SUCCESS"


def test_no_secrets_in_files(tmp_path):
    z = tc3.export(_full(), tmp_path)
    with zipfile.ZipFile(z) as zf:
        text = "".join(zf.read(n).decode() for n in zf.namelist())
    assert "SECRET" not in text and "apikey" not in text.lower()


def test_cancellation_derived_from_review(tmp_path):
    tc3.export(_full(), tmp_path)
    folder = tmp_path / "Test Case 3"
    req = json.loads((folder / "TJ test Hotel cancellation policy Request.json").read_text())
    resp = json.loads((folder / "TJ test Hotel cancellation policy Response.json").read_text())
    assert req == {"hid": "1", "optionId": "o1", "reviewHash": "h", "_note": tc3.CANCELLATION_NOTE}
    assert resp["cancellationPolicy"] == REVIEW_RESP["option"]["cancellation"]


def test_export_refused_when_not_confirmed(tmp_path):
    with pytest.raises(SystemExit, match="not CONFIRMED"):
        tc3.export(_full("ON_HOLD"), tmp_path)
    assert not (tmp_path / "Test Case 3").exists()


def test_export_refused_when_step_missing(tmp_path):
    r = _full()
    del r.pairs["hold"]
    with pytest.raises(SystemExit, match="hold"):
        tc3.export(r, tmp_path)


def test_unknown_paths_ignored():
    r = tc3.Recorder()
    r.record("oms/v3/hotel/cancel-booking/X", None, {})
    assert r.pairs == {}


def test_build_args_keeps_safety_gates():
    ns = argparse.Namespace(destination="Mumbai", days_ahead=30, nights=1, hotel_id="", max_hold_candidates=5,
                            execute_uat_hold=False, confirm="", contact_email="", contact_phone="", pan="",
                            passport="", lead_guest="")
    a = tc3.build_args(ns)
    assert a.rooms == tc3.TC3_ROOMS and a.require_hold is True
    assert a.confirm_hold is False and a.cancel_after is False  # dry run never confirms
    ns.execute_uat_hold, ns.confirm = True, "WRONG"
    a = tc3.build_args(ns)
    with pytest.raises(SystemExit):  # existing confirm-phrase gate still applies
        tc3.uat.check_confirm_hold_args(a)


@pytest.mark.asyncio
async def test_capture_wraps_and_restores(monkeypatch):
    calls = []

    async def fake_booker(config, path, payload):
        calls.append(path)
        return 200, {"bookingId": "TGP1"}, 0.1

    monkeypatch.setattr(tc3.uat, "_booker_post", fake_booker)
    r = tc3.Recorder()
    undo = tc3.install_capture(r)
    await tc3.uat._booker_post(None, "oms/v3/hotel/book", {"bookingId": "TGP1"})
    undo()
    assert tc3.uat._booker_post is fake_booker
    assert r.pairs["hold"] == ({"bookingId": "TGP1"}, {"bookingId": "TGP1"})
