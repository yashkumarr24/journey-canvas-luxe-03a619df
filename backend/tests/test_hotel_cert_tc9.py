import argparse
import asyncio
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc9 as tc9
from app.diagnostics import hotel_listing_uat as uat

SAMPLE_JSON = {
    "TJ test Hotel Search Request.json", "TJ test Hotel Search Response.json",
    "TJ test hotelDetail-search Request.json", "TJ test hotelDetail-search Response.json",
    "TJ test Hotel review Request.json", "TJ test Hotel review Response.json",
    "TJ test Hotel cancellation policy Response.json",
}
POLICY = {"isRefundable": True, "penalties": [{"from": "a", "to": "b", "amount": 0.0}]}
REVIEW = {"status": {"success": True}, "bookingId": "TGP9",
          "option": {"optionId": "o1", "cancellation": POLICY}}


def _ns(**kw):
    base = dict(destination="Mumbai", days_ahead=30, hotel_id="", max_candidates=30, export=False, out_dir="x")
    base.update(kw)
    return argparse.Namespace(**base)


def _rec(review=REVIEW):
    r = tc9.Recorder()
    r.record("hms/v3/hotel/listing", {"rooms": [], "apikey": "SECRET"}, {"hotels": []})
    r.record("hms/v3/hotel/pricing", {"hid": "1"}, {"options": []})
    r.record("hms/v3/hotel/review", {"hid": "1", "optionId": "o1", "reviewHash": "h"}, review)
    return r


def test_occupancy_and_filenames():
    assert tc9.TC9_ROOMS == [{"adults": 1, "childAges": []}] and tc9.TC9_NIGHTS == 1
    assert set(tc9.JSON_FILENAMES) == SAMPLE_JSON and len(tc9.FILENAMES) == 8


def test_export_matches_sample(tmp_path):
    z = tc9.export(_rec(), tmp_path)
    folder = tmp_path / "Test Case 9"
    assert {p.name for p in folder.iterdir()} == SAMPLE_JSON | {tc9.README_NAME}
    cp = json.loads((folder / "TJ test Hotel cancellation policy Response.json").read_text())
    assert cp == {"hid": "1", "optionId": "o1", "cancellationPolicy": POLICY}
    with zipfile.ZipFile(z) as zf:
        assert len(zf.namelist()) == 8
        text = "".join(zf.read(n).decode() for n in zf.namelist())
    assert "SECRET" not in text and "refundable      = True" in text


def test_refuses_booking_steps(tmp_path):
    r = _rec()
    r.pairs["hold"] = ({}, {})
    with pytest.raises(SystemExit, match="must not include"):
        tc9.export(r, tmp_path)


def test_refuses_failed_review(tmp_path):
    with pytest.raises(SystemExit, match="Review did not succeed"):
        tc9.export(_rec({"status": {"success": False}}), tmp_path)


def test_refuses_missing_policy(tmp_path):
    with pytest.raises(SystemExit, match="no cancellation policy"):
        tc9.export(_rec({"status": {"success": True}, "option": {"optionId": "o1"}}), tmp_path)


class _Session:
    provider_search_id = "corr"
    check_in, check_out = "2026-06-25", "2026-06-26"
    currency = "INR"
    results = {"h1": type("R", (), {"rate": 1})()}


def _patch(monkeypatch, booker_calls):
    monkeypatch.setattr(uat, "_config", lambda: (object(), object()))

    async def via_search(args, settings):
        assert args.rooms == tc9.TC9_ROOMS
        await uat._raw_post(None, {"rooms": []}, uat.HOTEL_LISTING_PATH)
        return _Session()
    monkeypatch.setattr(uat, "_session_via_search", via_search)
    monkeypatch.setattr(uat, "_rooms_from_session", lambda s: tc9.TC9_ROOMS)

    async def raw_post(config, payload, path=uat.HOTEL_LISTING_PATH):
        if path == uat.HOTEL_PRICING_PATH:
            return 200, {"reviewHash": "h", "options": []}, 0.1
        return 200, REVIEW, 0.1
    monkeypatch.setattr(uat, "_raw_post", raw_post)
    monkeypatch.setattr(uat, "_detail_candidates", lambda d, o: [{"optionId": "o1"}])

    async def booker_post(config, path, payload):
        booker_calls.append(path)
        return 200, {}, 0.1
    monkeypatch.setattr(uat, "_booker_post", booker_post)


def test_dry_run_no_export_no_booking(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls)
    assert asyncio.run(tc9.run(_ns(out_dir=str(tmp_path)))) is None
    assert calls == [] and not (tmp_path / "Test Case 9").exists()


def test_export_flow_never_books(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls)
    z = asyncio.run(tc9.run(_ns(export=True, out_dir=str(tmp_path))))
    assert calls == [] and z.name == "Test_Case_9.zip"
    with zipfile.ZipFile(z) as zf:
        assert {n.split("/", 1)[1] for n in zf.namelist()} == SAMPLE_JSON | {tc9.README_NAME}
