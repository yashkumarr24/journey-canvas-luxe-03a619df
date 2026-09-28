"""Hotel V3 Listing: parser, pagination, errors, static merge, sanitiser.

Mocked only — no TripJack or Supabase call. Fixture shapes follow the v3
documentation used by the current parser; they are NOT yet confirmed against
a real UAT response (see app/diagnostics/hotel_listing_uat.py).
"""

from __future__ import annotations

import asyncio
import json
from datetime import date, timedelta

import pytest

from app.diagnostics import hotel_listing_uat as diag
from app.integrations.tripjack import hotels as tj
from app.integrations.tripjack.exceptions import (
    TripJackTimeoutError,
    TripJackUpstreamError,
)
from app.schemas.hotels import HotelSearchRequest
from app.services import hotel_search as svc

CI = date.today() + timedelta(days=30)


def hotel(hid, name="Sea View", total=5000.0, mf=50.0, mft=9.0):
    return {
        "id": hid, "name": name, "rt": 4,
        "ops": [{"id": f"{hid}-o1", "tp": {"TF": total, "mf": mf, "mft": mft}, "mb": "RO"}],
    }


def body(hotels, search_id="S1", next_token=None, has_more=None):
    b = {"searchResult": {"his": hotels, "searchId": search_id}, "status": {"success": True}}
    if next_token:
        b["searchResult"]["nextPageToken"] = next_token
    if has_more is not None:
        b["searchResult"]["hasMore"] = has_more
    return b


def req():
    return HotelSearchRequest(destination="Goa", check_in=CI, check_out=CI + timedelta(days=2),
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


def test_listing_parses_hotel_id_and_price_including_mf_mft():
    page = tj.normalize_listing_response(body([hotel("H1")]), currency="INR")
    assert page.search_id == "S1"
    [r] = page.results
    assert r.id == "H1" and r.star_rating == 4
    assert r.rate.total_price.amount == 5059.0  # TF + mf + mft
    assert r.rate_plans[0].option_id == "H1-o1"


def test_empty_listing():
    page = tj.normalize_listing_response(body([]), currency="INR")
    assert page.results == [] and page.has_more is False


def test_malformed_items_dropped_not_invented():
    raw = body(["junk", {"name": "No id"}, {"id": "H2"}, hotel("H3")])
    ids = [r.id for r in tj.normalize_listing_response(raw, currency="INR").results]
    assert ids == ["H3"]  # H2 has no name and no static name


def test_missing_name_filled_only_from_static_catalogue():
    token = tj.STATIC_NAMES.set({"H2": "Catalogue Name"})
    try:
        r = tj.normalize_listing_response(body([{"id": "H2"}]), currency="INR").results
    finally:
        tj.STATIC_NAMES.reset(token)
    assert r[0].name == "Catalogue Name" and r[0].rate is None  # no invented price


def test_option_without_price_is_skipped():
    raw = body([{"id": "H1", "name": "X", "ops": [{"id": "o1"}]}])
    assert tj.normalize_listing_response(raw, currency="INR").results[0].rate_plans is None


def test_pagination_follows_search_id_and_dedupes():
    client = FakeClient([
        body([hotel("H1")], next_token="T2"),
        body([hotel("H1"), hotel("H2")], next_token=None, has_more=False),
    ])
    results, sid, _ = asyncio.run(tj.search_hotels(client, Cfg, req(), hids=["H1", "H2"]))
    assert [r.id for r in results] == ["H1", "H2"] and sid == "S1"
    assert client.calls[1] == {"correlationId": client.calls[1]["correlationId"], "searchId": "S1", "nextPageToken": "T2"}
    assert client.calls[0]["searchQuery"]["searchCriteria"]["hids"] == ["H1", "H2"]


def test_failed_continuation_keeps_first_page():
    client = FakeClient([body([hotel("H1")], next_token="T2"), TripJackUpstreamError("x")])
    results, _, _ = asyncio.run(tj.search_hotels(client, Cfg, req(), hids=["H1"]))
    assert [r.id for r in results] == ["H1"]


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
    assert merged.star_rating == 4  # live wins
    assert merged.property_type == "Resort" and merged.amenities == ["Pool"]
    assert merged.images[0].url == "https://i/1.jpg" and merged.location.latitude == 15.5
    assert merged.rate.total_price.amount == live.rate.total_price.amount


def test_unavailable_static_content_hotel_keeps_live_only():
    live = tj.normalize_listing_response(body([hotel("H9")]), currency="INR").results[0]
    assert svc._merge_static(live, None) is live


def test_diagnostic_sanitiser_never_emits_values():
    secret_body = body([hotel("H1", name="SECRET-NAME")], search_id="SECRET-SID", next_token="SECRET-TOK")
    out = json.dumps([diag.shape(secret_body), diag.pagination_fields(secret_body), diag.find_lists(secret_body)])
    assert "SECRET" not in out
    assert diag.price_fields(secret_body["searchResult"]["his"][0]) == {"ops[0].tp.TF": 5000.0, "ops[0].tp.mf": 50.0, "ops[0].tp.mft": 9.0}


def test_diagnostic_parser_report_detects_mismatch():
    rep = diag.parser_report(body([hotel("H1"), {"id": "HX"}]), ["H1", "H2"], "INR")
    assert rep["raw_hotel_items"] == 2 and rep["parsed_hotels"] == 1 and rep["dropped_by_parser"] == 1
    assert rep["returned_not_requested"] == ["HX"] and rep["requested_not_returned"] == 1
