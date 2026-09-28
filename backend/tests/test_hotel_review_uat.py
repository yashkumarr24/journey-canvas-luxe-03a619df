"""Mocked tests for the read-only hotel review UAT diagnostic. No real calls."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.diagnostics import hotel_listing_uat as diag

HID = "100000001897"

DETAIL_REPLY = {
    "hotelId": HID,
    "hotelName": "Secret Hotel Name",
    "options": [
        {"optionId": "opt-expensive", "pricing": {"totalPrice": 3000.0}},
        {"optionId": "opt-cheap-secret", "optionType": "SRSM",
         "pricing": {"totalPrice": 2136.07, "basePrice": 2112.47, "taxes": 0, "mf": 20.0, "mft": 3.6}},
        {"optionId": "no-price"},
    ],
    "reviewHash": "hash-secret",
    "status": {"success": True},
    "correlationId": "listing-corr",
}

REVIEW_REPLY = {
    "correlationId": "listing-corr",
    "tjHotelId": HID,
    "hotelName": "Secret Hotel Name",
    "bookingId": "TGS-SECRET-BOOKING",
    "option": {
        "optionId": "opt-cheap-secret",
        "optionType": "SRSM",
        "roomInfo": [{"id": "r1", "name": "Secret Room"}],
        "inclusions": ["wifi"],
        "mealBasis": "Room Only",
        "bookingNotes": "private notes",
        "pricing": {"totalPrice": 2136.07, "basePrice": 2112.47, "discount": 0, "taxes": 0,
                    "mf": 20.0, "mft": 3.6, "currency": "INR"},
        "commercial": {"type": "NET", "commission": 0},
        "compliance": {"gstType": "NA", "panRequired": False, "passportRequired": False},
        "cancellation": {"isRefundable": True, "deadlineDateTime": "2026-10-20T23:59:59",
                         "penalties": [{"from": "a", "to": "b", "amount": 0},
                                       {"from": "b", "to": "c", "amount": 2000.0}]},
    },
    "onholdAllowed": "true",
    "status": {"success": True},
}

SECRETS = ("KEY-SECRET", "Secret Hotel Name", "Secret Room", "hash-secret", "opt-cheap-secret",
           "TGS-SECRET-BOOKING", "private notes", "listing-corr")


def test_documented_review_payload_is_four_flat_fields():
    p = diag.build_uat_review_payload(listing_correlation_id="listing-corr", hid=HID,
                                      option_id="o1", review_hash="h")
    assert p == {"correlationId": "listing-corr", "optionId": "o1", "reviewHash": "h", "hid": HID}
    assert isinstance(p["hid"], str)
    for legacy in ("searchId", "hotelId", "searchQuery"):
        assert legacy not in p


def test_with_context_variant_adds_saved_session_fields():
    p = diag.build_uat_review_payload(
        listing_correlation_id="c", hid=HID, option_id="o1", review_hash="h", variant="with-context",
        check_in="2026-10-28", check_out="2026-10-29", rooms=[{"adults": 2, "childAges": [5]}], currency="inr",
    )
    assert p["checkIn"] == "2026-10-28" and p["checkOut"] == "2026-10-29"
    assert p["rooms"] == [{"adults": 2, "children": 1, "childAge": [5]}]
    assert p["currency"] == "INR" and p["nationality"] == "106"
    assert "timeoutMs" not in p


def test_select_detail_option_cheapest_and_wanted():
    assert diag.select_detail_option(DETAIL_REPLY)["optionId"] == "opt-cheap-secret"
    assert diag.select_detail_option(DETAIL_REPLY, "opt-expensive")["optionId"] == "opt-expensive"
    assert diag.select_detail_option(DETAIL_REPLY, "no-price") is None
    assert diag.select_detail_option(None) is None


def test_review_summary_safe_and_compares_detail_total():
    opt = diag.select_detail_option(DETAIL_REPLY)
    s = diag.review_summary(REVIEW_REPLY, HID, opt)
    assert s["status_success"] is True and s["hid_matches"] is True
    assert s["option_container"] == "option" and s["option_id_matches_selected"] is True
    assert s["booking_id_present"] is True and s["correlation_id_present"] is True
    assert s["review_total_matches_detail"] is True and s["review_minus_detail_total"] == 0.0
    assert s["base_plus_taxes_mf_mft_minus_total"] == 0.0
    assert s["price_fields"]["totalPrice"] == {"type": "float", "value": 2136.07}
    assert s["cancellation_is_refundable"] is True and s["cancellation_penalties_count"] == 2
    assert s["cancellation_penalty_amounts"] == [0.0, 2000.0] and s["deadline_present"] is True
    assert "bookingId" in s["provider_only_fields_never_to_browser"]
    text = json.dumps(s)
    for secret in SECRETS:
        assert secret not in text


def test_review_summary_detects_price_change_and_errors():
    changed = json.loads(json.dumps(REVIEW_REPLY))
    changed["option"]["pricing"]["totalPrice"] = 2200.0
    s = diag.review_summary(changed, HID, diag.select_detail_option(DETAIL_REPLY))
    assert s["review_total_matches_detail"] is False and s["review_minus_detail_total"] == 63.93
    err = {"status": {"success": False},
           "error": {"code": "OPTION_SOLD_OUT", "message": "gone", "requestId": "req-secret"}}
    e = diag.review_summary(err, HID, None)
    assert e["errors"] == [{"code": "OPTION_SOLD_OUT", "message": "gone"}]
    assert "req-secret" not in json.dumps(e)
    assert diag.review_summary(None, HID, None) == {"json_object": False}


def test_production_review_payload_differs_from_docs():
    doc = diag.build_uat_review_payload(listing_correlation_id="c", hid=HID, option_id="o", review_hash="h")
    c = diag.compare_review_with_production(doc, HID, "o", "c")
    assert "reviewHash" in c["missing_in_production"] and "hid" in c["missing_in_production"]
    assert set(c["extra_in_production"]) == {"searchId", "hotelId"}
    assert c["production_reuses_listing_correlation_id"] is False


def _session():
    return SimpleNamespace(
        results={HID: SimpleNamespace(rate=object())}, provider_search_id="listing-corr",
        check_in="2026-10-28", check_out="2026-10-29",
        rooms=[SimpleNamespace(adults=2, child_ages=[])], currency="INR", nights=1,
    )


def _args(**kw):
    base = dict(search_id="tok", hotel_id="", option_id="", review_variant="documented",
                destination="Goa", days_ahead=30, nights=1, adults=2)
    base.update(kw)
    return SimpleNamespace(**base)


def _patch(monkeypatch, replies, calls):
    async def fake_post(config, payload, path=diag.HOTEL_LISTING_PATH):
        calls.append((path, payload))
        return replies[path]

    async def fake_get(*, settings, search_id):
        return _session()

    async def no_sleep(_):
        return None

    from app.services import hotel_sessions

    monkeypatch.setattr(diag, "_config", lambda: (object(), SimpleNamespace(api_key="KEY-SECRET")))
    monkeypatch.setattr(diag, "_raw_post", fake_post)
    monkeypatch.setattr(diag.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(hotel_sessions, "get_search_session", fake_get)


def test_run_review_detail_then_review_only(monkeypatch, capsys):
    calls: list = []
    _patch(monkeypatch, {diag.HOTEL_PRICING_PATH: (200, DETAIL_REPLY, 0.1),
                         diag.HOTEL_REVIEW_PATH: (200, REVIEW_REPLY, 0.1)}, calls)
    asyncio.run(diag.run_review(_args()))
    assert [c[0] for c in calls] == [diag.HOTEL_PRICING_PATH, diag.HOTEL_REVIEW_PATH]  # never book
    review = calls[1][1]
    assert review == {"correlationId": "listing-corr", "optionId": "opt-cheap-secret",
                      "reviewHash": "hash-secret", "hid": HID}
    out = capsys.readouterr().out
    assert "REVIEW HTTP status: 200" in out and '"review_total_matches_detail": true' in out
    assert "no booking was created" in out
    for secret in SECRETS:
        assert secret not in out


def test_run_review_stops_without_review_hash(monkeypatch):
    calls: list = []
    detail = {k: v for k, v in DETAIL_REPLY.items() if k != "reviewHash"}
    _patch(monkeypatch, {diag.HOTEL_PRICING_PATH: (200, detail, 0.1)}, calls)
    with pytest.raises(SystemExit, match="reviewHash"):
        asyncio.run(diag.run_review(_args()))
    assert len(calls) == 1


def test_run_review_stops_when_detail_fails(monkeypatch):
    calls: list = []
    _patch(monkeypatch, {diag.HOTEL_PRICING_PATH: (400, {"error": {"code": "X"}}, 0.1)}, calls)
    with pytest.raises(SystemExit, match="Detail call failed"):
        asyncio.run(diag.run_review(_args()))
    assert len(calls) == 1
