"""Mocked tests for the hotel detail (pricing) UAT diagnostic. No real calls."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from app.diagnostics import hotel_listing_uat as diag

DOC_REPLY = {
    "tjHotelId": "100000001897",
    "hotelName": "Secret Hotel Name",
    "nationality": "106",
    "options": [
        {
            "optionId": "opt-uuid-secret",
            "optionType": "SRSM",
            "roomInfo": [{"id": "r1", "name": "Secret Room", "adults": 2, "children": 0}],
            "inclusions": ["wifi"],
            "mealBasis": "Room Only",
            "bookingNotes": "private notes",
            "pricing": {"totalPrice": 1200.0, "basePrice": 1000.0, "discount": 0,
                        "taxes": 150.0, "mf": 40.0, "mft": 10.0, "currency": "INR"},
            "commercial": {"type": "NET", "commission": 0},
            "compliance": {"gstType": "NA", "panRequired": False, "passportRequired": False},
            "cancellation": {"isRefundable": True, "penalties": [{"from": "a", "to": "b", "amount": 0}]},
        },
        {"optionId": "o2", "optionType": "CRSM", "pricing": {"totalPrice": 1500}},
    ],
    "reviewHash": "hash-secret",
    "status": {"success": True},
    "correlationId": "listing-corr",
}


def _payload():
    return diag.build_uat_pricing_payload(
        listing_correlation_id="listing-corr", hid="100000001897",
        check_in="2026-10-28", check_out="2026-10-29",
        rooms=[{"adults": 2, "childAges": [5]}, {"adults": 1, "childAges": []}], currency="inr",
    )


def test_pricing_payload_is_flat_documented_shape():
    p = _payload()
    assert set(p) == {"correlationId", "hid", "checkIn", "checkOut", "rooms", "currency", "nationality", "timeoutMs"}
    assert p["correlationId"] == "listing-corr"  # must reuse the listing's
    assert p["hid"] == "100000001897" and isinstance(p["hid"], str)
    assert p["rooms"] == [{"adults": 2, "children": 1, "childAge": [5]}, {"adults": 1}]
    assert p["currency"] == "INR" and p["nationality"] == "106"
    for legacy in ("searchId", "hotelId", "searchQuery", "hids"):
        assert legacy not in p


def test_detail_summary_safe_and_structural():
    s = diag.detail_summary(DOC_REPLY, "100000001897")
    assert s["hid_matches"] is True and s["status_success"] is True
    assert s["options_count"] == 2 and s["options_with_option_id"] == 2
    assert s["option_types"] == ["CRSM", "SRSM"]
    assert s["review_hash_present"] is True
    assert s["first_option_roominfo_keys"] == ["adults", "children", "id", "name"]
    assert s["first_option_price_fields"]["totalPrice"] == {"type": "float", "value": 1200.0}
    assert s["first_option_price_fields"]["strikethrough"] == "absent"
    assert s["base_plus_taxes_mf_mft_minus_total"] == 0.0
    assert s["first_option_penalties_count"] == 1
    text = json.dumps(s)
    for secret in ("Secret Hotel Name", "Secret Room", "opt-uuid-secret", "hash-secret", "private notes", "listing-corr"):
        assert secret not in text


def test_detail_summary_handles_errors_and_non_json():
    assert diag.detail_summary(None, "1") == {"json_object": False}
    s = diag.detail_summary({"status": {"success": False}, "errors": [{"errCode": "1"}]}, "1")
    assert s["options_count"] == 0 and s["returned_hid"] is None and s["hid_matches"] is None


def test_production_payload_now_matches_documented_shape():
    c = diag.compare_with_production(_payload(), "100000001897", "listing-corr")
    assert c["missing_in_production"] == [] and c["extra_in_production"] == []
    assert c["production_reuses_listing_correlation_id"] is True
    assert c["payloads_identical"] is True


def _session(results):
    return SimpleNamespace(
        results=results, provider_search_id="listing-corr", check_in="2026-10-28", check_out="2026-10-29",
        rooms=[SimpleNamespace(adults=2, child_ages=[])], currency="INR", nights=1,
    )


def test_pick_hotel_prefers_priced_and_respects_wanted():
    s = _session({"1": SimpleNamespace(rate=None), "2": SimpleNamespace(rate=object())})
    assert diag.pick_hotel(s) == "2"
    assert diag.pick_hotel(s, "1") == "1"
    assert diag.pick_hotel(s, "9") is None
    assert diag.pick_hotel(_session({})) is None


def test_run_detail_uses_saved_session_and_pricing_path(monkeypatch, capsys):
    sent = {}

    async def fake_post(config, payload, path=diag.HOTEL_LISTING_PATH):
        sent.update(payload=payload, path=path)
        return 200, DOC_REPLY, 0.1

    async def fake_get(*, settings, search_id):
        assert search_id == "tok"
        return _session({"100000001897": SimpleNamespace(rate=object())})

    from app.services import hotel_sessions

    monkeypatch.setattr(diag, "_config", lambda: (object(), SimpleNamespace(api_key="KEY-SECRET")))
    monkeypatch.setattr(diag, "_raw_post", fake_post)
    monkeypatch.setattr(hotel_sessions, "get_search_session", fake_get)
    args = SimpleNamespace(search_id="tok", hotel_id="", destination="Goa", days_ahead=30, nights=1, adults=2)
    asyncio.run(diag.run_detail(args))
    assert sent["path"] == diag.HOTEL_PRICING_PATH
    assert sent["payload"]["correlationId"] == "listing-corr"
    assert sent["payload"]["hid"] == "100000001897"
    out = capsys.readouterr().out
    assert "HTTP status: 200" in out and "DETAIL SUMMARY" in out
    for secret in ("KEY-SECRET", "Secret Hotel Name", "hash-secret", "opt-uuid-secret"):
        assert secret not in out


def test_run_detail_refuses_without_listing_correlation(monkeypatch):
    async def fake_get(*, settings, search_id):
        s = _session({"1": SimpleNamespace(rate=object())})
        s.provider_search_id = None
        return s

    from app.services import hotel_sessions

    monkeypatch.setattr(diag, "_config", lambda: (object(), object()))
    monkeypatch.setattr(hotel_sessions, "get_search_session", fake_get)
    args = SimpleNamespace(search_id="tok", hotel_id="", destination="Goa", days_ahead=30, nights=1, adults=2)
    try:
        asyncio.run(diag.run_detail(args))
    except SystemExit as e:
        assert "correlationId" in str(e)
    else:
        raise AssertionError("expected SystemExit")
