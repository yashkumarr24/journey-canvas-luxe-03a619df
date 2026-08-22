"""PHASE 7 tests: review normalization, ownership, and price-trust invariants.

The security-critical assertions here are the ones proving the SERVER decides
the amount, the passenger counts and who may resume a session.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import pytest
from pydantic import ValidationError

from app.core.auth import AuthContext
from app.integrations.tripjack.review import normalize_review_response
from app.repositories.reviews import ReviewSession, hash_token, new_token
from app.schemas.review import (
    ContactInput,
    FlightSelectionRequest,
    TravellerDetailsRequest,
    TravellerInput,
    TravellerRequirements,
)
from app.services import flight_booking as service

SEARCH_ID = "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8"


def review_body(total: float = 8450.0, *, booking_id: str = "TJ-BK-1") -> dict[str, Any]:
    return {
        "bookingId": booking_id,
        "totalPriceInfo": {"totalFareDetail": {"fC": {"BF": 7000.0, "TAF": 1450.0, "TF": total}}},
        "tripInfos": [
            {
                "sI": [
                    {
                        "id": "s1",
                        "fD": {"aI": {"code": "AI", "name": "Air India"}, "fN": "202"},
                        "dt": "2026-09-01T08:00",
                        "at": "2026-09-01T10:10",
                        "da": {"code": "DEL", "city": "Delhi", "country": "IN"},
                        "aa": {"code": "BOM", "city": "Mumbai", "country": "IN"},
                        "duration": 130,
                        "stops": 0,
                    }
                ],
                "totalPriceList": [
                    {
                        "id": "PRICE-1",
                        "fareIdentifier": "PUBLISHED",
                        "fd": {
                            "ADULT": {
                                "fC": {"BF": 7000.0, "TAF": 1450.0, "TF": total},
                                "rT": 1,
                                "bI": {"iB": "15 KG", "cB": "7 KG"},
                                "sR": 4,
                            }
                        },
                    }
                ],
            }
        ],
    }


# -- normalization -----------------------------------------------------------


def test_review_normalizes_totals_and_provider_ref() -> None:
    outcome = normalize_review_response(review_body(), currency="INR")

    assert outcome.provider_booking_ref == "TJ-BK-1"
    assert outcome.total == Decimal("8450.00")
    assert outcome.base == Decimal("7000.00")
    assert outcome.taxes == Decimal("1450.00")
    assert outcome.sellable is True
    assert len(outcome.itineraries) == 1
    assert outcome.fare.refundable is True
    assert outcome.fare.baggage_check_in == "15 KG"


def test_review_money_is_decimal_not_float() -> None:
    outcome = normalize_review_response(review_body(total=8450.10), currency="INR")
    assert isinstance(outcome.total, Decimal)
    assert outcome.total == Decimal("8450.10")


def test_review_without_total_is_not_sellable() -> None:
    body = review_body()
    body["totalPriceInfo"] = {}
    body["tripInfos"][0]["totalPriceList"][0]["fd"]["ADULT"]["fC"] = {}
    outcome = normalize_review_response(body, currency="INR")
    assert outcome.sellable is False


def test_empty_review_response_is_not_sellable() -> None:
    outcome = normalize_review_response({}, currency="INR")
    assert outcome.sellable is False
    assert outcome.provider_booking_ref is None


def test_domestic_route_does_not_require_passport() -> None:
    outcome = normalize_review_response(review_body(), currency="INR")
    assert outcome.requirements.international is False
    assert outcome.requirements.passport_required is False


def test_international_route_requires_passport() -> None:
    body = review_body()
    body["tripInfos"][0]["sI"][0]["aa"] = {"code": "DXB", "city": "Dubai", "country": "AE"}
    outcome = normalize_review_response(body, currency="INR")
    assert outcome.requirements.international is True
    assert outcome.requirements.passport_required is True
    assert outcome.requirements.date_of_birth_required is True


def test_provider_passport_flag_is_honoured_on_domestic_route() -> None:
    body = review_body()
    body["conditions"] = {"isPassportRequired": True}
    outcome = normalize_review_response(body, currency="INR")
    assert outcome.requirements.passport_required is True


def test_review_expiry_is_bounded() -> None:
    outcome = normalize_review_response(review_body(), currency="INR")
    remaining = outcome.expires_at - datetime.now(timezone.utc)
    assert timedelta(minutes=10) < remaining <= timedelta(minutes=15)


# -- inbound contract: the browser cannot state a price ----------------------


@pytest.mark.parametrize(
    "field",
    ["totalAmount", "price", "amount", "currency", "userId", "totalPrice"],
)
def test_selection_rejects_price_and_identity_fields(field: str) -> None:
    with pytest.raises(ValidationError):
        FlightSelectionRequest.model_validate(
            {"searchId": SEARCH_ID, "fareId": "PRICE-1", field: 1}
        )


def test_selection_rejects_non_uuid_search_id() -> None:
    with pytest.raises(ValidationError):
        FlightSelectionRequest.model_validate({"searchId": "'; drop table--", "fareId": "P"})


def test_traveller_request_rejects_price_fields() -> None:
    with pytest.raises(ValidationError):
        TravellerDetailsRequest.model_validate(
            {
                "reviewToken": new_token(),
                "travellers": [_traveller()],
                "contact": {"email": "a@b.com", "phone": "+919999999999"},
                "totalAmount": 1,
            }
        )


def test_expired_passport_is_rejected() -> None:
    with pytest.raises(ValidationError):
        TravellerInput.model_validate(
            {
                **_traveller(),
                "passportNumber": "A1234567",
                "passportExpiry": "2020-01-01",
                "passportIssuingCountry": "IN",
            }
        )


def test_passport_number_without_expiry_is_rejected() -> None:
    with pytest.raises(ValidationError):
        TravellerInput.model_validate({**_traveller(), "passportNumber": "A1234567"})


def test_invalid_name_is_rejected() -> None:
    with pytest.raises(ValidationError):
        TravellerInput.model_validate({**_traveller(), "firstName": "<script>alert(1)</script>"})


def test_contact_normalizes_email_and_phone() -> None:
    contact = ContactInput.model_validate({"email": " AB@Example.COM ", "phone": "+91 99999-99999"})
    assert contact.email == "ab@example.com"
    assert contact.phone == "+919999999999"


# -- ownership ---------------------------------------------------------------


def _session(**overrides: Any) -> ReviewSession:
    base: dict[str, Any] = dict(
        id="sess-1",
        review_token=new_token(),
        user_id=None,
        guest_token_hash=None,
        flight_search_id=SEARCH_ID,
        provider_price_ref="PRICE-1",
        provider_booking_ref="TJ-BK-1",
        searched_amount=Decimal("8450.00"),
        total_amount=Decimal("8450.00"),
        base_amount=Decimal("7000.00"),
        tax_amount=Decimal("1450.00"),
        currency="INR",
        adults=1,
        children=0,
        infants=0,
        status="reviewed",
        itinerary={},
        requirements={},
        booking_id=None,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    base.update(overrides)
    return ReviewSession(**base)


def test_other_user_cannot_own_a_user_session() -> None:
    session = _session(user_id="user-a")
    assert service._owns(session, AuthContext(user_id="user-a"), None) is True
    assert service._owns(session, AuthContext(user_id="user-b"), None) is False
    assert service._owns(session, AuthContext(user_id=None), None) is False


def test_guest_session_requires_matching_guest_token() -> None:
    token = new_token()
    session = _session(guest_token_hash=hash_token(token))
    assert service._owns(session, AuthContext(user_id=None), token) is True
    assert service._owns(session, AuthContext(user_id=None), new_token()) is False
    assert service._owns(session, AuthContext(user_id=None), None) is False


def test_guest_token_is_stored_hashed_only() -> None:
    token = new_token()
    session = _session(guest_token_hash=hash_token(token))
    assert token not in (session.guest_token_hash or "")
    assert len(session.guest_token_hash or "") == 64


def test_tokens_are_unpredictable() -> None:
    tokens = {new_token() for _ in range(200)}
    assert len(tokens) == 200
    assert all(len(t) >= 40 for t in tokens)


# -- passenger + requirement enforcement -------------------------------------


def test_traveller_count_must_match_search() -> None:
    session = _session(adults=2, children=1, infants=0)
    with pytest.raises(service.TravellerMismatchError):
        service._validate_travellers(
            [TravellerInput.model_validate(_traveller())], session, TravellerRequirements()
        )


def test_matching_traveller_counts_pass() -> None:
    session = _session(adults=1)
    service._validate_travellers(
        [TravellerInput.model_validate(_traveller())], session, TravellerRequirements()
    )


def test_passport_requirement_blocks_incomplete_traveller() -> None:
    session = _session()
    with pytest.raises(service.TravellerDetailsIncompleteError):
        service._validate_travellers(
            [TravellerInput.model_validate(_traveller())],
            session,
            TravellerRequirements(passport_required=True, international=True),
        )


def test_child_without_date_of_birth_is_rejected() -> None:
    session = _session(adults=1, children=1)
    with pytest.raises(service.TravellerDetailsIncompleteError):
        service._validate_travellers(
            [
                TravellerInput.model_validate(_traveller()),
                TravellerInput.model_validate(
                    {**_traveller(date_of_birth=None), "type": "child"}
                ),
            ],
            session,
            TravellerRequirements(),
        )


# -- response shaping --------------------------------------------------------


def test_price_increase_surfaces_as_price_changed() -> None:
    session = _session(searched_amount=Decimal("8000.00"), total_amount=Decimal("8450.00"))
    response = service._to_response(session, guest_token=None)
    assert response.status == "price_changed"
    assert response.price_change is not None
    assert response.price_change.direction == "increase"
    assert response.price_change.difference.amount == pytest.approx(450.0)
    assert response.fare.total_price.amount == pytest.approx(8450.0)


def test_unchanged_price_has_no_price_change_block() -> None:
    response = service._to_response(_session(), guest_token=None)
    assert response.status == "reviewed"
    assert response.price_change is None


def test_response_never_leaks_provider_or_internal_ids() -> None:
    session = _session(user_id="user-a")
    payload = service._to_response(session, guest_token=None).model_dump_json(by_alias=True)
    assert "PRICE-1" not in payload
    assert "TJ-BK-1" not in payload
    assert "sess-1" not in payload
    assert "user-a" not in payload


def test_guest_token_is_returned_only_at_creation() -> None:
    token = new_token()
    assert service._to_response(_session(), guest_token=token).guest_token == token
    assert service._to_response(_session(), guest_token=None).guest_token is None


def test_expired_session_reports_zero_validity() -> None:
    session = _session(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    assert session.expired is True
    assert service._to_response(session, guest_token=None).valid_for_seconds == 0


def _traveller(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "adult",
        "title": "Mr",
        "firstName": "Arjun",
        "lastName": "Mehta",
        "dateOfBirth": "1990-05-04",
        "gender": "male",
    }
    for key, value in overrides.items():
        camel = key.split("_")[0] + "".join(part.title() for part in key.split("_")[1:])
        if value is None:
            base.pop(camel, None)
        else:
            base[camel] = value
    return base


_ = Optional
