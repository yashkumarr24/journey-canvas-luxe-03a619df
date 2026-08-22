"""PHASE 6 tests — TripJack flight search.

No real TripJack call is made: the adapter's HTTP layer is stubbed with
documented-shape payloads so validation, normalization, error mapping,
rate limiting and secret hygiene are all exercised deterministically.
"""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.rate_limit import flight_search_limiter
from app.integrations.tripjack import client as tj_client
from app.integrations.tripjack.exceptions import (
    TripJackAuthError,
    TripJackBadRequestError,
    TripJackNetworkError,
    TripJackTimeoutError,
    TripJackUpstreamError,
)
from app.main import create_app

TOMORROW = (date.today() + timedelta(days=10)).isoformat()
LATER = (date.today() + timedelta(days=17)).isoformat()

API_KEY = "test-key-not-real"


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def configured_env(monkeypatch):
    monkeypatch.setenv("TRIPJACK_BASE_URL", "https://apitest.tripjack.com")
    monkeypatch.setenv("TRIPJACK_API_KEY", API_KEY)
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "")
    get_settings.cache_clear()
    tj_client._client = None
    flight_search_limiter._buckets.clear()
    yield
    get_settings.cache_clear()
    tj_client._client = None


@pytest.fixture()
def client():
    with TestClient(create_app()) as test_client:
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


