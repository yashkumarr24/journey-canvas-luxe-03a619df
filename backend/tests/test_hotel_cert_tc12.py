import argparse
import asyncio
import json
import zipfile

import pytest

from app.diagnostics import hotel_cert_tc4 as tc4
from app.diagnostics import hotel_cert_tc12 as tc12
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
PASS, EXP, DOB = "U4783884", "2032-12-31", "1990-01-15"


def _review(refundable=True, passport=True, pan=False, hold=True):
    return {"status": {"success": True}, "bookingId": "TGP6", "onholdAllowed": hold,
            "option": {"optionId": "o1", "pricing": {"totalPrice": 15704.1615},
                       "compliance": {"gstType": "NA", "panRequired": pan, "passportRequired": passport},
                       "cancellation": POLICY if refundable else {"isRefundable": False}}}


def _ns(**kw):
    base = dict(destination="Dubai", days_ahead=30, hotel_id="", execute_uat_book=False, confirm="",
                max_instant_candidates=30, cancel_poll_attempts=36, contact_email="", contact_phone="",
                passport=PASS, passport_expiry=EXP, dob=DOB, lead_guest="", out_dir="x")
    base.update(kw)
    return argparse.Namespace(**base)


class _Result:
    rate = 1


class _Session:
    provider_search_id = "corr"
    check_in, check_out = "2026-07-30", "2026-07-31"
    currency = "INR"
    results = {"h1": _Result()}


def _patch(monkeypatch, calls, statuses, reviews=None, pricing=None):
    monkeypatch.setattr(uat, "_config", lambda: (object(), object()))
    monkeypatch.setattr(uat, "_booker_base", lambda: BASE)

    async def via_search(args, settings):
        await uat._raw_post(None, {"rooms": [], "nationality": "231"}, uat.HOTEL_LISTING_PATH)
        return _Session()
    monkeypatch.setattr(tc12, "_session_via_search", via_search)
    monkeypatch.setattr(uat, "_rooms_from_session", lambda s: tc12.TC12_ROOMS)

    async def raw_post(config, payload, path=uat.HOTEL_LISTING_PATH):
        if path == uat.HOTEL_PRICING_PATH:
            if pricing is not None:
                pricing.append(payload)
            return 200, {"reviewHash": "rh", "options": []}, 0.1
        if reviews is not None:
            return 200, reviews.pop(0) if len(reviews) > 1 else reviews[0], 0.1
        return 200, _review(), 0.1
    monkeypatch.setattr(uat, "_raw_post", raw_post)
    monkeypatch.setattr(uat, "_detail_candidates", lambda d, o: [{"optionId": "o1"}])

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


REAL = dict(execute_uat_book=True, confirm="CREATE-UAT-BOOK",
            contact_email="ops@flynfeel.in", contact_phone="9000000000")


def test_constants():
    assert tc12.TC12_ROOMS == [{"adults": 2, "childAges": [7]}] and tc12.TC12_NIGHTS == 1
    assert tc12.NATIONALITY == "231"
    assert set(tc12.FILENAMES) == SAMPLE_NAMES and len(tc12.FILENAMES) == 15


