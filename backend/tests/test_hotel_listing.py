"""Hotel V3 Listing: flat request, <=100-hid batching, confirmed hotels[]
parser, static merge, sanitiser.

Mocked only — no TripJack or Supabase call. Fixture shapes follow the
response structure confirmed from live UAT on the VPS: top level
correlationId / hotels[] / nationality / status / totalResults; hotel
hotelId / name / options[]; option optionId / optionType / roomInfo[] /
inclusions[] / mealBasis / pricing / commercial / compliance / cancellation.
"""

from __future__ import annotations

import asyncio
import json
from datetime import date, timedelta

import pytest

from app.diagnostics import hotel_listing_uat as diag
from app.integrations.tripjack import hotels as tj
from app.integrations.tripjack import hotel_wire as wire
from app.integrations.tripjack.exceptions import (
    TripJackTimeoutError,
    TripJackUpstreamError,
)
from app.schemas.hotels import HotelSearchRequest
from app.services import hotel_search as svc

CI = date.today() + timedelta(days=30)


def option(oid, total=5000.0, mf=50.0, mft=9.0, meal="Room Only", refundable=False, pan=True):
    return {
        "optionId": oid, "optionType": "SRSM",
        "roomInfo": [{"id": "r1", "name": "Deluxe Room", "adults": 2, "children": 0}],
        "inclusions": [], "mealBasis": meal,
        "pricing": {"totalPrice": total, "basePrice": total - 500, "discount": 0, "taxes": 500,
                    "mf": mf, "mft": mft, "currency": "INR"},
        "commercial": {"type": "NET", "commission": 0},
        "compliance": {"gstType": "NA", "panRequired": pan, "passportRequired": False},
        "cancellation": {"isRefundable": refundable, "penalties": []},
    }


def hotel(hid, name="Sea View", **kw):
    return {"hotelId": hid, "name": name, "options": [option(f"{hid}-o1", **kw)]}


def body(hotels, total=None, cid="C1"):
    return {"correlationId": cid, "hotels": hotels, "nationality": "106",
            "status": {"success": True, "httpStatus": 200},
            "totalResults": len(hotels) if total is None else total}


def req(nights=2):
    return HotelSearchRequest(destination="Goa", check_in=CI, check_out=CI + timedelta(days=nights),
                              rooms=[{"adults": 2}])


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def post(self, path, payload, **kw):
        self.calls.append(payload)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


class Cfg:
    search_retries = 1
    hotel_max_pages = 3


def ids(n, start=0):
    return [str(100000000000 + i) for i in range(start, start + n)]


# ------------------------------------------------------------------ request


def test_listing_request_is_flat_v3_payload():
    p = wire.build_listing_payload(hids=["100000224831", "H2"], check_in="2026-10-01",
                                   check_out="2026-10-02", rooms=[{"adults": 2, "childAges": [3, 5]}],
                                   nationality="IN", currency="inr")
    assert p.pop("correlationId")
    assert p == {"checkIn": "2026-10-01", "checkOut": "2026-10-02",
                 "rooms": [{"adults": 2, "children": 2, "childAge": [3, 5]}],
                 "currency": "INR", "nationality": "106", "hids": [100000224831, "H2"]}
    for legacy in ("searchQuery", "roomInfo", "searchCriteria", "checkinDate", "checkoutDate"):
        assert legacy not in p


def test_listing_request_defaults_and_numeric_nationality():
    p = wire.build_listing_payload(hids=["1"], check_in="a", check_out="b", rooms=[{"adults": 1}],
                                   nationality=None, currency=None)
    assert p["currency"] == "INR" and p["nationality"] == "106" and p["rooms"] == [{"adults": 1}]
    assert wire.tripjack_nationality("106") == "106"


def test_listing_request_rejects_more_than_100_hids():
    wire.build_listing_payload(hids=ids(100), check_in="a", check_out="b", rooms=[{"adults": 1}],
                               nationality="IN", currency="INR")
    with pytest.raises(ValueError):
        wire.build_listing_payload(hids=ids(101), check_in="a", check_out="b", rooms=[{"adults": 1}],
                                   nationality="IN", currency="INR")


# ------------------------------------------------------------------ batching


def test_up_to_100_hids_is_one_request():
    client = FakeClient([body([hotel("H1")])])
    asyncio.run(tj.search_hotels(client, Cfg, req(), hids=ids(100)))
    assert len(client.calls) == 1 and len(client.calls[0]["hids"]) == 100