def sample_response(*, with_return: bool = False) -> dict:
    """Payload shaped per the TripJack Flights API v2.0 search response."""
    onward = {
        "sI": [
            {
                "id": "seg-1",
                "fD": {"aI": {"code": "6E", "name": "IndiGo"}, "fN": "2134", "eT": "320"},
                "dt": f"{TOMORROW}T06:10",
                "at": f"{TOMORROW}T08:25",
                "da": {"code": "DEL", "name": "Indira Gandhi Intl", "cityName": "Delhi", "terminal": "3"},
                "aa": {"code": "BOM", "name": "Chhatrapati Shivaji", "cityName": "Mumbai", "terminal": "2"},
                "duration": 135,
                "stops": 0,
            }
        ],
        "totalPriceList": [
            {
                "id": "price-abc-123",
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
    trip_infos = {"ONWARD": [onward]}
    if with_return:
        inbound = json.loads(json.dumps(onward))
        inbound["sI"][0]["id"] = "seg-2"
        inbound["sI"][0]["da"], inbound["sI"][0]["aa"] = onward["sI"][0]["aa"], onward["sI"][0]["da"]
        inbound["sI"][0]["dt"] = f"{LATER}T19:00"
        inbound["sI"][0]["at"] = f"{LATER}T21:10"
        inbound["totalPriceList"][0]["id"] = "price-xyz-789"
        trip_infos["RETURN"] = [inbound]
    return {"searchResult": {"tripInfos": trip_infos}}


def oneway_body(**overrides) -> dict:
    body = {
        "tripType": "oneway",
        "origin": "DEL",
        "destination": "BOM",
        "departureDate": TOMORROW,
        "passengers": {"adults": 1, "children": 0, "infants": 0},
        "cabinClass": "economy",
    }
    body.update(overrides)
    return body


# --------------------------------------------------------------------------
# 1-2. Valid searches
# --------------------------------------------------------------------------


def test_valid_oneway_search(client, monkeypatch):
    calls = stub_provider(monkeypatch, result=sample_response())

    response = client.post("/api/v1/flights/search", json=oneway_body())
    assert response.status_code == 200, response.text
    body = response.json()

    assert len(body["results"]) == 1
    result = body["results"][0]
    assert result["id"] == "price-abc-123"
    assert result["fare"]["totalPrice"] == {"amount": 5010.0, "currency": "INR"}
    assert result["fare"]["basePrice"]["amount"] == 4200.0
    assert result["fare"]["taxes"]["amount"] == 810.0
    assert result["fare"]["refundable"] is True
    assert result["fare"]["seatsAvailable"] == 5

    segment = result["itineraries"][0]["segments"][0]
    assert segment["airline"] == {"code": "6E", "name": "IndiGo"}
    assert segment["flightNumber"] == "2134"
    assert segment["origin"]["code"] == "DEL"
    assert segment["destination"]["city"] == "Mumbai"
    assert result["itineraries"][0]["stops"] == 0

    assert body["airlines"] == [{"code": "6E", "name": "IndiGo"}]
    assert body["expiresAt"]

    # Correct documented endpoint and request shape were used.
    assert calls[0]["path"] == "fms/v1/air-search-all"
    query = calls[0]["payload"]["searchQuery"]
    assert query["cabinClass"] == "ECONOMY"
    assert query["paxInfo"] == {"ADULT": 1}
    assert len(query["routeInfos"]) == 1
    assert query["routeInfos"][0]["fromCityOrAirport"] == {"code": "DEL"}


def test_valid_roundtrip_search(client, monkeypatch):
    calls = stub_provider(monkeypatch, result=sample_response(with_return=True))

    response = client.post(
        "/api/v1/flights/search",
        json=oneway_body(tripType="roundtrip", returnDate=LATER),
    )
    assert response.status_code == 200, response.text
    body = response.json()

    directions = {r["itineraries"][0]["direction"] for r in body["results"]}
    assert directions == {"outbound", "inbound"}

    # Two routeInfos entries, reversed on the return leg.
    routes = calls[0]["payload"]["searchQuery"]["routeInfos"]
    assert len(routes) == 2
    assert routes[1]["fromCityOrAirport"] == {"code": "BOM"}
    assert routes[1]["travelDate"] == LATER


# --------------------------------------------------------------------------
# 3-6. Server-side validation (never trust the browser)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"origin": "DELHI"},                                   # malformed IATA
        {"origin": "D3L"},                                     # non-alpha
        {"destination": "DEL"},                                # same as origin
        {"departureDate": "2020-01-01"},                       # past
        {"departureDate": "not-a-date"},                       # malformed
        {"tripType": "roundtrip"},                             # missing return
        {"tripType": "roundtrip", "returnDate": date.today().isoformat()},  # before departure
        {"returnDate": LATER},                                 # return on a one-way
        {"passengers": {"adults": 0, "children": 0, "infants": 0}},
        {"passengers": {"adults": -1, "children": 0, "infants": 0}},
        {"passengers": {"adults": 1, "children": 0, "infants": 2}},   # infants > adults
        {"passengers": {"adults": 8, "children": 4, "infants": 0}},   # > 9 seated
        {"cabinClass": "luxury"},
        {"unexpectedField": "x"},                              # strict schema
    ],
)
def test_invalid_requests_are_rejected(client, monkeypatch, overrides):
    calls = stub_provider(monkeypatch, result=sample_response())

    response = client.post("/api/v1/flights/search", json=oneway_body(**overrides))

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    # Provider quota is never spent on an invalid request.
    assert calls == []


def test_validation_errors_do_not_echo_submitted_values(client, monkeypatch):
    stub_provider(monkeypatch, result=sample_response())
    response = client.post("/api/v1/flights/search", json=oneway_body(origin="SECRETVALUE"))
    assert "SECRETVALUE" not in response.text


# --------------------------------------------------------------------------
# 7. No results
# --------------------------------------------------------------------------


def test_no_results_returns_empty_list_not_error(client, monkeypatch):
    stub_provider(monkeypatch, result={"searchResult": {"tripInfos": {}}})

    response = client.post("/api/v1/flights/search", json=oneway_body())
    assert response.status_code == 200
    assert response.json()["results"] == []


# --------------------------------------------------------------------------
# 8-10. Provider failure mapping
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "error,status_code,code",
    [
        (TripJackTimeoutError("t"), 504, "PROVIDER_TIMEOUT"),
        (TripJackNetworkError("n"), 503, "PROVIDER_UNAVAILABLE"),
        (TripJackUpstreamError("u"), 503, "PROVIDER_UNAVAILABLE"),
        (TripJackAuthError("a"), 503, "PROVIDER_UNAVAILABLE"),
        (TripJackBadRequestError("b"), 422, "SEARCH_REJECTED"),
    ],
)
def test_provider_errors_map_to_safe_responses(client, monkeypatch, error, status_code, code):
    stub_provider(monkeypatch, error=error)

    response = client.post("/api/v1/flights/search", json=oneway_body())
    assert response.status_code == status_code
    body = response.json()
    assert body["code"] == code
    assert body["success"] is False
    assert body["request_id"]

    # No provider internals, credentials or Python detail leak out.
    text = response.text.lower()
    for leak in ("tripjack", "traceback", "httpx", "apikey", API_KEY.lower(), "apitest"):
        assert leak not in text


