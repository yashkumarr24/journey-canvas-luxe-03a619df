"""UAT hold-confirm diagnostic. Mocks only — no real TripJack call."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.diagnostics import hotel_hold_confirm as diag
from app.integrations.tripjack import hotel_booking as wire
from app.services import hotel_booking as bk
from tests.test_hotel_booking import FUTURE, PAST, TOTAL, FakeBooker, details, ok, settings

SECRET_BID = "TJ-SECRET-BID-77"
SECRETS = (SECRET_BID, "SECRET-OPT", "SECRET-HID", "Asha", "ABCDE1234F", "ops@secret.test", "9876500000",
           "HCN-SECRET")


async def no_sleep(_):
    return None


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    bk._memory.by_ref.clear()
    bk._memory.events.clear()
    monkeypatch.setattr(diag, "build_hotel_booker_config", lambda s: SimpleNamespace(targets_production=False))
    yield


@pytest.fixture
def booker(monkeypatch):
    b = FakeBooker()
    monkeypatch.setattr(bk, "provider_factory", lambda s: bk.Provider(None, b))
    return b


def seed(status=bk.ON_HOLD, deadline=FUTURE, bid=SECRET_BID):
    b = bk.HotelBooking(
        booking_reference="FNFHTEST01", review_token="t" * 48, provider_hotel_id="SECRET-HID",
        provider_option_id="SECRET-OPT", total_amount=TOTAL, status=status, mode="HOLD",
        provider_booking_id=bid, hold_deadline=deadline,
        guests=[{"first_name": "Asha", "pan_number": "ABCDE1234F"}],
        contact={"email": "ops@secret.test", "phone": "9876500000"},
    )
    bk._memory.by_ref[b.booking_reference] = b
    return b


def run(**kw):
    base = dict(reference="fnfhtest01", execute=True, confirm=diag.CONFIRM_PHRASE, max_seconds=10,
                settings=settings(), sleep=no_sleep)
    base.update(kw)
    return asyncio.run(diag.run(**base))


def _no_secrets(out):
    for s in SECRETS:
        assert s not in out


def test_confirm_then_poll_until_confirmed(booker, capsys):
    seed()
    booker.replies = [ok(SECRET_BID), details("PENDING"), details("SUCCESS", conf="HCN-SECRET")]
    assert run() == diag.OUTCOME_CONFIRMED
    paths = [p for p, _ in booker.calls]
    assert paths == [wire.HOTEL_CONFIRM_BOOK_PATH, wire.HOTEL_BOOKING_DETAILS_PATH, wire.HOTEL_BOOKING_DETAILS_PATH]
    assert bk._memory.by_ref["FNFHTEST01"].status == bk.CONFIRMED
    out = capsys.readouterr().out
    assert "OUTCOME: CONFIRMED" in out and '"hotel_confirmation_number_present": true' in out
    _no_secrets(out)


def test_poll_failed(booker, capsys):
    seed()
    booker.replies = [ok(SECRET_BID), details("FAILED")]
    assert run() == diag.OUTCOME_FAILED
    _no_secrets(capsys.readouterr().out)


def test_poll_timeout(booker, capsys):
    seed()
    booker.replies = [ok(SECRET_BID)] + [details("PENDING")] * 10
    assert run(max_seconds=10) == diag.OUTCOME_TIMEOUT
    assert bk._memory.by_ref["FNFHTEST01"].status == bk.CONFIRMING
    assert "OUTCOME: TIMEOUT" in capsys.readouterr().out


def test_confirm_rejected_stays_on_hold(booker):
    seed()
    booker.replies = [{"status": {"success": False}, "errors": [{"errCode": "999"}]}]
    assert run() == diag.OUTCOME_STILL_ON_HOLD
    assert bk._memory.by_ref["FNFHTEST01"].status == bk.ON_HOLD


def test_dry_run_makes_no_call(booker, capsys):
    seed()
    assert run(execute=False) == "DRY_RUN"
    assert booker.calls == []
    _no_secrets(capsys.readouterr().out)


def test_phrase_required(booker):
    seed()
    with pytest.raises(SystemExit, match="CONFIRM-UAT-HOLD"):
        run(confirm="yes")
    assert booker.calls == []


@pytest.mark.parametrize("status", [bk.CONFIRMED, bk.CANCELLED, bk.FAILED, bk.CONFIRMING, bk.DRAFT])
def test_only_on_hold_can_be_confirmed(booker, status):
    seed(status=status)
    with pytest.raises(SystemExit, match="not ON_HOLD"):
        run()
    assert booker.calls == []


def test_expired_hold_refused(booker):
    seed(deadline=PAST)
    with pytest.raises(SystemExit, match="deadline"):
        run()
    assert booker.calls == []


def test_unknown_reference(booker):
    with pytest.raises(SystemExit, match="not found"):
        run(reference="NOPE")


def test_missing_provider_booking(booker):
    seed(bid=None)
    with pytest.raises(SystemExit, match="no provider booking"):
        run()


def test_refused_in_production(booker):
    seed()
    with pytest.raises(SystemExit, match="production"):
        run(settings=settings(prod=True))
    assert booker.calls == []


def test_refused_on_production_booker_host(booker, monkeypatch):
    seed()
    monkeypatch.setattr(diag, "build_hotel_booker_config", lambda s: SimpleNamespace(targets_production=True))
    with pytest.raises(SystemExit, match="PRODUCTION"):
        run()
    assert booker.calls == []


def test_safe_view_has_no_sensitive_fields():
    v = diag.safe_view(seed())
    _no_secrets(json.dumps(v))
    assert "guests" not in v and "contact" not in v