def test_more_than_100_hids_batched_sequentially_and_merged():
    client = FakeClient([body([hotel("H1"), hotel("H2")], total=2), body([hotel("H3")], total=1),
                         body([], total=0)])
    results, sid, cur = asyncio.run(tj.search_hotels(client, Cfg, req(), hids=ids(250)))
    assert [len(c["hids"]) for c in client.calls] == [100, 100, 50]
    sent = [h for c in client.calls for h in c["hids"]]
    assert len(sent) == len(set(sent)) == 250
    assert [r.id for r in results] == ["H1", "H2", "H3"] and sid == "C1" and cur == "INR"


def test_duplicate_hids_are_removed_before_batching():
    client = FakeClient([body([hotel("H1")])])
    asyncio.run(tj.search_hotels(client, Cfg, req(), hids=["1", "1", "2", " 2 "]))
    assert client.calls[0]["hids"] == [1, 2]


def test_results_deduplicated_across_batches():
    client = FakeClient([body([hotel("H1", total=4000)]), body([hotel("H1", total=9999), hotel("H2")])])
    results, _, _ = asyncio.run(tj.search_hotels(client, Cfg, req(), hids=ids(150)))
    assert [r.id for r in results] == ["H1", "H2"]
    assert results[0].rate.total_price.amount == 4000.0  # first occurrence kept


def test_first_batch_failure_propagates():
    client = FakeClient([TripJackUpstreamError("x")])
    with pytest.raises(TripJackUpstreamError):
        asyncio.run(tj.search_hotels(client, Cfg, req(), hids=ids(150)))


def test_later_batch_failure_keeps_earlier_results():
    client = FakeClient([body([hotel("H1")]), TripJackTimeoutError("t")])
    results, _, _ = asyncio.run(tj.search_hotels(client, Cfg, req(), hids=ids(150)))
    assert [r.id for r in results] == ["H1"]


def test_no_pagination_calls_are_made():
    client = FakeClient([{**body([hotel("H1")]), "searchId": "S", "nextPageToken": "T", "hasMore": True}])
    asyncio.run(tj.search_hotels(client, Cfg, req(), hids=ids(5)))
    assert len(client.calls) == 1  # a single batch -> a single call, whatever the body says


# ------------------------------------------------------------------ response


def test_parses_hotels_options_pricing_including_mf_mft():
    page = tj.normalize_listing_response(body([hotel("H1")]), currency="INR", nights=2)
    [r] = page.results
    assert r.id == "H1" and r.name == "Sea View"
    assert r.rate.total_price.amount == 5000.0  # totalPrice authoritative; mf/mft not re-added
    assert r.rate.per_night_price.amount == 2500.0
    plan = r.rate_plans[0]
    assert plan.option_id == "H1-o1" and plan.type == "CHEAPEST"
    assert plan.meal_plan == "Room Only" and plan.room_name == "Deluxe Room"
    assert plan.refundable is False and plan.pan_required is True


def test_mf_mft_absent_uses_total_price_only():
    page = tj.normalize_listing_response(body([hotel("H1", mf=None, mft=None)]), currency="INR")
    assert page.results[0].rate.total_price.amount == 5000.0


def test_multiple_options_become_rate_plans_cheapest_first():
    h = {"hotelId": "H1", "name": "X", "options": [
        option("exp", total=9000, meal="Breakfast", refundable=True, pan=False),
        option("cheap", total=4000),
        option("free", total=6000, refundable=True),
    ]}
    r = tj.normalize_listing_response(body([h]), currency="INR").results[0]
    plans = {p.type: p.option_id for p in r.rate_plans}
    assert plans == {"CHEAPEST": "cheap", "FREE_CANCELLATION": "free",
                     "PAN_NOT_REQUIRED": "exp", "BREAKFAST_INCLUSIVE": "exp"}
    assert r.rate.total_price.amount == 4000.0 and r.rate.rate_plan_type == "CHEAPEST"


def test_hotel_with_no_options_has_no_price():
    r = tj.normalize_listing_response(body([{"hotelId": "H1", "name": "X", "options": []}]),
                                      currency="INR").results[0]
    assert r.rate is None and r.rate_plans is None


def test_option_without_total_price_or_id_is_skipped():
    bad_price = option("o1"); bad_price["pricing"].pop("totalPrice")
    no_id = option(None)
    r = tj.normalize_listing_response(body([{"hotelId": "H1", "name": "X", "options": [bad_price, no_id]}]),
                                      currency="INR").results[0]
    assert r.rate_plans is None


def test_total_results_and_no_pagination_fields():
    page = tj.normalize_listing_response(body([hotel("H1")], total=7), currency="INR")
    assert page.total_results == 7 and page.search_id == "C1"
    assert page.next_token is None and page.has_more is False


