"""Offline mocks only. No Settings(), .env, production API or real database."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import payu_handoff as api
from app.core.auth import AuthContext
from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.services import payu_handoff as svc
from tests.test_payu_payments import FakeRepo, FakeClient, settings


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    async def blocked(*a, **k):
        raise AssertionError("External network forbidden")
    monkeypatch.setattr(httpx.AsyncClient, "request", blocked)


def config(**kw):
    return settings(payu_handoff_enabled=True, public_site_url="https://staging.example.test", **kw)


class Store:
    def __init__(self):
        self.rows = {}
    async def insert(self, row):
        if any(r["payment_id"] == row["payment_id"] for r in self.rows.values()):
            return False
        self.rows[row["token_hash"]] = dict(row)
        return True
    async def consume(self, digest):
        row = self.rows.get(digest)
        if not row or row.get("consumed") or datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
            return None
        row["consumed"] = True
        return {"payment_id": row["payment_id"]}


def run(c):
    return asyncio.run(c)


def issue(repo, store, cfg=None):
    return run(svc.issue(repo, store, FakeClient(), cfg or config(),
        booking_reference="FNFHABC123", auth=AuthContext("u1"), guest_token=None))


def test_switch_defaults_off_without_loading_environment():
    assert Settings.model_fields["payu_handoff_enabled"].default is False
    with pytest.raises(svc.HandoffUnavailable):
        svc.require_enabled(SimpleNamespace(payu_handoff_enabled=False, public_site_url="https://staging.example.test"))


@pytest.mark.parametrize("changes", [{"is_production": True}, {"payu_env": "production"},
    {"public_site_url": "https://www.flynfeelholiday.com"}, {"public_site_url": "https://flynfeelholiday.com"}])
def test_production_rejected(changes):
    cfg = config()
    for k, v in changes.items(): setattr(cfg, k, v)
    with pytest.raises(svc.HandoffUnavailable): svc.require_enabled(cfg)


def test_digest_only_storage_and_single_use_html():
    repo, store = FakeRepo(), Store()
    response = issue(repo, store)
    token = response["handoffUrl"].split("#token=")[1]
    row = store.rows[svc.token_digest(token)]
    assert set(row) == {"token_hash", "payment_id", "expires_at"}
    html, headers = run(svc.redeem(repo, store, FakeClient(), config(), token))
    assert 'action="https://test.payu.in/_payment"' in html
    assert 'name="txnid" value="' + repo.payments[0]["txnid"] + '"' in html
    assert token not in html
    assert headers["Cache-Control"] == "no-store"
    with pytest.raises(svc.HandoffUnavailable): run(svc.redeem(repo, store, FakeClient(), config(), token))
    assert len(repo.payments) == 1 and repo.capture_calls == 0


def test_expiry_never_reorders():
    repo, store = FakeRepo(), Store()
    response = issue(repo, store)
    token = response["handoffUrl"].split("#token=")[1]
    store.rows[svc.token_digest(token)]["expires_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    with pytest.raises(svc.HandoffUnavailable): run(svc.redeem(repo, store, FakeClient(), config(), token))
    with pytest.raises(svc.HandoffUnavailable): issue(repo, store)
    assert len(repo.payments) == 1


@pytest.mark.parametrize("status", ["failed", "pending", "captured", "created"])
def test_existing_attempt_never_creates_another(status):
    repo, store = FakeRepo(), Store()
    issue(repo, store)
    repo.payments[0]["status"] = status
    with pytest.raises(svc.HandoffUnavailable): issue(repo, store)
    assert len(repo.payments) == 1


def test_wrong_owner_cannot_issue():
    with pytest.raises(Exception) as exc:
        issue(FakeRepo(user_id="other"), Store())
    assert exc.value.code == "BOOKING_NOT_FOUND"


def test_missing_storage_fails_without_second_order():
    repo = FakeRepo()
    store = SimpleNamespace(insert=AsyncMock(return_value=False))
    with pytest.raises(svc.HandoffUnavailable): issue(repo, store)
    assert len(repo.payments) == 1
    with pytest.raises(svc.HandoffUnavailable): issue(repo, store)
    assert len(repo.payments) == 1


def test_redeem_http_form_response_and_replay(monkeypatch):
    repo, store = FakeRepo(), Store()
    response = issue(repo, store)
    token = response["handoffUrl"].split("#token=")[1]
    app = FastAPI()
    app.include_router(api.router)
    register_exception_handlers(app)
    app.dependency_overrides[get_settings] = lambda: config()
    monkeypatch.setattr(api, "PaymentsRepo", lambda _: repo)
    monkeypatch.setattr(api, "HandoffRepo", lambda _: store)
    monkeypatch.setattr(api.payments, "build_client", lambda _: FakeClient())
    with TestClient(app) as client:
        result = client.post("/api/v1/payments/handoff/redeem", data={"token": token})
        assert result.status_code == 200
        assert result.headers["content-type"].startswith("text/html")
        assert result.headers["referrer-policy"] == "no-referrer"
        assert client.post("/api/v1/payments/handoff/redeem", data={"token": token}).status_code == 409
    assert len(repo.payments) == 1


@pytest.mark.parametrize("change", ["captured", "cancelled", "amount", "currency"])
def test_changed_payment_or_booking_burns_token_without_charging(change):
    repo, store = FakeRepo(), Store()
    response = issue(repo, store)
    token = response["handoffUrl"].split("#token=")[1]
    if change == "captured": repo.payments[0]["status"] = "captured"
    elif change == "cancelled": repo.subject["status"] = "CANCELLED"
    elif change == "amount": repo.subject["amount"] = "1.00"
    else: repo.subject["currency"] = "USD"
    with pytest.raises(svc.HandoffUnavailable): run(svc.redeem(repo, store, FakeClient(), config(), token))
    assert store.rows[svc.token_digest(token)]["consumed"] is True
    assert len(repo.payments) == 1 and repo.capture_calls == 0


def test_same_payment_signed_fields_match_existing_website_builder():
    from app.services import payments
    repo, store, client, cfg = FakeRepo(), Store(), FakeClient(), config()
    response = issue(repo, store, cfg)
    token = response["handoffUrl"].split("#token=")[1]
    form = run(payments.create_order(repo, client, cfg, booking_reference="FNFHABC123",
                                     auth=AuthContext("u1"), guest_token=None))
    html, _ = run(svc.redeem(repo, store, client, cfg, token))
    from html import escape
    for key, value in form.fields.items():
        assert 'name="' + escape(key, quote=True) + '" value="' + escape(value, quote=True) + '"' in html
    assert len(repo.payments) == 1