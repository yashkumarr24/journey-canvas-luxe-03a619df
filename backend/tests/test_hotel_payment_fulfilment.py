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


def test_worker_database_check_to_existing_wire_flow_timeout_no_rebook(monkeypatch):
    from app.integrations.tripjack import hotel_booking as wire
    from app.integrations.tripjack.exceptions import TripJackTimeoutError

    port, p, subject, b = fixture(monkeypatch)
    b.stay = {"rooms": [{"adults": 1}]}
    b.guests = [dict(room_index=1, type="adult", title="Mr", first_name="Test", last_name="Guest")]
    b.contact = dict(email="guest@example.test", phone="9876543210", dial_code="+91")

    async def transition(record, target, event, **values):
        if not hb.can_transition(record.status, target):
            raise hb.HotelBookingStateError()
        record.status = target
        for key, value in values.items():
            setattr(record, key, value)
        return True

    async def save(record, **values):
        for key, value in values.items():
            setattr(record, key, value)

    port.store.transition = transition
    port.store.save = save
    booker = SimpleNamespace(post=AsyncMock(side_effect=TripJackTimeoutError()))
    monkeypatch.setattr(hb, "provider_factory", lambda s: hb.Provider(None, booker))
    monkeypatch.setattr(hb, "_fresh_review", AsyncMock(return_value=wire.FreshReview(
        booking_id="private-provider", total=4999.50, onhold_allowed=False,
        pan_required=False, passport_required=False, gst_type=None, hold_deadline=None)))
    job = dict(subject_type="hotel", subject_ref=b.booking_reference, payment_id="p1", attempts=1)
    assert asyncio.run(fulfil._run_hotel(job, port))[0] == "uncertain"
    assert b.status == hb.BOOKING_IN_PROGRESS
    assert booker.post.await_args.args[0] == wire.HOTEL_BOOK_PATH
    assert booker.post.await_args.args[1]["paymentInfos"] == [{"amount": 4999.50}]
    # Read-only reconciliation after the timeout, never another Book send.
    b.last_checked_at = hb._iso(hb._now())
    job["attempts"] = 2
    assert asyncio.run(fulfil._run_hotel(job, port))[0] == "uncertain"
    assert booker.post.await_count == 1

# ---------------------------------------------------------------- production --

PROD = dict(is_production=True, payu_env="production", payu_production_approved=True,
            hotel_production_fulfilment_enabled=True, tripjack_api_key="flight-uat-only",
            tripjack_hotel_api_key="hotel-prod-only",
            tripjack_base_url="https://apitest.tripjack.com",
            tripjack_hotel_base_url="https://hms-search.tripjack.com",
            tripjack_hotel_booker_url="https://hms-booker.tripjack.com")


def prod_fixture(monkeypatch, **changes):
    port, p, subject, b = fixture(monkeypatch)
    for key, value in {**PROD, **changes}.items():
        setattr(port.settings, key, value)
    return port, p, subject, b


def test_production_hosts_use_hotel_key_and_flight_stays_uat(monkeypatch):
    from app.integrations.tripjack.config import (
        build_config, build_hotel_booker_config, build_hotel_config)
    port, *_ = prod_fixture(monkeypatch)
    assert port.available
    hms, oms = build_hotel_config(port.settings), build_hotel_booker_config(port.settings)
    assert (hms.base_url, hms.api_key) == ("https://hms-search.tripjack.com", "hotel-prod-only")
    assert (oms.base_url, oms.api_key) == ("https://hms-booker.tripjack.com", "hotel-prod-only")
    flight = build_config(port.settings)
    assert (flight.base_url, flight.api_key) == ("https://apitest.tripjack.com", "flight-uat-only")


@pytest.mark.parametrize("changes", [
    dict(hotel_production_fulfilment_enabled=False), dict(payment_fulfilment_enabled=False),
    dict(payments_enabled=False), dict(payu_env="test"), dict(payu_production_approved=False),
    dict(is_production=False), dict(tripjack_hotel_api_key=""),
    dict(tripjack_hotel_booker_url="https://apitest-hotel-booker.tripjack.com"),
    dict(tripjack_hotel_base_url="https://hms-booker.tripjack.com"),
    dict(tripjack_hotel_booker_url="https://hms-booker.tripjack.com.evil.test"),
    dict(tripjack_hotel_base_url="http://hms-search.tripjack.com"),
])
def test_production_requires_every_gate(monkeypatch, changes):
    port, *_ = prod_fixture(monkeypatch, **changes)
    repo = SimpleNamespace(claim_jobs=AsyncMock())
    assert asyncio.run(fulfil.run_once(repo, port.settings, hotel=port)) == []
    repo.claim_jobs.assert_not_awaited()


def test_flag_defaults_are_off():
    s = Settings(_env_file=None)
    assert s.payments_enabled is False and s.payment_fulfilment_enabled is False
    assert s.hotel_production_fulfilment_enabled is False and s.payu_production_approved is False