def test_dry_run_never_books(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"])
    assert asyncio.run(tc12.run(_ns())) is None
    assert calls == []


def test_detail_uses_nationality_231(monkeypatch):
    pricing = []
    _patch(monkeypatch, [], ["SUCCESS"], pricing=pricing)
    asyncio.run(tc12.run(_ns()))
    assert pricing and pricing[0]["nationality"] == "231"


def test_real_flow_matches_sample_layout(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLATION_PENDING", "CANCELLED"])
    z = asyncio.run(tc12.run(_ns(out_dir=str(tmp_path), lead_guest="Fresh Name", **REAL)))
    folder = tmp_path / "Test Case 12"
    assert {p.name for p in folder.iterdir()} == SAMPLE_NAMES
    book = json.loads((folder / "TJ test Hotel Book Request.json").read_text())
    ts = book["roomTravellerInfo"][0]["travellerInfo"]
    assert [t["pt"] for t in ts] == ["ADULT", "ADULT", "CHILD"]
    for a in ts[:2]:
        assert (a["pNum"], a["pDoE"], a["dob"], a["nationality"]) == (PASS, EXP, DOB, "231")
        assert "pan" not in a
    assert ts[2]["age"] == 7 and not {"pan", "pNum", "pDoE", "dob", "nationality"} & set(ts[2])
    assert (ts[0]["fN"], ts[0]["lN"]) == ("Fresh", "Name") and ts[0]["isLeadGuest"] is True
    assert book["paymentInfos"] == [{"amount": 15704.1615}]
    cancels = [(p, b) for p, b in calls if tc4.is_cancel_path(p)]
    assert cancels == [(f"{uat.HOTEL_CANCEL_BOOKING_PATH}/TGP6", None)]
    assert (folder / "TJ Test Hotel Cancel Request.json").read_text() == f"{BASE}/oms/v3/hotel/cancel-booking/TGP6"
    pol = json.loads((folder / "TJ test Hotel cancellation policy Request.json").read_text())
    assert (pol["hid"], pol["optionId"], pol["reviewHash"]) == ("h1", "o1", "rh")
    after = json.loads((folder / "TJ test hotel detail after cancel Response.json").read_text())
    assert after["order"]["status"] == "CANCELLED"
    with zipfile.ZipFile(z) as zf:
        assert set(zf.namelist()) == {f"Test Case 12/{n}" for n in SAMPLE_NAMES}
    assert z.name == "Test_Case_12.zip"


@pytest.mark.parametrize("reviews", [
    [{"status": {"success": False}}],
    [_review(refundable=False)],
    [_review(passport=False)],
    [_review(pan=True)],
])
def test_unsuitable_reviews_never_book(monkeypatch, reviews):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"], reviews=reviews)
    with pytest.raises(SystemExit, match="NO SUITABLE OPTION"):
        asyncio.run(tc12.run(_ns(**REAL)))
    assert calls == []


def test_skips_to_suitable_option(monkeypatch, tmp_path):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS", "CANCELLED"], reviews=[_review(passport=False), _review()])
    assert asyncio.run(tc12.run(_ns(out_dir=str(tmp_path), **REAL))).name == "Test_Case_12.zip"


def test_passport_string_true_accepted():
    r = _review()
    r["option"]["compliance"]["passportRequired"] = "true"
    assert tc12.review_requires_passport_not_pan(r)


@pytest.mark.parametrize("kw", [dict(passport=""), dict(passport="ab"), dict(passport_expiry="2026-01-01"),
                                dict(passport_expiry="31-12-2032"), dict(dob=""), dict(dob="2020-01-01")])
def test_bad_passport_details_refuse_book(monkeypatch, kw):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"])
    with pytest.raises(SystemExit, match="pre-flight"):
        asyncio.run(tc12.run(_ns(**{**REAL, **kw})))
    assert calls == []


def test_requires_confirm_phrase(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["SUCCESS"])
    with pytest.raises(SystemExit, match="CREATE-UAT-BOOK"):
        asyncio.run(tc12.run(_ns(**{**REAL, "confirm": "yes"})))
    assert calls == []


def test_no_cancel_unless_success(monkeypatch):
    calls = []
    _patch(monkeypatch, calls, ["FAILED"])
    with pytest.raises(SystemExit, match="Cancel NOT called"):
        asyncio.run(tc12.run(_ns(**REAL)))
    assert not any(tc4.is_cancel_path(p) for p, _ in calls)


def test_never_cancelled_no_export(monkeypatch, tmp_path):
    _patch(monkeypatch, [], ["SUCCESS", "CANCELLATION_PENDING"])
    with pytest.raises(SystemExit, match="not CANCELLED"):
        asyncio.run(tc12.run(_ns(out_dir=str(tmp_path), cancel_poll_attempts=3, **REAL)))
    assert not (tmp_path / "Test_Case_12.zip").exists()


def test_logs_hide_secrets(monkeypatch, tmp_path, capsys):
    _patch(monkeypatch, [], ["SUCCESS", "CANCELLED"])
    asyncio.run(tc12.run(_ns(out_dir=str(tmp_path), lead_guest="Fresh Name", **REAL)))
    out = capsys.readouterr().out
    for secret in (PASS, EXP, DOB, "ops@flynfeel.in", "9000000000", "Fresh Name", '"rh"', "TGP6"):
        assert secret not in out