def test_legacy_shape_is_not_parsed():
    legacy = {"searchResult": {"his": [{"id": "H1", "name": "X", "ops": [{"id": "o", "tp": {"TF": 1}}]}]}}
    assert tj.normalize_listing_response(legacy, currency="INR").results == []


def test_empty_listing():
    page = tj.normalize_listing_response(body([]), currency="INR")
    assert page.results == [] and page.has_more is False


def test_malformed_items_dropped_not_invented():
    raw = body(["junk", {"name": "No id"}, {"hotelId": "H2"}, hotel("H3")])
    assert [r.id for r in tj.normalize_listing_response(raw, currency="INR").results] == ["H3"]


def test_missing_name_filled_only_from_static_catalogue():
    token = tj.STATIC_NAMES.set({"H2": "Catalogue Name"})
    try:
        r = tj.normalize_listing_response(body([{"hotelId": "H2", "options": []}]), currency="INR").results
    finally:
        tj.STATIC_NAMES.reset(token)
    assert r[0].name == "Catalogue Name" and r[0].rate is None


def test_requested_hotels_absent_from_response_are_not_invented():
    client = FakeClient([body([hotel("100000000001")])])
    results, _, _ = asyncio.run(tj.search_hotels(client, Cfg, req(), hids=ids(5)))
    assert [r.id for r in results] == ["100000000001"]


def test_cancellation_penalties_parsed():
    o = option("o1", refundable=True)
    o["cancellation"]["penalties"] = [{"from": "2026-10-01", "to": "2026-10-05", "amount": 0},
                                      {"from": "2026-10-05", "to": "2026-10-10", "amount": 1200}]
    plan = tj.normalize_listing_response(body([{"hotelId": "H", "name": "X", "options": [o]}]),
                                         currency="INR").results[0].rate_plans[0]
    assert plan.refundable is True and plan.free_cancellation_until == "2026-10-05"


# ------------------------------------------------------------ service level


@pytest.mark.parametrize("exc,expected", [
    (TripJackTimeoutError("t"), svc.HotelProviderTimeoutError),
    (TripJackUpstreamError("5xx"), svc.HotelProviderUnavailableError),
])
def test_provider_errors_are_sanitised(exc, expected):
    err = svc._map_provider_error(exc)
    assert isinstance(err, expected)
    assert "5xx" not in err.message and "t" != err.message


def test_static_merge_fills_gaps_but_live_price_wins():
    live = tj.normalize_listing_response(body([hotel("H1")]), currency="INR").results[0]
    row = {"star_rating": 2, "property_type": "Resort", "address": "Beach Rd", "city": "Goa",
           "latitude": 15.5, "longitude": 73.8, "hotel_images": [{"url": "https://i/1.jpg", "position": 0}],
           "hotel_amenities": [{"name": "Pool"}]}
    merged = svc._merge_static(live, row)
    assert merged.star_rating == 2  # live listing carries no rating; catalogue fills the gap
    assert merged.property_type == "Resort" and merged.amenities == ["Pool"]
    assert merged.images[0].url == "https://i/1.jpg" and merged.location.latitude == 15.5
    assert merged.rate.total_price.amount == live.rate.total_price.amount


def test_unavailable_static_content_hotel_keeps_live_only():
    live = tj.normalize_listing_response(body([hotel("H9")]), currency="INR").results[0]
    assert svc._merge_static(live, None) is live


def test_public_result_has_no_raw_provider_keys():
    r = tj.normalize_listing_response(body([hotel("H1")]), currency="INR").results[0]
    dumped = json.dumps(r.model_dump(by_alias=True, mode="json"))
    for k in ('"pricing"', '"compliance"', '"commercial"', '"correlationId"', '"hotels"'):
        assert k not in dumped


def test_diagnostic_sanitiser_never_emits_values():
    secret_body = body([hotel("H1", name="SECRET-NAME")], cid="SECRET-CID")
    out = json.dumps([diag.shape(secret_body), diag.pagination_fields(secret_body), diag.find_lists(secret_body)])
    assert "SECRET" not in out


def test_diagnostic_parser_report_detects_mismatch():
    rep = diag.parser_report(body([hotel("H1"), {"hotelId": "HX"}]), ["H1", "H2"], "INR")
    assert rep["raw_hotel_items"] == 2 and rep["parsed_hotels"] == 1 and rep["dropped_by_parser"] == 1
    assert rep["returned_not_requested"] == ["HX"] and rep["requested_not_returned"] == 1


