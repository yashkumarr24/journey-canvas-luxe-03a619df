"""Official Review request/conditions regressions. No network/provider calls.

The supplied PDF does not specify a full Review money/alerts example. Money
and tripInfos fixtures deliberately exercise the existing adapter contract.
"""
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from app.core.auth import AuthContext
from app.core.config import Settings
from app.integrations.tripjack.review import normalize_review_response, review_fare
from app.repositories.reviews import FareRef, ReviewRepository, SearchContext, _to_session
from app.schemas.review import FlightSelectionRequest, TravellerDetailsRequest
from app.services import flight_booking as service
from tests.test_flight_review import SEARCH_ID, _session, _traveller, review_body


@pytest.mark.asyncio
async def test_documented_review_request_retains_all_selected_ids():
    client = AsyncMock()
    client.post.return_value = review_body()
    result = await review_fare(client, price_ids=["selected-out", "selected-return"], currency="INR")
    client.post.assert_awaited_once_with(
        "fms/v1/review", {"priceIds": ["selected-out", "selected-return"]},
        retries=0, operation="air_review",
    )
    assert result.provider_booking_ref == "TJ-BK-1"
    assert result.total == Decimal("8450.00")


@pytest.mark.asyncio
async def test_single_selected_id_compatibility():
    client = AsyncMock()
    client.post.return_value = review_body()
    await review_fare(client, price_id="selected", currency="INR")
    assert client.post.await_args.args[1] == {"priceIds": ["selected"]}


def test_documented_conditions_and_session_validity():
    body = review_body()
    created = datetime.now(timezone.utc).isoformat()
    conditions = {"st": 180, "sct": created, "isa": True, "pm": True, "pped": True,
                  "adobr": True, "cdobr": False, "idobr": True, "ipa": True,
                  "iecr": True, "igm": True, "idm": True}
    body["conditions"] = conditions
    result = normalize_review_response(body, currency="INR")
    assert result.conditions == conditions
    assert result.requirements.passport_required is True
    assert result.requirements.passport_expiry_required is True
    assert result.requirements.adult_dob_required is True
    assert result.requirements.child_dob_required is False
    assert result.requirements.infant_dob_required is True
    assert (result.expires_at - datetime.fromisoformat(created)).total_seconds() == 180


def test_pan_applicable_is_not_passport_required():
    body = review_body()
    body["conditions"] = {"ipa": True, "pm": False}
    assert normalize_review_response(body, currency="INR").requirements.passport_required is False


def test_booking_handle_required_for_success():
    assert normalize_review_response(review_body(booking_id=""), currency="INR").sellable is False


@pytest.mark.parametrize("refs", [["selected-out", "selected-return"], []])
@pytest.mark.asyncio
async def test_selection_persists_handle_conditions_and_farealert(monkeypatch, refs):
    settings = Settings()
    repo = AsyncMock()
    repo.enabled = True
    repo.get_search.return_value = SearchContext(SEARCH_ID, None, 1, 0, 0, "INR", "roundtrip")
    repo.get_fare_ref.return_value = FareRef("ref", "primary", Decimal("8450"), "INR", _session().expires_at, refs)
    saved = {}
    async def create(values):
        saved.update(values)
        return _to_session({"id": "session", **values})
    repo.create_session.side_effect = create
    body = review_body()  # alert requires consent even if numeric total is unchanged
    body["alerts"] = [{"type": "FAREALERT"}]
    body["conditions"] = {"isa": True, "st": 300}
    provider = AsyncMock(return_value=normalize_review_response(body, currency="INR"))
    monkeypatch.setattr(service, "ReviewRepository", lambda _: repo)
    monkeypatch.setattr(service, "_review_with_provider", provider)
    monkeypatch.setattr(service.review_limiter, "check", lambda _: None)
    monkeypatch.setattr(service, "client_identity", lambda *_: "test")
    result = await service.select_flight(request=object(),
        payload=FlightSelectionRequest(search_id=SEARCH_ID, fare_id="primary"),
        auth=AuthContext(user_id=None), settings=settings)
    selected = refs or ["primary"]
    provider.assert_awaited_once_with(selected, "INR", settings)
    assert saved["provider_price_refs"] == selected
    assert saved["provider_booking_ref"] == "TJ-BK-1"
    assert saved["itinerary"]["conditions"] == {"isa": True, "st": 300}
    assert result.conditions == {"isa": True, "st": 300}
    assert result.status == "price_changed"
    assert result.fare.total_price.amount == 8450
    assert "TJ-BK-1" not in result.model_dump_json()


@pytest.mark.parametrize("amount,alerts", [("8000", []), ("8450", ["FAREALERT"])])
@pytest.mark.asyncio
async def test_unaccepted_fare_change_cannot_continue(monkeypatch, amount, alerts):
    session = _session(total_amount=Decimal(amount), status="price_changed", itinerary={"alerts": alerts})
    response = service._to_response(session, guest_token=None)
    assert response.status == "price_changed"
    repo = AsyncMock()
    repo.enabled = True
    bookings = AsyncMock()
    bookings.enabled = True
    monkeypatch.setattr(service, "ReviewRepository", lambda _: repo)
    monkeypatch.setattr(service, "BookingRepository", lambda _: bookings)
    monkeypatch.setattr(service, "_load_session", AsyncMock(return_value=session))
    monkeypatch.setattr(service.traveller_limiter, "check", lambda _: None)
    monkeypatch.setattr(service, "client_identity", lambda *_: "test")
    payload = TravellerDetailsRequest(review_token=session.review_token,
        travellers=[_traveller()], contact={"email": "a@example.com", "phone": "+919999999999"})
    with pytest.raises(service.PriceChangedError):
        await service.submit_travellers(request=object(), payload=payload,
            auth=AuthContext(user_id=None), settings=Settings())
    bookings.create_draft.assert_not_awaited()


@pytest.mark.asyncio
async def test_repository_reads_plural_price_references():
    repo = ReviewRepository(Settings())
    repo._db = AsyncMock()
    repo._db.select.return_value = [{"id": "r", "provider_ref": "primary", "provider_refs": ["out", "return"]}]
    result = await repo.get_fare_ref(SEARCH_ID, "primary")
    assert result.provider_refs == ["out", "return"]
    assert "provider_refs" in repo._db.select.await_args.kwargs["columns"]