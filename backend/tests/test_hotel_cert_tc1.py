import argparse
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc1 as tc1

SAMPLE_NAMES = {
    "TJ test Hotel Hold Request.json", "TJ test Hotel Hold Response.json",
    "TJ test Hotel Search Request.json", "TJ test Hotel Search Response.json",
    "TJ test Hotel cancellation policy Request.json", "TJ test Hotel cancellation policy Response.json",
    "TJ test Hotel review Request.json", "TJ test Hotel review Response.json",
    "TJ test hotel booking detail Request.json", "TJ test hotel booking detail Response.json",
    "TJ test hotelDetail-search Request.json", "TJ test hotelDetail-search Response.json",
}
REVIEW_RESP = {"status": {"success": True}, "bookingId": "TGP1", "onholdAllowed": True,
               "option": {"optionId": "o1", "cancellation": {"isRefundable": True, "penalties": []}}}


def _full(status="ON_HOLD"):
    r = tc1.tc3.Recorder()
    r.record("hms/v3/hotel/listing", {"rooms": [{"adults": 1}], "apikey": "SECRET"}, {"hotels": [{"hotelId": "1"}]})
    r.record("hms/v3/hotel/pricing", {"hid": "1"}, {"options": []})
    r.record("hms/v3/hotel/review", {"hid": "1", "optionId": "o1", "reviewHash": "h"}, REVIEW_RESP)
    r.record("oms/v3/hotel/book", {"bookingId": "TGP1"}, {"bookingId": "TGP1", "status": {"success": True}})
    r.record("oms/v3/hotel/booking-details", {"bookingId": "TGP1"}, {"order": {"status": status}})
    return r


def _ns(**kw):
    base = dict(destination="Mumbai", days_ahead=30, hotel_id="", max_hold_candidates=5, execute_uat_hold=False,
                confirm="", contact_email="", contact_phone="", pan="", passport="", lead_guest="")
    base.update(kw)
    return argparse.Namespace(**base)


def test_case1_occupancy_and_filenames():
    assert tc1.TC1_ROOMS == [{"adults": 1, "childAges": []}] and tc1.TC1_NIGHTS == 1
    assert set(tc1.FILENAMES) == SAMPLE_NAMES and len(tc1.FILENAMES) == 12


def test_export_writes_12_files_zip_no_secrets(tmp_path):
    z = tc1.export(_full(), tmp_path)
    folder = tmp_path / "Test Case 1"
    assert {p.name for p in folder.iterdir()} == SAMPLE_NAMES
    assert json.loads((folder / "TJ test Hotel review Response.json").read_text()) == REVIEW_RESP
    with zipfile.ZipFile(z) as zf:
        assert {n for n in zf.namelist()} == {f"Test Case 1/{n}" for n in SAMPLE_NAMES}
        text = "".join(zf.read(n).decode() for n in zf.namelist())
    assert "SECRET" not in text and "apikey" not in text.lower()
    assert z.name == "Test_Case_1.zip"


def test_export_refused_unless_on_hold(tmp_path):
    with pytest.raises(SystemExit, match="ON_HOLD"):
        tc1.export(_full("FAILED"), tmp_path)
    assert not (tmp_path / "Test Case 1").exists()


def test_export_refused_when_confirm_called(tmp_path):
    r = _full()
    r.record("oms/v3/hotel/confirm-book", {"bookingId": "TGP1"}, {"status": {"success": True}})
    with pytest.raises(SystemExit, match="confirm"):
        tc1.export(r, tmp_path)


def test_export_refused_when_step_missing(tmp_path):
    r = _full()
    del r.pairs["hold"]
    with pytest.raises(SystemExit, match="hold"):
        tc1.export(r, tmp_path)


def test_build_args_hold_only_and_gates_kept():
    a = tc1.build_args(_ns())
    assert a.rooms == tc1.TC1_ROOMS and a.nights == 1 and a.adults == 1
    assert a.require_hold is True and a.confirm_hold is False and a.cancel_after is False
    a = tc1.build_args(_ns(execute_uat_hold=True, confirm="CREATE-UAT-HOLD"))
    assert a.confirm_hold is False  # Case 1 never confirms


@pytest.mark.asyncio
async def test_dry_run_exports_nothing(monkeypatch, tmp_path):
    async def fake_run_book(args):
        assert args.execute_uat_hold is False
    monkeypatch.setattr(tc1.uat, "run_book", fake_run_book)
    hf = tmp_path / "s.json"
    hf.write_text(json.dumps({"hids": [1, 2]}))
    assert await tc1.run(_ns(out_dir=str(tmp_path), hids_file=str(hf))) is None
    assert not (tmp_path / "Test Case 1").exists()


def test_sample_hids_loaded_complete_and_listing_exact(tmp_path):
    hf = tmp_path / "req.json"
    hf.write_text(json.dumps({"checkIn": "2026-06-10", "checkOut": "2026-06-11", "currency": "INR",
                              "nationality": "106", "hids": [3, "1", 2]}))
    hids = tc1.load_sample_hids(str(hf))
    assert hids == ["3", "1", "2"]
    p = tc1.build_listing_payload(hids)
    assert p["checkIn"] == "2026-06-10" and p["checkOut"] == "2026-06-11"
    assert p["currency"] == "INR" and p["nationality"] == "106" and p["rooms"] == [{"adults": 1}]
    assert p["hids"] == [3, 1, 2] and p["timeoutMs"] == 30000


def test_sample_hids_required_and_mismatch_refused(tmp_path):
    with pytest.raises(SystemExit):
        tc1.load_sample_hids("")
    hf = tmp_path / "bad.json"
    hf.write_text(json.dumps({"checkIn": "2026-07-01", "hids": [1]}))
    with pytest.raises(SystemExit, match="checkIn"):
        tc1.load_sample_hids(str(hf))


@pytest.mark.asyncio
async def test_session_comes_from_exact_listing(monkeypatch):
    sent = {}

    async def fake_post(config, payload, path):
        sent["p"], sent["path"] = payload, path
        return 200, {"correlationId": "c1", "hotels": [{"hotelId": "2", "name": "H", "options": []}]}, 0.1
    monkeypatch.setattr(tc1.uat, "_config", lambda: (None, None))
    monkeypatch.setattr(tc1.uat, "_raw_post", fake_post)
    s = await tc1.make_session_via_listing(["1", "2"])(None, None)
    assert sent["path"] == tc1.uat.HOTEL_LISTING_PATH and sent["p"]["hids"] == [1, 2]
    assert list(s.results) == ["2"] and s.check_in == "2026-06-10" and s.rooms[0].adults == 1


@pytest.mark.asyncio
async def test_run_restores_shared_search(monkeypatch, tmp_path):
    orig = tc1.uat._session_via_search

    async def fake_run_book(args):
        assert tc1.uat._session_via_search is not orig
    monkeypatch.setattr(tc1.uat, "run_book", fake_run_book)
    hf = tmp_path / "s.json"
    hf.write_text(json.dumps([1]))
    await tc1.run(_ns(out_dir=str(tmp_path), hids_file=str(hf)))
    assert tc1.uat._session_via_search is orig