def test_unconfigured_provider_is_not_a_500(client, monkeypatch):
    monkeypatch.setenv("TRIPJACK_API_KEY", "")
    get_settings.cache_clear()

    response = client.post("/api/v1/flights/search", json=oneway_body())
    assert response.status_code == 503
    assert response.json()["code"] == "SEARCH_NOT_CONFIGURED"


# --------------------------------------------------------------------------
# 11 + 15. Duplicate/flood handling
# --------------------------------------------------------------------------


def test_rate_limit_blocks_flooding_but_allows_normal_use(client, monkeypatch):
    stub_provider(monkeypatch, result=sample_response())

    ok = 0
    for _ in range(flight_search_limiter.limit):
        assert client.post("/api/v1/flights/search", json=oneway_body()).status_code == 200
        ok += 1
    assert ok >= 10  # a real customer refining a search is never blocked

    blocked = client.post("/api/v1/flights/search", json=oneway_body())
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "RATE_LIMITED"


# --------------------------------------------------------------------------
# 12-13. Guest vs authenticated
# --------------------------------------------------------------------------


def test_guest_search_is_allowed(client, monkeypatch):
    stub_provider(monkeypatch, result=sample_response())
    response = client.post("/api/v1/flights/search", json=oneway_body())
    assert response.status_code == 200


def test_client_supplied_user_id_is_rejected(client, monkeypatch):
    stub_provider(monkeypatch, result=sample_response())
    # The schema forbids it outright; user identity comes only from the token.
    response = client.post("/api/v1/flights/search", json=oneway_body(userId="attacker"))
    assert response.status_code == 422


def test_invalid_bearer_token_degrades_to_guest(client, monkeypatch):
    stub_provider(monkeypatch, result=sample_response())
    response = client.post(
        "/api/v1/flights/search",
        json=oneway_body(),
        headers={"Authorization": "Bearer not-a-jwt"},
    )
    assert response.status_code == 200


# --------------------------------------------------------------------------
# 14. CORS
# --------------------------------------------------------------------------