def test_production_book_passes_database_proof_not_boolean(monkeypatch):
    port, p, subject, b = prod_fixture(monkeypatch)
    loaded = AsyncMock(return_value=b)
    monkeypatch.setattr(hb, "_book_loaded", loaded)
    asyncio.run(port.book(b.booking_reference, "payu:p1"))
    kw = loaded.await_args.kwargs
    assert kw["payment_verified"] is False and kw["mode"] == "instant"
    proof = kw["verified_payment"]
    assert (proof.payment_id, proof.hotel_booking_id, proof.reference, str(proof.amount),
            proof.currency) == ("p1", "hotel1", b.booking_reference, "4999.50", "INR")


@pytest.mark.parametrize("field,value", [("status", "authorized"), ("amount", "4999.00"),
    ("currency", "USD"), ("hotel_booking_id", "other"), ("user_id", "u2")])
def test_production_mismatch_never_reaches_book(monkeypatch, field, value):
    port, p, subject, b = prod_fixture(monkeypatch)
    p[field] = value
    loaded = AsyncMock()
    monkeypatch.setattr(hb, "_book_loaded", loaded)
    with pytest.raises(HotelPaymentMismatch):
        asyncio.run(port.book(b.booking_reference, "payu:p1"))
    loaded.assert_not_awaited()


def test_lifecycle_gate_rejects_production_without_matching_proof(monkeypatch):
    port, p, subject, b = prod_fixture(monkeypatch)
    good = hb.VerifiedHotelPayment("p1", "hotel1", b.booking_reference,
                                   hb.Decimal("4999.50"), "INR")
    hb._production_actions_gate(port.settings, b=b, mode="instant", verified_payment=good)
    hb._payment_gate(port.settings, payment_verified=False, b=b, verified_payment=good)
    for bad, mode in [(None, "instant"), (good, "hold"),
                      (hb.VerifiedHotelPayment("p1", "other", b.booking_reference, good.amount, "INR"), "instant"),
                      (hb.VerifiedHotelPayment("p1", "hotel1", b.booking_reference, hb.Decimal("1.00"), "INR"), "instant"),
                      (SimpleNamespace(**good.__dict__), "instant")]:
        with pytest.raises(hb.HotelBookingUnavailableError):
            hb._production_actions_gate(port.settings, b=b, mode=mode, verified_payment=bad)
    # Browser route and hold confirmation never carry proof: refused in production.
    with pytest.raises(hb.HotelBookingUnavailableError):
        hb._production_actions_gate(port.settings)
    with pytest.raises(hb.HotelPaymentRequiredError):
        hb._payment_gate(port.settings, payment_verified=True)
    port.settings.hotel_production_fulfilment_enabled = False
    with pytest.raises(hb.HotelBookingUnavailableError):
        hb._production_actions_gate(port.settings, b=b, mode="instant", verified_payment=good)


def test_production_timeout_never_rebooks_and_hold_goes_to_manual_review(monkeypatch):
    from app.integrations.tripjack import hotel_booking as wire
    from app.integrations.tripjack.exceptions import TripJackTimeoutError

    port, p, subject, b = prod_fixture(monkeypatch)
    b.stay = {"rooms": [{"adults": 1}]}
    b.guests = [dict(room_index=1, type="adult", title="Mr", first_name="Test", last_name="Guest")]
    b.contact = dict(email="guest@example.test", phone="9876543210", dial_code="+91")

    async def transition(record, target, event, **values):
        if not hb.can_transition(record.status, target):
            raise hb.HotelBookingStateError()
        record.status = target
        for key, value in values.items():
            setattr(record, key, value)
        return True

    async def save(record, **values):
        for key, value in values.items():
            setattr(record, key, value)

    port.store.transition, port.store.save = transition, save
    booker = SimpleNamespace(post=AsyncMock(side_effect=TripJackTimeoutError()))
    monkeypatch.setattr(hb, "provider_factory", lambda s: hb.Provider(None, booker))
    monkeypatch.setattr(hb, "_fresh_review", AsyncMock(return_value=wire.FreshReview(
        booking_id="private-provider", total=4999.50, onhold_allowed=False,
        pan_required=False, passport_required=False, gst_type=None, hold_deadline=None)))
    job = dict(subject_type="hotel", subject_ref=b.booking_reference, payment_id="p1", attempts=1)
    assert asyncio.run(fulfil._run_hotel(job, port))[0] == "uncertain"
    assert booker.post.await_args.args[1]["paymentInfos"] == [{"amount": 4999.50}]
    b.last_checked_at = hb._iso(hb._now())
    job["attempts"] = fulfil.MAX_UNCERTAIN_ATTEMPTS
    repo = SimpleNamespace(claim_jobs=AsyncMock(return_value=[dict(job, id="j1")]), update_job=AsyncMock())
    assert asyncio.run(fulfil.run_once(repo, port.settings, hotel=port)) == ["manual_review"]
    assert booker.post.await_count == 1
    # A paid booking that only reached ON_HOLD is never auto-confirmed.
    b.status = hb.ON_HOLD
    assert asyncio.run(fulfil._run_hotel(dict(job, attempts=1), port))[0] == "manual_review"
    assert booker.post.await_count == 1
