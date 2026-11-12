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
    """Mirrors the proposal RPCs: digest-only, one active link, max 3, burn once."""
    def __init__(self):
        self.rows = {}
    async def chain(self, pid):
        n = sum(r["payment_id"] == pid for r in self.rows.values())
        return {"links": n} if n else None
    async def issue(self, pid, digest, expires_at):
        n = sum(r["payment_id"] == pid for r in self.rows.values())
        if n >= svc.MAX_LINKS:
            return False
        for r in self.rows.values():
            if r["payment_id"] == pid and not r.get("consumed"):
                r["revoked"] = True
        self.rows[digest] = {"token_hash": digest, "payment_id": pid, "expires_at": expires_at}
        return True
    async def consume(self, digest):
        row = self.rows.get(digest)
        if (not row or row.get("consumed") or row.get("revoked")
                or datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc)):
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
    # Expired link -> replacement for the SAME attempt, never a second order.
    fresh = tok(issue(repo, store))
    html, _ = run(svc.redeem(repo, store, FakeClient(), config(), fresh))
    assert 'value="' + repo.payments[0]["txnid"] + '"' in html
    assert len(repo.payments) == 1


@pytest.mark.parametrize("status", ["failed", "pending", "captured"])
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
    store = SimpleNamespace(issue=AsyncMock(return_value=False), chain=AsyncMock(return_value=None))
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

def tok(response):
    return response["handoffUrl"].split("#token=")[1]


def issue_with(repo, store, client, cfg=None):
    return run(svc.issue(repo, store, client, cfg or config(),
        booking_reference="FNFHABC123", auth=AuthContext("u1"), guest_token=None))


def test_replacement_reuses_same_txnid_and_revokes_previous_link():
    repo, store = FakeRepo(), Store()
    first = tok(issue(repo, store))
    second = tok(issue(repo, store))
    assert first != second and len(repo.payments) == 1
    with pytest.raises(svc.HandoffUnavailable):
        run(svc.redeem(repo, store, FakeClient(), config(), first))
    html, _ = run(svc.redeem(repo, store, FakeClient(), config(), second))
    assert 'name="txnid" value="' + repo.payments[0]["txnid"] + '"' in html


def test_replacements_are_bounded():
    repo, store = FakeRepo(), Store()
    for _ in range(svc.MAX_LINKS):
        issue(repo, store)
    with pytest.raises(svc.HandoffUnavailable): issue(repo, store)
    assert len(repo.payments) == 1


def test_replacement_refused_when_payu_has_seen_the_txnid():
    repo, store = FakeRepo(), Store()
    issue(repo, store)
    client = FakeClient(verified=("pending", "4999.50", "MIH1", "auth"))
    with pytest.raises(svc.HandoffUnavailable): issue_with(repo, store, client)
    assert client.verify_calls == 1 and len(repo.payments) == 1


def test_replacement_refused_when_payu_verify_fails():
    repo, store = FakeRepo(), Store()
    issue(repo, store)
    client = FakeClient()
    client.verify_payment = AsyncMock(side_effect=RuntimeError("unreachable"))
    with pytest.raises(svc.HandoffUnavailable): issue_with(repo, store, client)
    assert len(repo.payments) == 1


@pytest.mark.parametrize("status", ["pending", "captured", "failed"])
def test_pending_or_late_captured_attempt_gets_status_only(status):
    repo, store = FakeRepo(), Store()
    issue(repo, store)
    repo.payments[0]["status"] = status
    client = FakeClient()
    with pytest.raises(svc.HandoffUnavailable): issue_with(repo, store, client)
    assert client.verify_calls == 0 and len(repo.payments) == 1 and repo.jobs == []


def test_replacement_refused_after_attempt_window():
    repo, store = FakeRepo(), Store()
    issue(repo, store)
    repo.payments[0]["created_at"] = (datetime.now(timezone.utc) - svc.ATTEMPT_WINDOW
                                      - timedelta(seconds=1)).isoformat()
    with pytest.raises(svc.HandoffUnavailable): issue(repo, store)
    assert len(repo.payments) == 1


def test_website_started_attempt_never_gets_handoff():
    from app.services import payments
    repo, store, cfg = FakeRepo(), Store(), config()
    run(payments.create_order(repo, FakeClient(), cfg, booking_reference="FNFHABC123",
                              auth=AuthContext("u1"), guest_token=None))
    with pytest.raises(svc.HandoffUnavailable): issue(repo, store, cfg)
    assert store.rows == {} and len(repo.payments) == 1


def test_concurrent_redemption_only_one_form():
    repo, store = FakeRepo(), Store()
    token = tok(issue(repo, store))
    async def both():
        return await asyncio.gather(*(svc.redeem(repo, store, FakeClient(), config(), token)
                                      for _ in range(5)), return_exceptions=True)
    results = run(both())
    assert sum(isinstance(r, tuple) for r in results) == 1
    assert all(isinstance(r, svc.HandoffUnavailable) for r in results if not isinstance(r, tuple))
    assert len(repo.payments) == 1 and repo.capture_calls == 0


def test_concurrent_issue_creates_one_payment():
    repo, store = FakeRepo(), Store()
    async def both():
        return await asyncio.gather(*(svc.issue(repo, store, FakeClient(), config(),
            booking_reference="FNFHABC123", auth=AuthContext("u1"), guest_token=None)
            for _ in range(3)), return_exceptions=True)
    run(both())
    assert len(repo.payments) == 1


def prod(**kw):
    base = dict(payu_handoff_enabled=True, payu_handoff_production_approved=True,
                payu_production_approved=True, payu_env="production", is_production=True,
                public_site_url="https://www.flynfeelholiday.com")
    base.update(kw)
    return SimpleNamespace(**base)


def test_production_switch_defaults_off():
    assert Settings.model_fields["payu_handoff_production_approved"].default is False


@pytest.mark.parametrize("missing", ["payu_handoff_enabled", "payu_handoff_production_approved",
                                     "payu_production_approved", "is_production"])
def test_production_needs_every_approval(missing):
    with pytest.raises(svc.HandoffUnavailable): svc.require_enabled(prod(**{missing: False}))


def test_production_needs_consistent_payu_env():
    with pytest.raises(svc.HandoffUnavailable): svc.require_enabled(prod(payu_env="test"))
    svc.require_enabled(prod())   # capable once separately approved; not activated anywhere


def test_production_form_uses_only_production_payu_host():
    _, headers = svc.render_form("https://secure.payu.in/_payment", {"a": "b"})
    assert "form-action https://secure.payu.in;" in headers["Content-Security-Policy"]
    assert svc.expected_action(prod()) == "https://secure.payu.in/_payment"
