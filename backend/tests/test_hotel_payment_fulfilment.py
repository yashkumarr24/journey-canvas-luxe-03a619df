"""Hotel fulfillment checks: mocked database/provider seams, no outbound access."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.services import hotel_booking as hb
from app.services import payment_fulfilment as fulfil
from app.services.hotel_payment_fulfilment import DatabaseHotelPort, HotelPaymentMismatch
from app.core.config import Settings
from tests.test_payu_payments import settings, FakeHotel


@pytest.fixture(autouse=True)
def no_http(monkeypatch):
    async def blocked(*args, **kwargs):
        raise AssertionError("outbound request forbidden")
    monkeypatch.setattr(httpx.AsyncClient, "send", blocked)


def fixture(monkeypatch, guest=False):
    b = hb.HotelBooking(booking_reference="FNFHABC123", review_token="review",
                        provider_hotel_id="h", provider_option_id="o", total_amount=4999.50,
                        row_id="hotel1", user_id=None if guest else "u1",
                        guest_token_hash="a" * 64 if guest else None)
    subject = dict(kind="hotel", id=b.row_id, reference=b.booking_reference,
                   user_id=b.user_id, guest_token_hash=b.guest_token_hash,
                   amount="4999.50", currency="INR")
    p = dict(id="p1", hotel_booking_id="hotel1", booking_id=None, provider="payu",
             status="captured", verified_at="2026-11-07T23:00:00+00:00",
             verification_source="webhook", raw_status="success", txnid="transaction",
             provider_mihpayid="mih", provider_payment_id="mih", amount="4999.50",
             currency="INR", amount_refunded="0")
    repo = SimpleNamespace(payment_by_id=AsyncMock(return_value=p),
                           subject_for_payment=AsyncMock(return_value=subject))
    store = SimpleNamespace(repo=object(), get=AsyncMock(return_value=b))
    monkeypatch.setattr(hb, "BookingStore", lambda s: store)
    cfg = settings(tripjack_api_key="test-only")
    # Supply non-secret config defaults without reading any .env file.
    defaults = Settings(_env_file=None).model_dump()
    for key, value in defaults.items():
        if not hasattr(cfg, key):
            setattr(cfg, key, value)
    port = DatabaseHotelPort(cfg, repo)
    return port, p, subject, b


@pytest.mark.parametrize("guest", [False, True])
def test_direct_hotel_fk_authorizes_without_parent(monkeypatch, guest):
    port, p, subject, b = fixture(monkeypatch, guest)
    assert asyncio.run(port.authorize_job(dict(payment_id="p1", subject_type="hotel",
                                               subject_ref=b.booking_reference))) is b
    assert p["booking_id"] is None


@pytest.mark.parametrize("field,value", [
    ("id", "other"), ("hotel_booking_id", "other"), ("hotel_booking_id", None),
    ("booking_id", "parent"), ("provider", "manual"), ("status", "pending"),
    ("verified_at", None), ("verification_source", "browser"), ("raw_status", "pending"),
    ("txnid", None), ("provider_mihpayid", None), ("provider_payment_id", "different"),
    ("amount", "4999.51"), ("amount", "4999.501"), ("amount", "NaN"),
    ("amount", "0"), ("currency", "USD"), ("amount_refunded", "1"), ("user_id", "u2"),
])
def test_payment_mismatch_never_books(monkeypatch, field, value):
    port, p, subject, b = fixture(monkeypatch)
    p[field] = value
    called = AsyncMock()
    monkeypatch.setattr(hb, "_book_loaded", called)
    with pytest.raises(HotelPaymentMismatch):
        asyncio.run(port.book(b.booking_reference, "payu:p1"))
    called.assert_not_awaited()


@pytest.mark.parametrize("field,value", [("reference", "different"), ("id", "other"),
    ("user_id", "u2"), ("currency", "USD"), ("amount", "5000.00"), ("kind", "flight")])
def test_resolved_subject_must_match_hotel(monkeypatch, field, value):
    port, p, subject, b = fixture(monkeypatch)
    subject[field] = value
    with pytest.raises(HotelPaymentMismatch):
        asyncio.run(port.authorize_job(dict(payment_id="p1", subject_type="hotel",
                                            subject_ref=b.booking_reference)))


def test_guest_hash_mismatch_not_reference_email_auth(monkeypatch):
    port, p, subject, b = fixture(monkeypatch, True)
    subject["guest_token_hash"] = "b" * 64
    with pytest.raises(HotelPaymentMismatch):
        asyncio.run(port._validated("p1", b.booking_reference))


def test_database_checked_again_before_loaded_flow_no_boolean_shortcut(monkeypatch):
    port, p, subject, b = fixture(monkeypatch)
    loaded = AsyncMock(return_value=b)
    monkeypatch.setattr(hb, "_book_loaded", loaded)
    asyncio.run(port.authorize_job(dict(payment_id="p1", subject_type="hotel", subject_ref=b.booking_reference)))
    assert asyncio.run(port.book(b.booking_reference, "payu:p1")) is b
    assert port.repo.payment_by_id.await_count == 2
    assert loaded.await_args.kwargs["payment_verified"] is False
    assert loaded.await_args.kwargs["mode"] == "instant"


@pytest.mark.parametrize("changes", [
    dict(is_production=True), dict(payment_fulfilment_enabled=False),
    dict(tripjack_hotel_base_url="https://hms-search.tripjack.com", tripjack_hotel_booker_url="https://hms-booker.tripjack.com"),
    dict(tripjack_hotel_base_url="https://hms-search.tripjack.com"),
    dict(tripjack_hotel_base_url="http://apitest-hms.tripjack.com"),
    dict(tripjack_hotel_base_url="https://apitest-hotel-booker.tripjack.com"),
])
def test_production_invalid_hosts_and_disabled_flag_never_claim(monkeypatch, changes):
    port, p, subject, b = fixture(monkeypatch)
    port.settings = settings(tripjack_api_key="test-only", **changes)
    repo = SimpleNamespace(claim_jobs=AsyncMock())
    assert asyncio.run(fulfil.run_once(repo, port.settings, hotel=port)) == []
    repo.claim_jobs.assert_not_awaited()


def test_hotel_host_check_independent_of_flight(monkeypatch):
    port, *_ = fixture(monkeypatch)
    port.settings.tripjack_base_url = "https://flight-not-used.example.test"
    assert port.available


def test_reclaimed_draft_is_never_rebooked():
    hotel = FakeHotel()
    result = asyncio.run(fulfil._run_hotel(dict(subject_ref="ref", payment_id="p1", attempts=2), hotel))
    assert result == ("manual_review", "hotel_prior_attempt_unresolved")
    assert hotel.book_calls == 0


def test_evidence_failure_is_manual_review_not_refundable(monkeypatch):
    port, p, subject, b = fixture(monkeypatch)
    p["status"] = "pending"
    result = asyncio.run(fulfil._run_hotel(dict(subject_type="hotel", subject_ref=b.booking_reference,
                                              payment_id="p1", attempts=1), port))
    assert result == ("manual_review", "HOTEL_PAYMENT_EVIDENCE_MISMATCH")


def test_uncertain_response_only_refreshes():
    hotel = FakeHotel(book_result="BOOKING_IN_PROGRESS")
    job = dict(subject_ref="ref", payment_id="p1", attempts=1)
    assert asyncio.run(fulfil._run_hotel(job, hotel))[0] == "uncertain"
    hotel.refresh_to = "CONFIRMED"
    job["attempts"] = 2
    assert asyncio.run(fulfil._run_hotel(job, hotel))[0] == "succeeded"
    assert hotel.book_calls == 1 and hotel.refresh_calls == 1