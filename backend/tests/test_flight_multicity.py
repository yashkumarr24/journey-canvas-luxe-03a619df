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
