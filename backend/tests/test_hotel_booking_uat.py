"""Mocked tests for the hotel Book UAT diagnostic. No real calls, no bookings."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.diagnostics import hotel_listing_uat as diag
from tests.test_hotel_review_uat import DETAIL_REPLY, HID, REVIEW_REPLY, _session

SECRETS = ("KEY-SECRET", "TGS-SECRET-BOOKING", "ops@secret.test", "9876500000", "ABCPE1234F",
           "hash-secret", "listing-corr", "Secret Hotel Name", "HCN-SECRET", "Uat", "Diagnostic")

DETAILS_REPLY = {
    "order": {"bookingId": "TGS-SECRET-BOOKING", "amount": 2136.07, "markup": 0,
              "deliveryInfo": {"emails": ["ops@secret.test"]}, "status": "ON_HOLD", "createdOn": "x"},
    "itemInfos": {"HOTEL": {"hInfo": {"name": "Secret Hotel Name", "ops": [
        {"tp": 2136.07, "ddt": "2026-10-20", "ipr": False, "ipm": False,
         "cnp": {"ifra": True, "pd": [{"am": 0}, {"am": 2000}]}}]}}},
    "hotelConfirmationNumber": "HCN-SECRET",
    "status": {"success": True, "httpStatus": 200},
}


def test_hold_payload_documented_shape_never_has_payment():
    p = diag.build_uat_book_payload(booking_id="B1", rooms=[{"adults": 2, "childAges": [5]}, {"adults": 1}],
                                    email="e@x", phone="1")
    assert set(p) == {"bookingId", "roomTravellerInfo", "deliveryInfo", "type"}
    assert p["type"] == "HOTEL" and "paymentInfos" not in p
    rooms = p["roomTravellerInfo"]
    assert [len(r["travellerInfo"]) for r in rooms] == [3, 1]
    assert [t["pt"] for t in rooms[0]["travellerInfo"]] == ["ADULT", "ADULT", "CHILD"]
    assert rooms[0]["travellerInfo"][2]["ti"] == "Master"
    leads = [r["travellerInfo"][0]["fN"] for r in rooms]
    assert len(set(leads)) == len(leads)  # lead pax unique across rooms
    assert p["deliveryInfo"] == {"emails": ["e@x"], "contacts": ["1"], "code": ["+91"]}
    assert all("pan" not in t for r in rooms for t in r["travellerInfo"])


def test_pan_passport_gst_only_when_given():
    p = diag.build_uat_book_payload(booking_id="B", rooms=[{"adults": 1}], email="e", phone="1",
                                    pan="P", passport="N", gst_info={"gstNumber": "g", "registeredName": "r"})
    t = p["roomTravellerInfo"][0]["travellerInfo"][0]
    assert t["pan"] == "P" and t["pNum"] == "N" and p["gstInfo"]["gstNumber"] == "g"
    with pytest.raises(ValueError):
        diag.build_uat_book_payload(booking_id="", rooms=[], email="e", phone="1")


def test_per_traveller_pans():
    rooms = [{"adults": 2, "childAges": [5]}, {"adults": 1}]
    pans = ["AAAAA0001A", "BBBBB0002B", "CCCCC0003C", "DDDDD0004D"]
    p = diag.build_uat_book_payload(booking_id="B", rooms=rooms, email="ops@flyfeel.in", phone="9876543210", pans=pans)
    got = [t["pan"] for r in p["roomTravellerInfo"] for t in r["travellerInfo"]]
    assert got == pans  # one PAN per traveller, search room/guest order
    assert len(set(got)) == 4
    # count mismatch is rejected before anything is sent
    with pytest.raises(ValueError, match="pans_count_mismatch"):
        diag.build_uat_book_payload(booking_id="B", rooms=rooms, email="e", phone="1", pans=pans[:3])
    # single pan still applies to every traveller
    p2 = diag.build_uat_book_payload(booking_id="B", rooms=rooms, email="e", phone="1", pan="AAAAA0001A")
    assert all(t["pan"] == "AAAAA0001A" for r in p2["roomTravellerInfo"] for t in r["travellerInfo"])
    # per-traveller pans pass pre-flight validation when Review requires PAN
    fails = diag.validate_book_payload(p, rooms, pan_required=True)
    assert not fails


def test_requirements_from_review():
    r = diag.book_requirements(REVIEW_REPLY)
    assert r["booking_id_present"] is True and r["pan_required"] is False
    assert r["gst_info_needed"] is False and r["onhold_allowed"] is True
    assert r["hold_deadline_present"] is True and r["review_total_price"] == 2136.07
    reseller = json.loads(json.dumps(REVIEW_REPLY))
    reseller["option"]["compliance"]["gstType"] = "RESELLER"
    assert diag.book_requirements(reseller)["gst_info_needed"] is True
    assert "TGS-SECRET-BOOKING" not in json.dumps(r)


def test_summaries_are_safe():
    b = diag.book_summary({"bookingId": "TGS-SECRET-BOOKING", "status": {"success": True}, "metaInfo": {}})
    assert b["booking_id_present"] is True and b["status_success"] is True
    d = diag.booking_details_summary(DETAILS_REPLY)
    assert d["order_status"] == "ON_HOLD" and d["order_amount"] == 2136.07
    assert d["option_refundable"] is True and d["option_penalties_count"] == 2
    text = json.dumps([b, d])
    for secret in SECRETS:
        assert secret not in text
    e = diag.book_summary({"status": {"success": False}, "error": {"code": "X", "message": "m", "requestId": "r"}})
    assert e["errors"] == [{"code": "X", "message": "m"}]


def test_booker_host_must_be_uat(monkeypatch):
    monkeypatch.setenv("TRIPJACK_HOTEL_BOOKER_URL", "https://hotel-booker.tripjack.com")
    with pytest.raises(SystemExit):
        diag._booker_base()
    monkeypatch.delenv("TRIPJACK_HOTEL_BOOKER_URL")
    assert diag._booker_base() == diag.UAT_BOOKER_BASE_URL


def _args(**kw):
    base = dict(search_id="tok", hotel_id="", option_id="", destination="Goa", days_ahead=30, nights=1,
                adults=2, execute_uat_hold=False, confirm="", contact_email="", contact_phone="",
                pan="", passport="", poll_attempts=2, cancel_after=False)
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.fixture
def wired(monkeypatch):
    calls: list = []
    booker: list = []

    async def fake_post(config, payload, path=diag.HOTEL_LISTING_PATH):
        calls.append(path)
        return 200, {diag.HOTEL_PRICING_PATH: DETAIL_REPLY, diag.HOTEL_REVIEW_PATH: REVIEW_REPLY}[path], 0.1

    async def fake_booker(config, path, payload):
        booker.append((path, payload))
        if path == diag.HOTEL_BOOK_PATH:
            return 200, {"bookingId": "TGS-SECRET-BOOKING", "status": {"success": True}, "metaInfo": {}}, 0.1
        if path.startswith(diag.HOTEL_CANCEL_BOOKING_PATH):
            return 200, {"status": {"success": True}}, 0.1
        return 200, DETAILS_REPLY, 0.1

    async def fake_get(*, settings, search_id):
        return _session()

    async def no_sleep(_):
        return None

    from app.services import hotel_sessions

    monkeypatch.setattr(diag, "_config", lambda: (object(), SimpleNamespace(api_key="KEY-SECRET")))
    monkeypatch.setattr(diag, "_raw_post", fake_post)
    monkeypatch.setattr(diag, "_booker_post", fake_booker)
    monkeypatch.setattr(diag.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(hotel_sessions, "get_search_session", fake_get)
    return calls, booker


def test_dry_run_never_calls_book(wired, capsys):
    calls, booker = wired
    asyncio.run(diag.run_book(_args()))
    assert calls == [diag.HOTEL_PRICING_PATH, diag.HOTEL_REVIEW_PATH]
    assert booker == []
    out = capsys.readouterr().out
    assert "DRY RUN" in out and "paymentInfos included: False" in out
    for secret in SECRETS:
        assert secret not in out


@pytest.mark.parametrize("kw", [
    dict(execute_uat_hold=True, confirm="yes", contact_email="ops@secret.test", contact_phone="9876500000"),
    dict(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE),
])
def test_execute_requires_phrase_and_contact(wired, kw):
    _, booker = wired
    with pytest.raises(SystemExit):
        asyncio.run(diag.run_book(_args(**kw)))
    assert booker == []


def test_execute_hold_polls_and_cancels_safely(wired, capsys):
    _, booker = wired
    asyncio.run(diag.run_book(_args(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE,
                                    contact_email="ops@secret.test", contact_phone="9876500000",
                                    cancel_after=True)))
    paths = [b[0] for b in booker]
    assert paths[0] == diag.HOTEL_BOOK_PATH and "paymentInfos" not in booker[0][1]
    assert booker[0][1]["bookingId"] == "TGS-SECRET-BOOKING"  # Review bookingId drives Book
    assert paths[1] == diag.HOTEL_BOOKING_DETAILS_PATH  # stops at terminal ON_HOLD
    assert paths[2].startswith(diag.HOTEL_CANCEL_BOOKING_PATH)
    out = capsys.readouterr().out
    assert "order_status=ON_HOLD" in out
    for secret in SECRETS:
        assert secret not in out


def test_pan_required_blocks_execute_without_pan(wired, monkeypatch):
    rev = json.loads(json.dumps(REVIEW_REPLY))
    rev["option"]["compliance"]["panRequired"] = True

    async def fake_post(config, payload, path=diag.HOTEL_LISTING_PATH):
        return 200, {diag.HOTEL_PRICING_PATH: DETAIL_REPLY, diag.HOTEL_REVIEW_PATH: rev}[path], 0.1

    monkeypatch.setattr(diag, "_raw_post", fake_post)
    with pytest.raises(SystemExit, match="PAN"):
        asyncio.run(diag.run_book(_args(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE,
                                        contact_email="ops@secret.test", contact_phone="9876500000")))


def test_failed_review_stops_before_book(wired, monkeypatch):
    _, booker = wired

    async def fake_post(config, payload, path=diag.HOTEL_LISTING_PATH):
        if path == diag.HOTEL_PRICING_PATH:
            return 200, DETAIL_REPLY, 0.1
        return 409, {"status": {"success": False}, "error": {"code": "OPTION_SOLD_OUT"}}, 0.1

    monkeypatch.setattr(diag, "_raw_post", fake_post)
    with pytest.raises(SystemExit, match="Review failed"):
        asyncio.run(diag.run_book(_args()))
    assert booker == []


def _valid():
    rooms = [{"adults": 2, "childAges": [5]}, {"adults": 1}]
    return diag.build_uat_book_payload(booking_id="B1", rooms=rooms, email="ops@secret.test",
                                       phone="9876500000"), rooms


def test_preflight_ok_for_valid_payload():
    p, rooms = _valid()
    assert diag.validate_book_payload(p, rooms) == []


@pytest.mark.parametrize("mutate,expect", [
    (lambda p: p.update(bookingId=""), "bookingId"),
    (lambda p: p.update(type="FLIGHT"), "type"),
    (lambda p: p.update(paymentInfos=[{"amount": 1}]), "paymentInfos"),
    (lambda p: p["deliveryInfo"].update(emails=["not-an-email"]), "deliveryInfo.emails"),
    (lambda p: p["deliveryInfo"].update(emails=["uat@example.invalid"]), "placeholder"),
    (lambda p: p["deliveryInfo"].update(contacts=["+919876500000"]), "deliveryInfo.contacts"),
    (lambda p: p["deliveryInfo"].update(contacts=["12345"]), "10 digits"),
    (lambda p: p["deliveryInfo"].update(code=["91"]), "deliveryInfo.code"),
    (lambda p: p.pop("deliveryInfo"), "deliveryInfo: missing"),
    (lambda p: p["roomTravellerInfo"].pop(), "room count"),
    (lambda p: p["roomTravellerInfo"][0]["travellerInfo"].pop(), "counts differ"),
    (lambda p: p["roomTravellerInfo"][0]["travellerInfo"][0].update(fN="A1"), ".fN"),
    (lambda p: p["roomTravellerInfo"][0]["travellerInfo"][2].update(ti="Mr"), ".ti"),
    (lambda p: p["roomTravellerInfo"][0]["travellerInfo"][0].update(pan="bad"), ".pan"),
    (lambda p: p["roomTravellerInfo"][1]["travellerInfo"][0].update(
        fN=p["roomTravellerInfo"][0]["travellerInfo"][0]["fN"]), "unique"),
])
def test_preflight_reports_each_failure_without_values(mutate, expect):
    p, rooms = _valid()
    mutate(p)
    fails = diag.validate_book_payload(p, rooms)
    assert any(expect in f for f in fails), fails
    text = json.dumps(fails)
    for secret in ("ops@secret.test", "9876500000", "+919876500000", "not-an-email", "B1"):
        assert secret not in text


def test_preflight_pan_and_passport_required():
    p, rooms = _valid()
    fails = diag.validate_book_payload(p, rooms, pan_required=True, passport_required=True)
    assert any(".pan: required" in f for f in fails) and any(".pNum: required" in f for f in fails)


def test_book_created_rules():
    ok = {"bookingId": "X", "status": {"success": True}}
    assert diag.book_created(200, ok) is True
    assert diag.book_created(400, ok) is False
    assert diag.book_created(200, {"bookingId": "X", "status": {"success": False}}) is False
    assert diag.book_created(200, {"status": {"success": True}}) is False
    assert diag.book_created(200, None) is False


@pytest.mark.parametrize("status,body", [
    (400, {"status": {"success": False}, "errors": [{"errCode": "810", "message": "invalid/bad data"}]}),
    (200, {"status": {"success": False}, "errors": [{"errCode": "810"}]}),
    (200, {"status": {"success": True}}),
])
def test_failed_book_never_polls_or_cancels(wired, monkeypatch, capsys, status, body):
    _, booker = wired

    async def fake_booker(config, path, payload):
        booker.append((path, payload))
        return status, body, 0.1

    monkeypatch.setattr(diag, "_booker_post", fake_booker)
    with pytest.raises(SystemExit, match="rejected"):
        asyncio.run(diag.run_book(_args(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE,
                                        contact_email="ops@secret.test", contact_phone="9876500000",
                                        cancel_after=True)))
    assert [b[0] for b in booker] == [diag.HOTEL_BOOK_PATH]
    out = capsys.readouterr().out
    assert "BOOK FAILED" in out and "BOOKING DETAILS" not in out and "CANCEL" not in out.replace("not cancelling", "")


def test_preflight_failure_blocks_book(wired, capsys):
    _, booker = wired
    with pytest.raises(SystemExit, match="pre-flight"):
        asyncio.run(diag.run_book(_args(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE,
                                        contact_email="ops@secret.test", contact_phone="12345")))
    assert booker == []
    out = capsys.readouterr().out
    assert "PRE-FLIGHT VALIDATION: FAILED" in out and "10 digits" in out and "12345" not in out


# ------------------------- hold eligibility (--require-hold) -------------------------

import copy


def _review(hold, option_id="opt-cheap-secret", key="onholdAllowed", refundable=False):
    r = copy.deepcopy(REVIEW_REPLY)
    r.pop("onholdAllowed", None)
    r["option"]["optionId"] = option_id
    r["option"]["cancellation"]["isRefundable"] = refundable
    if hold is not None:
        r[key] = hold
    return r


@pytest.mark.parametrize("value,expect", [
    (True, True), ("true", True), ("TRUE", True), (False, False), ("false", False),
    (None, None), ("yes", None), (1, None),
])
def test_review_hold_allowed_is_explicit_only(value, expect):
    assert diag.review_hold_allowed(_review(value)) is expect


def test_hold_allowed_camel_case_and_option_level():
    assert diag.review_hold_allowed(_review(True, key="onHoldAllowed")) is True
    r = _review(None)
    r["option"]["onholdAllowed"] = True
    assert diag.review_hold_allowed(r) is True


def test_refundable_never_implies_hold():
    assert diag.review_hold_allowed(_review(None, refundable=True)) is None


def test_candidate_summary_is_safe():
    s = diag.hold_candidate_summary(_review(True), DETAIL_REPLY["options"][1])
    assert set(s) == {"hotel_name", "option_type", "room_name", "total_price", "hold_allowed", "is_refundable"}
    assert s["hold_allowed"] is True and s["total_price"] == 2136.07
    dumped = json.dumps(s)
    for bad in ("hash-secret", "TGS-SECRET-BOOKING", "opt-cheap-secret", "listing-corr", "private notes"):
        assert bad not in dumped


def _wire_reviews(monkeypatch, replies: dict, detail=None):
    reviewed: list = []
    det = detail or {**DETAIL_REPLY, "options": [
        {"optionId": "opt-a", "optionType": "A", "pricing": {"totalPrice": 1000.0}},
        {"optionId": "opt-b", "optionType": "B", "pricing": {"totalPrice": 2000.0}},
        {"optionId": "opt-c", "optionType": "C", "pricing": {"totalPrice": 3000.0}},
    ]}

    async def fake_post(config, payload, path=diag.HOTEL_LISTING_PATH):
        if path == diag.HOTEL_PRICING_PATH:
            return 200, det, 0.1
        reviewed.append(payload["optionId"])
        return 200, replies[payload["optionId"]], 0.1

    monkeypatch.setattr(diag, "_raw_post", fake_post)
    return reviewed


EXEC = dict(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE,
            contact_email="ops@secret.test", contact_phone="9876500000")


def test_require_hold_picks_only_holdable_of_many(wired, monkeypatch, capsys):
    _, booker = wired
    reviewed = _wire_reviews(monkeypatch, {"opt-a": _review(False, "opt-a"), "opt-b": _review("true", "opt-b"),
                                           "opt-c": _review(False, "opt-c")})
    asyncio.run(diag.run_book(_args(require_hold=True, max_hold_candidates=5, **EXEC)))
    assert reviewed == ["opt-a", "opt-b"]  # cheapest first, stops at first holdable
    out = capsys.readouterr().out
    assert "HOLD NOT AVAILABLE FOR SELECTED OPTION" in out and "HOLD-ELIGIBLE OPTION FOUND" in out
    book = [p for path, p in booker if path == diag.HOTEL_BOOK_PATH]
    assert len(book) == 1 and "paymentInfos" not in book[0]
    for bad in ("hash-secret", "KEY-SECRET", "ABCPE1234F", "opt-b"):
        assert bad not in out


def test_require_hold_none_holdable_never_books(wired, monkeypatch, capsys):
    _, booker = wired
    reviewed = _wire_reviews(monkeypatch, {"opt-a": _review(False, "opt-a"), "opt-b": _review(None, "opt-b"),
                                           "opt-c": _review(False, "opt-c", refundable=True)})
    with pytest.raises(SystemExit, match="no reviewed option supports Hold"):
        asyncio.run(diag.run_book(_args(require_hold=True, max_hold_candidates=5, **EXEC)))
    assert reviewed == ["opt-a", "opt-b", "opt-c"]
    assert booker == []
    assert "NO HOLD-ELIGIBLE OPTION" in capsys.readouterr().out


def test_require_hold_respects_max_candidates(wired, monkeypatch):
    _, booker = wired
    reviewed = _wire_reviews(monkeypatch, {"opt-a": _review(False, "opt-a"), "opt-b": _review(True, "opt-b")})
    with pytest.raises(SystemExit):
        asyncio.run(diag.run_book(_args(require_hold=True, max_hold_candidates=1, **EXEC)))
    assert reviewed == ["opt-a"] and booker == []


def test_hold_false_execute_without_flag_never_books(wired, monkeypatch):
    _, booker = wired
    _wire_reviews(monkeypatch, {"opt-a": _review(False, "opt-a")})
    with pytest.raises(SystemExit, match="HOLD NOT AVAILABLE"):
        asyncio.run(diag.run_book(_args(**EXEC)))
    assert booker == []


def test_hold_absent_execute_never_books(wired, monkeypatch):
    _, booker = wired
    _wire_reviews(monkeypatch, {"opt-a": _review(None, "opt-a")})
    with pytest.raises(SystemExit, match="HOLD NOT AVAILABLE"):
        asyncio.run(diag.run_book(_args(**EXEC)))
    assert booker == []


def test_require_hold_true_dry_run_never_books(wired, monkeypatch, capsys):
    _, booker = wired
    _wire_reviews(monkeypatch, {"opt-a": _review(True, "opt-a")})
    asyncio.run(diag.run_book(_args(require_hold=True, max_hold_candidates=5)))
    assert booker == [] and "DRY RUN" in capsys.readouterr().out


# ------------------------- --lead-guest option -------------------------


def test_lead_guest_replaces_only_first_traveller():
    rooms = [{"adults": 2, "childAges": [5]}, {"adults": 1}]
    p = diag.build_uat_book_payload(booking_id="B", rooms=rooms, email="e@x", phone="1",
                                    lead_guest="Asha Verma")
    ts = [t for r in p["roomTravellerInfo"] for t in r["travellerInfo"]]
    assert ts[0]["fN"] == "Asha" and ts[0]["lN"] == "Verma"
    # all other travellers keep the synthetic test names
    for t in ts[1:]:
        assert t["fN"].startswith("Uat") and t["lN"] == "Diagnostic"
    # lead guests must still be unique across rooms
    assert not diag.validate_book_payload(p, rooms)


def test_lead_guest_single_name_keeps_default_surname():
    p = diag.build_uat_book_payload(booking_id="B", rooms=[{"adults": 1}], email="e", phone="1",
                                    lead_guest="Asha")
    t = p["roomTravellerInfo"][0]["travellerInfo"][0]
    assert t["fN"] == "Asha" and t["lN"] == "Diagnostic"


def test_lead_guest_bad_format_rejected():
    with pytest.raises(ValueError, match="lead_guest_format"):
        diag.build_uat_book_payload(booking_id="B", rooms=[{"adults": 1}], email="e", phone="1",
                                    lead_guest="Asha B Verma")


def test_lead_guest_still_passes_existing_name_validation():
    rooms = [{"adults": 1}]
    p = diag.build_uat_book_payload(booking_id="B", rooms=rooms, email="e@x.io", phone="9876500000",
                                    lead_guest="A1 Bad")
    fails = diag.validate_book_payload(p, rooms)
    assert any(".fN" in f for f in fails)
    assert "A1" not in json.dumps(fails)


def test_lead_guest_changes_identity_fingerprint():
    rooms = [{"adults": 2}]
    a = diag.build_uat_book_payload(booking_id="B", rooms=rooms, email="e", phone="1")
    b = diag.build_uat_book_payload(booking_id="B", rooms=rooms, email="e", phone="1",
                                    lead_guest="Asha Verma")
    ia = diag.booking_identity_summary(a, hid="1", check_in="2026-10-10", check_out="2026-10-11")
    ib = diag.booking_identity_summary(b, hid="1", check_in="2026-10-10", check_out="2026-10-11")
    assert ia["lead_guest_fp"] != ib["lead_guest_fp"]
    assert ia["all_guests_fp"] != ib["all_guests_fp"]
    # same bookingId/hotel/dates -> other fingerprints unchanged
    for k in ("review_booking_id_fp", "pan_set_fp", "hotel_fp"):
        assert ia[k] == ib[k]


def test_lead_guest_flag_flows_into_book_payload(wired, monkeypatch):
    _, booker = wired
    a = _args(execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE,
              contact_email="ops@secret.test", contact_phone="9876500000", cancel_after=True)
    a.lead_guest = "Asha Verma"
    asyncio.run(diag.run_book(a))
    book = [p for path, p in booker if path == diag.HOTEL_BOOK_PATH][0]
    ts = [t for r in book["roomTravellerInfo"] for t in r["travellerInfo"]]
    assert ts[0]["fN"] == "Asha" and ts[0]["lN"] == "Verma"
    assert all(t["fN"].startswith("Uat") for t in ts[1:])
