"""Isolated PayU package: proofs that payments run against the UNCHANGED
hotel/flight booking modules and can never reach TripJack.

Fakes only - no PayU, TripJack or database call is made. Every outbound HTTP
request is blocked and every TripJack-calling booking function is trapped.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
from pathlib import Path

import httpx
import pytest

from app.jobs import payments_worker
from app.repositories import bookings as bookings_repo
from app.services import flight_booking, hotel_booking
from app.services import payment_fulfilment as fulfil
from app.services import payments as svc
from tests.test_payu_payments import FakeClient, FakeHotel, _captured, settings

ROOT = Path(__file__).resolve().parents[1] / "app"
PAYMENT_MODULES = [
    "services/payments.py", "services/payment_fulfilment.py", "repositories/payments.py",
    "api/v1/payments.py", "jobs/payments_worker.py", "integrations/payu/client.py",
]
FORBIDDEN_IMPORTS = ("app.services.hotel_booking", "app.services.flight_booking",
                     "app.integrations.tripjack", "app.repositories.bookings",
                     "app.repositories.hotel_bookings")


def _imports(path: Path) -> set[str]:
    out = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module)
        elif isinstance(node, ast.Import):
            out.update(a.name for a in node.names)
    return out


def test_payment_modules_never_import_booking_or_tripjack_code():
    for rel in PAYMENT_MODULES:
        bad = [m for m in _imports(ROOT / rel) if m.startswith(FORBIDDEN_IMPORTS)]
        assert not bad, f"{rel} imports {bad}"


def test_protected_modules_are_the_pre_payment_versions():
    assert not hasattr(hotel_booking, "book_for_verified_payment")
    assert not hasattr(hotel_booking, "refresh_for_payment")
    assert not hasattr(hotel_booking, "_book_loaded")
    sig = inspect.signature(bookings_repo.BookingRepository.create_flight_draft) \
        if hasattr(bookings_repo.BookingRepository, "create_flight_draft") else None
    src = inspect.getsource(bookings_repo) + inspect.getsource(flight_booking)
    assert "guest_token_hash=None if auth.user_id" not in src
    assert sig is None or "guest_token_hash" not in sig.parameters


def test_app_and_worker_import_with_unchanged_booking_modules():
    from app.main import app
    paths = {getattr(r, "path", "") for r in app.routes}
    for p in ("/api/v1/payments/order", "/api/v1/payments/payu/return",
              "/api/v1/payments/status/{booking_reference}", "/api/v1/payments/refunds"):
        assert p in paths
    assert callable(payments_worker.tick)


def test_both_flags_default_off():
    from app.core.config import Settings
    s = Settings(_env_file=None)
    assert s.payments_enabled is False and s.payment_fulfilment_enabled is False


@pytest.fixture
def no_tripjack(monkeypatch):
    calls: list[str] = []

    async def blocked_send(self, request, *a, **k):
        calls.append(f"http:{request.url.host}")
        raise AssertionError("outbound HTTP attempted")

    monkeypatch.setattr(httpx.AsyncClient, "send", blocked_send)

    def trap(name):
        async def _t(*a, **k):
            calls.append(name)
            raise AssertionError(f"{name} called")
        return _t

    for mod, names in ((hotel_booking, ("book", "confirm_hold", "confirm_loaded_hold", "cancel",
                                        "get_booking", "poll_until_terminal", "create_draft")),):
        for n in names:
            if hasattr(mod, n):
                monkeypatch.setattr(mod, n, trap(f"hotel_booking.{n}"))
    for n, v in vars(flight_booking).items():
        if inspect.iscoroutinefunction(v) and not n.startswith("_"):
            monkeypatch.setattr(flight_booking, n, trap(f"flight_booking.{n}"))
    return calls


@pytest.mark.parametrize("fulfilment", [False, True])
def test_worker_never_calls_tripjack(monkeypatch, no_tripjack, fulfilment):
    repo, client = _captured("hotel", "DRAFT")
    monkeypatch.setattr(payments_worker, "get_settings",
                        lambda: settings(payment_fulfilment_enabled=fulfilment))
    monkeypatch.setattr(payments_worker, "PaymentsRepo", lambda s: repo)
    monkeypatch.setattr(svc, "build_client", lambda s: client)
    for _ in range(3):
        result = asyncio.run(payments_worker.tick())
        assert result["jobs"] == {}
    assert no_tripjack == []
    # Job never claimed: still refundable as provably unfulfilled.
    assert repo.jobs[0]["status"] == "queued" and repo.jobs[0]["attempts"] == 0
    assert repo.subject["status"] == "DRAFT"


def test_worker_skips_everything_when_payments_disabled(monkeypatch, no_tripjack):
    monkeypatch.setattr(payments_worker, "get_settings", lambda: settings(payments_enabled=False))
    assert asyncio.run(payments_worker.tick()) == {"skipped": {"payments_disabled": 1}}
    assert no_tripjack == []


def test_live_port_is_unavailable_and_refuses():
    port = fulfil.UninstalledHotelPort(settings())
    assert port.available is False
    with pytest.raises(RuntimeError):
        asyncio.run(port.book("FNFHABC123", "payu:p1"))


def test_refund_flow_makes_no_tripjack_call(no_tripjack):
    repo, client = _captured("hotel", "DRAFT")
    row = asyncio.run(svc.refund(repo, client, payment_id="p1", amount="4999.50", reason="test refund",
                                 staff_id="s", request_token="tokISOLATED",
                                 eligible=fulfil.refund_eligibility(repo)))
    assert row["status"] == "queued"
    assert no_tripjack == []


def test_payments_disabled_order_endpoint_returns_unavailable(monkeypatch):
    from fastapi.testclient import TestClient

    from app.core.config import get_settings
    from app.main import app
    app.dependency_overrides[get_settings] = lambda: settings(payments_enabled=False)
    try:
        r = TestClient(app).post("/api/v1/payments/order", json={"bookingReference": "FNFHABC123"})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 503


def test_future_port_still_needs_flag(no_tripjack):
    repo, _ = _captured("hotel", "DRAFT")
    hotel = FakeHotel()
    assert asyncio.run(fulfil.run_once(repo, settings(payment_fulfilment_enabled=False), hotel=hotel)) == []
    assert hotel.book_calls == 0
    _ = FakeClient