def test_uat_diagnostic_payload_matches_official_v3_flat_schema():
    p = diag.build_uat_listing_payload(
        hids=["100000224831", "100000363323"], check_in="2026-10-01", check_out="2026-10-02",
        rooms=[{"adults": 2, "childAges": [3, 5]}, {"adults": 1}], currency="inr",
    )
    cid = p.pop("correlationId")
    assert cid
    assert p == {
        "checkIn": "2026-10-01",
        "checkOut": "2026-10-02",
        "rooms": [{"adults": 2, "children": 2, "childAge": [3, 5]}, {"adults": 1}],
        "currency": "INR",
        "nationality": "106",
        "hids": [100000224831, 100000363323],
    }
    for legacy in ("searchQuery", "roomInfo", "searchCriteria", "checkinDate", "checkoutDate"):
        assert legacy not in p


def test_uat_diagnostic_payload_optional_timeout_and_minimal_room():
    p = diag.build_uat_listing_payload(
        hids=["1"], check_in="2026-10-01", check_out="2026-10-02", rooms=[{"adults": 1}], timeout_ms=13000,
    )
    assert p["rooms"] == [{"adults": 1}] and p["timeoutMs"] == 13000 and p["hids"] == [1]


def test_probe_summary_reports_ids_keys_and_price_types_only():
    b = {"hotels": [{"tjHotelId": "100000224831", "name": "Secret Name",
                     "options": [{"optionId": "o1", "pricing": {"totalPrice": 5059.5, "mf": 50, "mft": 9.0,
                                                               "currency": "INR"}}]}],
         "status": {"success": True}}
    s = diag.probe_summary(b, ["100000224831", "2"])
    assert s["requested_count"] == 2 and s["returned_count"] == 1
    assert s["returned_hids"] == ["100000224831"] and s["returned_not_requested"] == []
    assert s["first_hotel_keys"] == ["name", "options", "tjHotelId"]
    assert s["first_option_keys"] == ["optionId", "pricing"]
    assert s["first_option_pricing_keys"] == ["currency", "mf", "mft", "totalPrice"]
    assert s["first_option_price_fields"]["totalPrice"] == {"type": "float", "value": 5059.5}
    assert s["first_option_price_fields"]["mf"] == {"type": "int", "value": 50}
    assert "Secret Name" not in str(s) and "o1" not in str(s)


def test_probe_summary_empty_and_missing_pricing():
    s = diag.probe_summary({"hotels": [{"tjHotelId": 1, "options": [{"pricing": {"totalPrice": "x"}}]}]}, ["1"])
    assert s["first_option_price_fields"] == {"totalPrice": {"type": "str", "value": None},
                                              "mf": "absent", "mft": "absent"}
    assert diag.probe_summary({}, ["1"])["returned_count"] == 0


# ---- listing structural diagnostics (safe, structure-only) ----

def test_listing_shape_reports_structure_without_values():
    body = {"correlationId": "corr-secret", "status": {"success": True, "httpStatus": 200},
            "totalResults": 2,
            "hotels": [{"hotelId": "111", "name": "Secret Hotel",
                        "options": [{"optionId": "o1", "pricing": {"totalPrice": 10}}]},
                       {"hotelId": "222", "options": []}, "junk"]}
    shape = tj.listing_shape(body)
    assert shape["hotels_len"] == 3 and shape["hotels_non_dict"] == 1
    assert shape["dropped_no_name"] == 1 and shape["dropped_no_id"] == 0
    assert shape["without_priced_options"] == 1
    assert shape["total_results"] == 2 and shape["total_results_present"] is True
    assert shape["status"] == {"success": True, "httpStatus": 200}
    text = json.dumps(shape)
    for leaked in ("corr-secret", "Secret Hotel", "111", "222", "o1"):
        assert leaked not in text


def test_listing_shape_empty_and_missing_hotels():
    assert tj.listing_shape({"hotels": [], "totalResults": 0})["hotels_len"] == 0
    shape = tj.listing_shape({"searchResult": {"his": []}})
    assert shape["hotels_type"] == "NoneType" and shape["total_results_present"] is False
    assert shape["top_keys"] == ["searchResult"]
    assert tj.listing_shape(None) == {"body_type": "NoneType"}


def test_listing_shape_error_codes_only():
    shape = tj.listing_shape({"status": {"success": False, "httpStatus": 400},
                              "errors": [{"errCode": "4005", "message": "guest a@b.com"}]})
    assert shape["error_codes"] == ["4005"]
    assert "a@b.com" not in json.dumps(shape)
