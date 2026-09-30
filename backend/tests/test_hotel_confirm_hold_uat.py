"""Mocked tests for `hotel_listing_uat book --confirm-hold`. No real calls."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.diagnostics import hotel_listing_uat as diag

BID = "TGS-SECRET-BOOKING"


def _args(**kw):
    base = dict(confirm_hold=True, execute_uat_hold=True, confirm=diag.BOOK_CONFIRM_PHRASE, cancel_after=False)
    base.update(kw)
    return SimpleNamespace(**base)


def _details(status, amount=2136.07):
    return {"status": {"success": True}, "order": {"bookingId": BID, "status": status, "amount": amount}}


class FakePost:
    def __init__(self, confirm_reply, statuses):
        self.calls, self.confirm_reply, self.statuses = [], confirm_reply, list(statuses)

    async def __call__(self, config, path, payload):
        self.calls.append((path, payload))
        if path == diag.HOTEL_CONFIRM_BOOK_PATH:
            return 200, self.confirm_reply, 0.1
        return 200, _details(self.statuses.pop(0) if self.statuses else "PENDING"), 0.1


async def _nosleep(_):
    return None


def _run(post, **kw):
    return asyncio.run(diag.run_confirm_hold(None, BID, 2136.07, post=post, sleep=_nosleep, **kw))


OK = {"status": {"success": True}, "bookingId": BID}


def test_confirm_payload_and_confirmed(capsys):
    post = FakePost(OK, ["PENDING", "SUCCESS"])
    assert _run(post) == "CONFIRMED"
    path, payload = post.calls[0]
    assert path == "oms/v3/hotel/confirm-book"
    assert payload == {"bookingId": BID, "paymentInfos": [{"amount": 2136.07}]}
    assert [c[0] for c in post.calls[1:]] == [diag.HOTEL_BOOKING_DETAILS_PATH] * 2
    assert BID not in capsys.readouterr().out


def test_failed_status():
    assert _run(FakePost(OK, ["FAILED"])) == "FAILED"


def test_rejected_confirm_does_not_poll():
    post = FakePost({"status": {"success": False}, "errors": [{"errCode": "810"}]}, [])
    assert _run(post) == "REJECTED" and len(post.calls) == 1


def test_timeout_is_180s_at_5s():
    post = FakePost(OK, [])
    assert _run(post) == "TIMEOUT"
    assert len(post.calls) == 1 + 36


def test_amount_prefers_details_then_review():
    assert diag.confirm_amount({"order_amount": 100.0}, {}) == 100.0
    review = {"option": {"pricing": {"totalPrice": 55.5}}}
    assert diag.confirm_amount({"order_amount": None}, review) == 55.5
    assert diag.confirm_amount({}, {}) is None


def test_gates(monkeypatch):
    monkeypatch.setattr(diag, "_booker_base", lambda: "https://apitest-hotel-booker.tripjack.com")
    monkeypatch.setattr(diag, "get_settings", lambda: SimpleNamespace(is_production=False))
    diag.check_confirm_hold_args(_args())
    diag.check_confirm_hold_args(_args(confirm_hold=False, execute_uat_hold=False, confirm=""))
    for bad in (_args(execute_uat_hold=False), _args(confirm="nope"), _args(cancel_after=True)):
        with pytest.raises(SystemExit):
            diag.check_confirm_hold_args(bad)


def test_production_app_with_uat_endpoint_allowed(monkeypatch):
    """VPS stays APP_ENV=production; the UAT booker URL is what gates the diagnostic."""
    monkeypatch.setattr(diag, "_booker_base", lambda: diag.UAT_BOOKER_BASE_URL)
    monkeypatch.setattr(diag, "get_settings", lambda: SimpleNamespace(is_production=True))
    diag.check_confirm_hold_args(_args())


def test_production_endpoint_rejected(monkeypatch):
    monkeypatch.setattr(diag, "_booker_base", lambda: "https://apitest-other.tripjack.com")
    monkeypatch.setattr(diag, "get_settings", lambda: SimpleNamespace(is_production=True))
    with pytest.raises(SystemExit, match="UAT"):
        diag.check_confirm_hold_args(_args())
    monkeypatch.setattr(diag, "_booker_base", lambda: "https://hotel-booker.tripjack.com")
    with pytest.raises(SystemExit):
        diag.check_confirm_hold_args(_args())