def test_cors_allows_frontend_and_rejects_unknown_origin(client):
    allowed = client.options(
        "/api/v1/flights/search",
        headers={
            "Origin": "http://localhost:8080",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:8080"

    denied = client.options(
        "/api/v1/flights/search",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in denied.headers


# --------------------------------------------------------------------------
# 17. Missing optional provider fields
# --------------------------------------------------------------------------


def test_missing_optional_fields_are_omitted_not_fabricated(client, monkeypatch):
    sparse = {
        "searchResult": {
            "tripInfos": {
                "ONWARD": [
                    {
                        "sI": [
                            {
                                "fD": {"aI": {"code": "AI"}},
                                "dt": f"{TOMORROW}T06:10",
                                "at": f"{TOMORROW}T08:25",
                                "da": {"code": "DEL"},
                                "aa": {"code": "BOM"},
                            }
                        ],
                        "totalPriceList": [
                            {"id": "p1", "fd": {"ADULT": {"fC": {"TF": 3000}}}}
                        ],
                    }
                ]
            }
        }
    }
    stub_provider(monkeypatch, result=sparse)

    response = client.post("/api/v1/flights/search", json=oneway_body())
    assert response.status_code == 200
    result = response.json()["results"][0]

    segment = result["itineraries"][0]["segments"][0]
    # Absent values are omitted entirely — never null, "undefined" or NaN.
    assert "flightNumber" not in segment
    assert "durationMinutes" not in segment
    assert "name" not in segment["airline"]
    assert "basePrice" not in result["fare"]
    assert "refundable" not in result["fare"]
    assert result["fare"]["totalPrice"]["amount"] == 3000.0
    assert "null" not in response.text


def test_unusable_results_are_skipped_not_crashed(client, monkeypatch):
    broken = {
        "searchResult": {
            "tripInfos": {
                "ONWARD": [
                    {"sI": [{"fD": {}}], "totalPriceList": [{"id": "x"}]},   # no airline/times
                    {"sI": [], "totalPriceList": []},                        # empty
                    sample_response()["searchResult"]["tripInfos"]["ONWARD"][0],
                ]
            }
        }
    }
    stub_provider(monkeypatch, result=broken)

    response = client.post("/api/v1/flights/search", json=oneway_body())
    assert response.status_code == 200
    assert len(response.json()["results"]) == 1


def test_fare_without_price_id_is_dropped(client, monkeypatch):
    payload = sample_response()
    del payload["searchResult"]["tripInfos"]["ONWARD"][0]["totalPriceList"][0]["id"]
    stub_provider(monkeypatch, result=payload)

    response = client.post("/api/v1/flights/search", json=oneway_body())
    # An option that cannot be re-priced must not be shown as bookable.
    assert response.json()["results"] == []


# --------------------------------------------------------------------------
# 18-20. Secret hygiene
# --------------------------------------------------------------------------


def test_api_key_never_appears_in_a_successful_response(client, monkeypatch):
    stub_provider(monkeypatch, result=sample_response())
    response = client.post("/api/v1/flights/search", json=oneway_body())
    assert API_KEY not in response.text
    assert "apikey" not in response.text.lower()


def test_credentials_are_never_logged(client, monkeypatch, caplog):
    stub_provider(monkeypatch, result=sample_response())
    with caplog.at_level(logging.DEBUG):
        client.post("/api/v1/flights/search", json=oneway_body())
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert API_KEY not in logged


def test_log_redaction_covers_provider_keys():
    from app.core.logging import redact

    cleaned = redact({"apikey": API_KEY, "Authorization": "Bearer x", "nested": {"tripjack_api_key": API_KEY}})
    assert API_KEY not in json.dumps(cleaned)


def test_raw_provider_payload_is_not_exposed(client, monkeypatch):
    payload = sample_response()
    payload["searchResult"]["internalDebug"] = "vps-internal-detail"
    payload["searchResult"]["tripInfos"]["ONWARD"][0]["providerSecret"] = "leak-me"
    stub_provider(monkeypatch, result=payload)

    response = client.post("/api/v1/flights/search", json=oneway_body())
    assert "vps-internal-detail" not in response.text
    assert "leak-me" not in response.text
    # Our normalized keys only — no TripJack wire field names.
    for wire_key in ("tripInfos", "totalPriceList", "searchResult", '"sI"', '"fD"'):
        assert wire_key not in response.text


# --------------------------------------------------------------------------
# 21-22. Existing surface still works
# --------------------------------------------------------------------------


def test_health_endpoints_still_work(client):
    assert client.get("/health").status_code == 200
    ready = client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["flight_provider"] is True


def test_readiness_stays_ready_without_provider_key(client, monkeypatch):
    monkeypatch.setenv("TRIPJACK_API_KEY", "")
    get_settings.cache_clear()
    ready = client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["flight_provider"] is False
