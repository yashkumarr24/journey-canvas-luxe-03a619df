"""Flight API v2.0 multi-city search tests.

No real TripJack call is made: the HTTP layer is stubbed with
documented-shape payloads so validation, payload mapping, indexed-group
normalization and server-side persistence are exercised deterministically.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.rate_limit import flight_search_limiter
from app.integrations.tripjack import client as tj_client
from app.repositories.searches import SearchRepository
from app import main as app_main

TOMORROW = (date.today() + timedelta(days=10)).isoformat()
LATER = (date.today() + timedelta(days=17)).isoformat()
LATEST = (date.today() + timedelta(days=24)).isoformat()

API_KEY = "test-key-not-real"


# --------------------------------------------------------------------------
# Fixtures (same pattern as test_flight_search.py)
# --------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def configured_env(monkeypatch):
    monkeypatch.setenv("TRIPJACK_BASE_URL", "https://apitest.tripjack.com")
    monkeypatch.setenv("TRIPJACK_API_KEY", API_KEY)
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "")
    get_settings.cache_clear()
    monkeypatch.setattr(app_main, "settings", get_settings())
    tj_client._client = None
    flight_search_limiter._buckets.clear()
    yield
    get_settings.cache_clear()
    tj_client._client = None


@pytest.fixture()
def client():
    with TestClient(app_main.create_app()) as test_client:
        yield test_client


def stub_provider(monkeypatch, result=None, error=None):
    """Replace the TripJack HTTP call, leaving all adapter logic intact."""
    calls: list[dict] = []

    async def fake_post(self, path, payload, *, retries=0, operation="request"):
        calls.append({"path": path, "payload": payload, "retries": retries})
        if error is not None:
            raise error
        return result

    monkeypatch.setattr(tj_client.TripJackClient, "post", fake_post)
    return calls


# --------------------------------------------------------------------------
# Documented-shape sample payloads
# --------------------------------------------------------------------------


def _leg_trip(seg_id: str, origin: str, destination: str, day: str, price_id: str) -> dict:
    return {
        "sI": [
            {
                "id": seg_id,
                "fD": {"aI": {"code": "6E", "name": "IndiGo"}, "fN": "2100", "eT": "320"},
                "dt": f"{day}T06:10",
                "at": f"{day}T08:25",
                "da": {"code": origin, "cityName": origin},
                "aa": {"code": destination, "cityName": destination},
                "duration": 135,
            }
        ],
        "totalPriceList": [
            {
                "id": price_id,
                "fareIdentifier": "PUBLISHED",
                "fd": {
                    "ADULT": {
                        "fC": {"BF": 4200.0, "TAF": 810.0, "TF": 5010.0},
                        "rT": 1,
                        "bI": {"iB": "15 KG", "cB": "7 KG"},
                        "sR": 5,
                        "cc": "ECONOMY",
                    }
                },
            }
        ],
    }


def indexed_multicity_response() -> dict:
    """Domestic multi-city: indexed keys per route, one priceId each."""
    return {
        "searchResult": {
            "tripInfos": {
                "0": [_leg_trip("seg-0", "DEL", "BOM", TOMORROW, "mc-price-0")],
                "1": [_leg_trip("seg-1", "BOM", "GOI", LATER, "mc-price-1")],
                "2": [_leg_trip("seg-2", "GOI", "DEL", LATEST, "mc-price-2")],
            }
        }
    }


def combo_response() -> dict:
    """International return / multi-city: a single COMBO group."""
    combo = _leg_trip("seg-c1", "DEL", "DXB", TOMORROW, "combo-price-1")
    combo["sI"].append(
        {
            "id": "seg-c2",
            "fD": {"aI": {"code": "EK", "name": "Emirates"}, "fN": "511"},
            "dt": f"{LATER}T19:00",
            "at": f"{LATER}T23:10",
            "da": {"code": "DXB"},
            "aa": {"code": "DEL"},
            "duration": 190,
        }
    )
    return {"searchResult": {"tripInfos": {"COMBO": [combo]}}}


_DEFAULT_LEGS = object()


def multicity_body(legs=_DEFAULT_LEGS, **overrides) -> dict:
    if legs is _DEFAULT_LEGS:
        legs = [
            {"origin": "DEL", "destination": "BOM", "departureDate": TOMORROW},
            {"origin": "BOM", "destination": "GOI", "departureDate": LATER},
        ]
    body = {
        "tripType": "multicity",
        "legs": legs,
        "passengers": {"adults": 1, "children": 0, "infants": 0},
        "cabinClass": "economy",
    }
    body.update(overrides)
    return body


# --------------------------------------------------------------------------
# Valid multi-city searches
# --------------------------------------------------------------------------


def test_valid_multicity_two_legs(client, monkeypatch):
    calls = stub_provider(monkeypatch, result=indexed_multicity_response())

    response = client.post("/api/v1/flights/search", json=multicity_body())
    assert response.status_code == 200, response.text

    routes = calls[0]["payload"]["searchQuery"]["routeInfos"]
    assert routes == [
        {"fromCityOrAirport": {"code": "DEL"}, "toCityOrAirport": {"code": "BOM"}, "travelDate": TOMORROW},
        {"fromCityOrAirport": {"code": "BOM"}, "toCityOrAirport": {"code": "GOI"}, "travelDate": LATER},
    ]


def test_valid_multicity_six_legs(client, monkeypatch):
    calls = stub_provider(monkeypatch, result=indexed_multicity_response())
    codes = ["DEL", "BOM", "GOI", "MAA", "BLR", "HYD", "DEL"]
    days = [
        (date.today() + timedelta(days=10 + i)).isoformat()
        for i in range(6)
    ]
    legs = [
        {"origin": codes[i], "destination": codes[i + 1], "departureDate": days[i]}
        for i in range(6)
    ]

    response = client.post("/api/v1/flights/search", json=multicity_body(legs=legs))
    assert response.status_code == 200, response.text
    assert len(calls[0]["payload"]["searchQuery"]["routeInfos"]) == 6


def test_multicity_same_day_onward_leg_is_allowed(client, monkeypatch):
    stub_provider(monkeypatch, result=indexed_multicity_response())
    legs = [
        {"origin": "DEL", "destination": "BOM", "departureDate": TOMORROW},
        {"origin": "BOM", "destination": "GOI", "departureDate": TOMORROW},
    ]
    response = client.post("/api/v1/flights/search", json=multicity_body(legs=legs))
    assert response.status_code == 200, response.text


# --------------------------------------------------------------------------
# Multi-city validation (provider quota is never spent on invalid requests)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        # leg count outside the documented 2-6 range
        {"legs": [{"origin": "DEL", "destination": "BOM", "departureDate": TOMORROW}]},
        {
            "legs": [
                {"origin": "DEL", "destination": "BOM", "departureDate": TOMORROW},
                {"origin": "BOM", "destination": "GOI", "departureDate": TOMORROW},
                {"origin": "GOI", "destination": "MAA", "departureDate": TOMORROW},
                {"origin": "MAA", "destination": "BLR", "departureDate": TOMORROW},
                {"origin": "BLR", "destination": "HYD", "departureDate": TOMORROW},
                {"origin": "HYD", "destination": "CCU", "departureDate": TOMORROW},
                {"origin": "CCU", "destination": "DEL", "departureDate": TOMORROW},
            ]
        },
        {"legs": None},  # multicity without legs
        # same origin/destination within a leg
        {
            "legs": [
                {"origin": "DEL", "destination": "BOM", "departureDate": TOMORROW},
                {"origin": "BOM", "destination": "BOM", "departureDate": LATER},
            ]
        },
        # malformed IATA in a leg
        {
            "legs": [
                {"origin": "DEL", "destination": "BOM", "departureDate": TOMORROW},
                {"origin": "BOM", "destination": "GOA1", "departureDate": LATER},
            ]
        },
        # past leg date
        {
            "legs": [
                {"origin": "DEL", "destination": "BOM", "departureDate": "2020-01-01"},
                {"origin": "BOM", "destination": "GOI", "departureDate": LATER},
            ]
        },
        # non-chronological legs
        {
            "legs": [
                {"origin": "DEL", "destination": "BOM", "departureDate": LATER},
                {"origin": "BOM", "destination": "GOI", "departureDate": TOMORROW},
            ]
        },
        # returnDate is meaningless on multi-city
        {"returnDate": LATER},
        # legs are only valid for multicity
        {"tripType": "oneway"},
        # mutually exclusive modifiers
        {"directOnly": True, "connectingOnly": True},
        # preferredAirline documented cap is 10
        {"preferredAirlines": ["6E", "AI", "EK", "QR", "SQ", "LH", "BA", "AF", "KL", "TK", "UK"]},
        {"preferredAirlines": ["INDIGO"]},  # airline codes are 2 chars
        {"preferredAirlines": ["6"]},
        # undocumented pfts value
        {"pfts": ["REGULAR", "MILITARY"]},
        # passenger limits still apply
        {"passengers": {"adults": 1, "children": 0, "infants": 2}},
        {"passengers": {"adults": 8, "children": 4, "infants": 0}},
        {"cabinClass": "luxury"},
        {"unexpectedField": "x"},
    ],
)
def test_invalid_multicity_requests_are_rejected(client, monkeypatch, overrides):
    calls = stub_provider(monkeypatch, result=indexed_multicity_response())

    response = client.post("/api/v1/flights/search", json=multicity_body(**overrides))

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert calls == []


# --------------------------------------------------------------------------
# Optional search fields map to the documented wire keys
# --------------------------------------------------------------------------


def test_search_modifiers_are_mapped(client, monkeypatch):
    calls = stub_provider(monkeypatch, result=indexed_multicity_response())

    response = client.post(
        "/api/v1/flights/search",
        json=multicity_body(connectingOnly=True, pfts=["REGULAR", "STUDENT"]),
    )
    assert response.status_code == 200, response.text
    modifiers = calls[0]["payload"]["searchQuery"]["searchModifiers"]
    assert modifiers == {"isConnectingFlight": True, "pfts": ["REGULAR", "STUDENT"]}


def test_preferred_airlines_are_mapped(client, monkeypatch):
    calls = stub_provider(monkeypatch, result=indexed_multicity_response())

    response = client.post(
        "/api/v1/flights/search",
        json=multicity_body(preferredAirlines=["6e", " AI "]),
    )
    assert response.status_code == 200, response.text
    query = calls[0]["payload"]["searchQuery"]
    assert query["preferredAirline"] == [{"code": "6E"}, {"code": "AI"}]


def test_no_modifiers_means_no_search_modifiers_key(client, monkeypatch):
    calls = stub_provider(monkeypatch, result=indexed_multicity_response())

    response = client.post("/api/v1/flights/search", json=multicity_body())
    assert response.status_code == 200, response.text
    assert "searchModifiers" not in calls[0]["payload"]["searchQuery"]
    assert "preferredAirline" not in calls[0]["payload"]["searchQuery"]


# --------------------------------------------------------------------------
# Response group normalization
# --------------------------------------------------------------------------


def test_indexed_multicity_groups_are_all_preserved(client, monkeypatch):
    stub_provider(monkeypatch, result=indexed_multicity_response())

    response = client.post("/api/v1/flights/search", json=multicity_body())
    assert response.status_code == 200, response.text
    results = response.json()["results"]

    # Every leg group and every priceId survives normalization.
    assert {r["id"] for r in results} == {"mc-price-0", "mc-price-1", "mc-price-2"}
    by_id = {r["id"]: r for r in results}
    for price_id, leg_index in (("mc-price-0", 0), ("mc-price-1", 1), ("mc-price-2", 2)):
        itinerary = by_id[price_id]["itineraries"][0]
        assert itinerary["direction"] == "leg"
        assert itinerary["legIndex"] == leg_index


def test_combo_group_is_normalized_as_outbound(client, monkeypatch):
    stub_provider(monkeypatch, result=combo_response())

    response = client.post("/api/v1/flights/search", json=multicity_body())
    assert response.status_code == 200, response.text
    results = response.json()["results"]

    assert [r["id"] for r in results] == ["combo-price-1"]
    itinerary = results[0]["itineraries"][0]
    assert itinerary["direction"] == "outbound"
    # Both segments of the combined itinerary are preserved.
    assert len(itinerary["segments"]) == 2
    assert itinerary["stops"] == 1


def test_oneway_and_roundtrip_groups_are_unchanged(client, monkeypatch):
    """ONWARD/RETURN responses keep their existing shape (regression)."""
    onward = _leg_trip("seg-1", "DEL", "BOM", TOMORROW, "price-out")
    inbound = json.loads(json.dumps(_leg_trip("seg-2", "BOM", "DEL", LATER, "price-in")))
    stub_provider(
        monkeypatch,
        result={"searchResult": {"tripInfos": {"ONWARD": [onward], "RETURN": [inbound]}}},
    )

    response = client.post(
        "/api/v1/flights/search",
        json={
            "tripType": "roundtrip",
            "origin": "DEL",
            "destination": "BOM",
            "departureDate": TOMORROW,
            "returnDate": LATER,
        },
    )
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    directions = {r["id"]: r["itineraries"][0]["direction"] for r in results}
    assert directions == {"price-out": "outbound", "price-in": "inbound"}
    # No legIndex leaks into one-way/round-trip results.
    assert all("legIndex" not in r["itineraries"][0] for r in results)


# --------------------------------------------------------------------------
# Server-side persistence of the multi-city search and every priceId
# --------------------------------------------------------------------------


def _capture_persistence(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    get_settings.cache_clear()
    monkeypatch.setattr(app_main, "settings", get_settings())

    posted: list[tuple[str, object]] = []

    async def fake_post(self, table, rows, *, prefer):
        posted.append((table, rows))
        if table == "flight_searches":
            return [{"id": "11111111-2222-3333-4444-555555555555"}]
        return []

    monkeypatch.setattr(SearchRepository, "_post", fake_post)
    return posted


def test_multicity_search_persists_legs_and_every_price_id(client, monkeypatch):
    posted = _capture_persistence(monkeypatch)
    stub_provider(monkeypatch, result=indexed_multicity_response())

    legs = [
        {"origin": "DEL", "destination": "BOM", "departureDate": TOMORROW},
        {"origin": "BOM", "destination": "GOI", "departureDate": LATER},
        {"origin": "GOI", "destination": "DEL", "departureDate": LATEST},
    ]
    response = client.post("/api/v1/flights/search", json=multicity_body(legs=legs))
    assert response.status_code == 200, response.text

    search_rows = [rows for table, rows in posted if table == "flight_searches"]
    assert len(search_rows) == 1
    row = search_rows[0]
    assert row["trip_type"] == "multicity"
    assert row["routes"] == [
        {"from": "DEL", "to": "BOM", "travelDate": TOMORROW},
        {"from": "BOM", "to": "GOI", "travelDate": LATER},
        {"from": "GOI", "to": "DEL", "travelDate": LATEST},
    ]
    # Scalar summary columns stay populated for existing readers.
    assert row["origin"] == "DEL"
    assert row["destination"] == "DEL"  # circular trip ends where it started
    assert row["departure_date"] == TOMORROW
    assert row["return_date"] is None

    ref_rows = [rows for table, rows in posted if table == "search_result_refs"]
    assert len(ref_rows) == 1
    # Every priceId needed to review the complete itinerary is stored.
    assert {r["provider_ref"] for r in ref_rows[0]} == {"mc-price-0", "mc-price-1", "mc-price-2"}
    assert all(r["flight_search_id"] == "11111111-2222-3333-4444-555555555555" for r in ref_rows[0])


def test_oneway_persistence_has_no_routes(client, monkeypatch):
    posted = _capture_persistence(monkeypatch)
    stub_provider(monkeypatch, result={"searchResult": {"tripInfos": {"ONWARD": [_leg_trip("s", "DEL", "BOM", TOMORROW, "p1")]}}})

    response = client.post(
        "/api/v1/flights/search",
        json={
            "tripType": "oneway",
            "origin": "DEL",
            "destination": "BOM",
            "departureDate": TOMORROW,
        },
    )
    assert response.status_code == 200, response.text
    row = [rows for table, rows in posted if table == "flight_searches"][0]
    assert row["trip_type"] == "oneway"
    assert row["routes"] is None


# --------------------------------------------------------------------------
# Revision regressions: truncation, group keys, full ref storage, review block
# --------------------------------------------------------------------------

from app.integrations.tripjack.flights import MAX_RESULTS, normalize_search_response  # noqa: E402


def _many(prefix: str, origin: str, destination: str, day: str, count: int) -> list[dict]:
    return [_leg_trip(f"{prefix}-s{i}", origin, destination, day, f"{prefix}-{i}") for i in range(count)]


def test_large_first_leg_does_not_drop_later_legs():
    body = {"searchResult": {"tripInfos": {
        "0": _many("l0", "DEL", "BOM", TOMORROW, MAX_RESULTS + 30),
        "1": _many("l1", "BOM", "GOI", LATER, 3),
        "2": _many("l2", "GOI", "DEL", LATEST, 2),
    }}}
    results = normalize_search_response(body, currency="INR").results
    by_key: dict[str, list[str]] = {}
    for r in results:
        by_key.setdefault(r.itineraries[0].group_key, []).append(r.id)
    assert len(by_key["0"]) == MAX_RESULTS
    assert by_key["1"] == ["l1-0", "l1-1", "l1-2"]
    assert by_key["2"] == ["l2-0", "l2-1"]


def test_six_leg_groups_keep_original_keys_indices_and_price_ids():
    body = {"searchResult": {"tripInfos": {
        str(i): [_leg_trip(f"s{i}", "DEL", "BOM", TOMORROW, f"p{i}")] for i in (5, 0, 3, 1, 4, 2)
    }}}
    results = normalize_search_response(body, currency="INR").results
    assert [(r.itineraries[0].group_key, r.itineraries[0].leg_index, r.id) for r in results] == [
        (str(i), i, f"p{i}") for i in range(6)
    ]


def test_large_onward_does_not_crowd_out_return_fares():
    body = {"searchResult": {"tripInfos": {
        "ONWARD": _many("on", "DEL", "BOM", TOMORROW, MAX_RESULTS + 5),
        "RETURN": _many("re", "BOM", "DEL", LATER, 4),
    }}}
    results = normalize_search_response(body, currency="INR").results
    inbound = [r.id for r in results if r.itineraries[0].direction == "inbound"]
    assert inbound == ["re-0", "re-1", "re-2", "re-3"]
    assert all(r.itineraries[0].group_key is None for r in results)


def test_special_return_fare_in_onward_return_is_preserved():
    onward = _leg_trip("s1", "DEL", "BOM", TOMORROW, "sr-out")
    onward["totalPriceList"][0]["fareIdentifier"] = "SPECIAL_RETURN"
    inbound = _leg_trip("s2", "BOM", "DEL", LATER, "sr-in")
    inbound["totalPriceList"][0]["fareIdentifier"] = "SPECIAL_RETURN"
    body = {"searchResult": {"tripInfos": {"ONWARD": [onward], "RETURN": [inbound]}}}
    results = normalize_search_response(body, currency="INR").results
    assert {r.id: r.itineraries[0].direction for r in results} == {"sr-out": "outbound", "sr-in": "inbound"}


def test_every_returned_fare_gets_a_stored_reference(client, monkeypatch):
    posted = _capture_persistence(monkeypatch)
    stub_provider(monkeypatch, result={"searchResult": {"tripInfos": {
        "0": _many("a", "DEL", "BOM", TOMORROW, MAX_RESULTS),
        "1": _many("b", "BOM", "GOI", LATER, 40),
    }}})
    response = client.post("/api/v1/flights/search", json=multicity_body())
    assert response.status_code == 200, response.text
    returned = {r["id"] for r in response.json()["results"]}
    assert len(returned) == MAX_RESULTS + 40

    chunks = [rows for table, rows in posted if table == "search_result_refs"]
    assert all(len(c) <= 100 for c in chunks)
    stored = [row for c in chunks for row in c]
    assert {row["provider_ref"] for row in stored} == returned
    assert all(row["provider_refs"] == [row["provider_ref"]] for row in stored)


def test_group_key_absent_from_oneway_json(client, monkeypatch):
    stub_provider(monkeypatch, result={"searchResult": {"tripInfos": {
        "ONWARD": [_leg_trip("s", "DEL", "BOM", TOMORROW, "ow-1")]}}})
    response = client.post("/api/v1/flights/search", json={
        "tripType": "oneway", "origin": "DEL", "destination": "BOM", "departureDate": TOMORROW})
    assert response.status_code == 200, response.text
    itinerary = response.json()["results"][0]["itineraries"][0]
    assert "groupKey" not in itinerary and "legIndex" not in itinerary


def test_multicity_review_is_blocked(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from app.repositories.reviews import ReviewRepository, SearchContext
    from app.services import flight_booking

    monkeypatch.setattr(ReviewRepository, "enabled", property(lambda self: True))

    async def get_search(self, search_id):
        return SearchContext(search_id=search_id, user_id=None, adults=1, children=0,
                             infants=0, currency="INR", trip_type="multicity")

    async def must_not_run(*a, **k):
        raise AssertionError("fare lookup/provider review must not run for multicity")

    monkeypatch.setattr(ReviewRepository, "get_search", get_search)
    monkeypatch.setattr(ReviewRepository, "get_fare_ref", must_not_run)
    monkeypatch.setattr(flight_booking, "_review_with_provider", must_not_run)
    monkeypatch.setattr(flight_booking.review_limiter, "check", lambda *_: None)

    payload = SimpleNamespace(idempotency_key=None, search_id="s-1", fare_id="mc-price-0", guest_token=None)
    auth = SimpleNamespace(user_id=None, is_authenticated=False)
    with pytest.raises(flight_booking.FareUnavailableError):
        asyncio.run(flight_booking.select_flight(
            request=SimpleNamespace(), payload=payload, auth=auth, settings=get_settings()))
