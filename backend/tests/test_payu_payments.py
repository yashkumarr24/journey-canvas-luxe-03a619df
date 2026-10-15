"""PayU payment rules. Fakes only - no PayU, TripJack or database call is ever made."""

from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.core.auth import AuthContext
from app.core.errors import AppError
from app.integrations.payu import client as payu
from app.integrations.payu.client import PayUClient, PayUError, VerifiedTxn
from app.repositories.reviews import hash_token
from app.services import payment_fulfilment as fulfil
from app.services import payments as svc

KEY, SALT = "TESTKEY", "TESTSALT"
UAT = dict(tripjack_base_url="https://apitest.tripjack.com",
           tripjack_hotel_base_url="https://apitest-hms.tripjack.com",
           tripjack_hotel_booker_url="https://apitest-hotel-booker.tripjack.com")


def run(c):
    return asyncio.run(c)


def settings(**kw):
    base = dict(payments_enabled=True, payu_env="test", payu_production_approved=False,
                payu_merchant_key=KEY, payu_merchant_salt=SALT,
                payu_return_base_url="https://api.example.test", is_production=False,
                payu_timeout=5.0, payu_webhook_secret_path="x",
                payment_fulfilment_enabled=True, **UAT)
    base.update(kw)
    return SimpleNamespace(**base)


class FakeRepo:
    def __init__(self, total="4999.50", status="DRAFT", kind="hotel", user_id="u1", guest_hash=None):
        ref = "FF-ABCD1234" if kind == "flight" else "FNFHABC123"
        self.subject = {"kind": kind, "id": "b1", "reference": ref, "user_id": user_id,
                        "guest_token_hash": guest_hash, "status": status, "currency": "INR",
                        "amount": total, "email": "a@b.co", "phone": ""}
        self.payments: list[dict] = []
        self.refunds: list[dict] = []
        self.jobs: list[dict] = []
        self.webhooks: set[str] = set()
        self.events: list[str] = []
        self.race = False

    async def subject_by_reference(self, ref):
        return self.subject if ref == self.subject["reference"] else None

    async def subject_for_payment(self, p):
        return self.subject

    async def open_payment_for(self, s):
        live = [p for p in self.payments if p["status"] in ("created", "pending", "captured")]
        return live[-1] if live else None

    async def latest_payment_for(self, s):
        return self.payments[-1] if self.payments else None

    async def payment_by_txnid(self, t):
        return next((p for p in self.payments if p["txnid"] == t), None)

    async def payment_by_id(self, i):
        return next((p for p in self.payments if p["id"] == i), None)

    async def create_payment(self, s, v):
        if self.race:  # a concurrent request inserted first; unique index rejects ours
            self.race = False
            self.payments.append({"id": "p0", "amount_refunded": "0", **v, "txnid": "WINNER"})
            return None
        if await self.open_payment_for(s):
            return None
        row = {"id": f"p{len(self.payments)+1}", "amount_refunded": "0",
               "created_at": datetime.now(timezone.utc).isoformat(), **v}
        self.payments.append(row)
        return row

    async def transition(self, pid, expected, values):
        p = await self.payment_by_id(pid)
        if p and p["status"] in expected:
            p.update(values)
            return True
        return False

    async def capture(self, pid, expected, *, mihpayid, source, raw_status):
        p = await self.payment_by_id(pid)
        if not p or p["status"] not in expected:
            return False
        p.update(status="captured", provider_mihpayid=mihpayid, provider_payment_id=mihpayid,
                 verification_source=source)
        if self.subject["kind"] == "flight" and self.subject["status"] in ("pending", "payment_pending"):
            self.subject["status"] = "payment_processing"
        if not any(j["payment_id"] == pid for j in self.jobs):
            self.jobs.append({"id": f"j{len(self.jobs)+1}", "payment_id": pid,
                              "subject_type": self.subject["kind"],
                              "subject_ref": self.subject["reference"], "status": "queued", "attempts": 0})
        return True

    async def set_flight_status(self, bid, expected, status):
        if self.subject["status"] in expected:
            self.subject["status"] = status
            return True
        return False

    async def stale_payments(self, cutoff, limit=50):
        return [p for p in self.payments if p["status"] in ("created", "pending")]

    async def add_refunded(self, pid, prev, total, status):
        p = await self.payment_by_id(pid)
        if p and svc.to_amount(p["amount_refunded"]) == prev:
            p.update(amount_refunded=total, status=status)
            return True
        return False

    async def record_webhook(self, k):
        new = k not in self.webhooks
        self.webhooks.add(k)
        return new

    async def claim_jobs(self, limit, lock):
        out = []
        for j in self.jobs:
            if j["status"] in ("queued", "uncertain"):
                j["status"], j["attempts"] = "running", j["attempts"] + 1
                out.append(dict(j))
        return out

    async def update_job(self, jid, values):
        next(j for j in self.jobs if j["id"] == jid).update(values)

    async def job_for_payment(self, pid):
        return next((j for j in self.jobs if j["payment_id"] == pid), None)

    async def refund_by_token(self, t):
        return next((r for r in self.refunds if r["request_token"] == t), None)

    async def reserve_refund(self, *, payment_id, amount, token, reason, staff_id):
        prior = await self.refund_by_token(token)
        if prior:
            return prior
        if any(r["status"] in ("requested", "unknown") for r in self.refunds):
            raise ValueError("refund_unresolved")
        p = await self.payment_by_id(payment_id)
        from decimal import Decimal
        reserved = sum((Decimal(r["amount"]) for r in self.refunds
                        if r["status"] in ("requested", "queued", "unknown", "success")), Decimal(0))
        if Decimal(amount) > Decimal(p["amount"]) - reserved:
            raise ValueError("refund_exceeds_balance")
        row = {"id": f"r{len(self.refunds)+1}", "payment_id": payment_id, "amount": amount,
               "request_token": token, "status": "requested", "provider_request_id": None}
        self.refunds.append(row)
        return row

    async def update_refund(self, i, v):
        next(r for r in self.refunds if r["id"] == i).update(v)

    async def refunds_to_check(self, limit=50):
        return [r for r in self.refunds if r["status"] in ("requested", "queued", "unknown")]

    async def record_event(self, s, t, m, status=None):
        self.events.append(t)


class FakeClient(PayUClient):
    def __init__(self, verified=None):
        super().__init__(key=KEY, salt=SALT, env="test")
        self.verified = verified
        self.verify_calls = 0
        self.refund_calls = 0
        self.refund_raises = False
        self.refund_status_body: dict = {}

    async def verify_payment(self, txnid):
        self.verify_calls += 1
        v = self.verified
        return VerifiedTxn(txnid, v[0], v[1], v[2]) if v else VerifiedTxn(txnid, "not_found", None, None)

    async def refund(self, mihpayid, token, amount):
        self.refund_calls += 1
        if self.refund_raises:
            raise PayUError("payu_unreachable")
        return {"status": 1, "request_id": "RQ1"}

    async def refund_status(self, rid):
        return self.refund_status_body


AUTH = AuthContext(user_id="u1")


async def always(payment, subject):
    return True


async def never(payment, subject):
    return False


def signed_return(fields, status="success", **extra):
    f = {k: fields[k] for k in ("txnid", "amount", "productinfo", "firstname", "email",
                                "udf1", "udf2", "udf3", "udf4", "udf5")}
    f.update(status=status, mihpayid="MIH1", **extra)
    f["hash"] = payu.response_hash(KEY, SALT, f)
    return f


def order(repo, client, **kw):
    ref = repo.subject["reference"]
    kw.setdefault("auth", AUTH)
    kw.setdefault("guest_token", None)
    return run(svc.create_order(repo, client, settings(), booking_reference=ref, **kw))


# ---- hashing (docs.payu.in hashing-request-and-response) -------------------

def test_request_hash_matches_documented_formula():
    f = {"txnid": "T1", "amount": "10.00", "productinfo": "P", "firstname": "A", "email": "a@b.co",
         "udf1": "FF-1"}
    raw = f"{KEY}|T1|10.00|P|A|a@b.co|FF-1||||||||||{SALT}"
    assert payu.request_hash(KEY, SALT, f) == hashlib.sha512(raw.encode()).hexdigest()


def test_response_hash_matches_documented_reverse_formula():
    f = {"status": "success", "txnid": "T1", "amount": "10.00", "productinfo": "P",
         "firstname": "A", "email": "a@b.co", "udf1": "FF-1"}
    raw = f"{SALT}|success||||||||||FF-1|a@b.co|A|P|10.00|T1|{KEY}"
    assert payu.response_hash(KEY, SALT, f) == hashlib.sha512(raw.encode()).hexdigest()


def test_response_hash_additional_charges_variant():
    f = {"status": "success", "txnid": "T1", "amount": "10.00", "productinfo": "P",
         "firstname": "A", "email": "a@b.co", "udf1": "FF-1", "additionalCharges": "2.50"}
    raw = f"2.50|{SALT}|success||||||||||FF-1|a@b.co|A|P|10.00|T1|{KEY}"
    assert payu.response_hash(KEY, SALT, f) == hashlib.sha512(raw.encode()).hexdigest()


def test_command_hash_formula():
    assert payu.command_hash(KEY, "verify_payment", "T1", SALT) == hashlib.sha512(
        f"{KEY}|verify_payment|T1|{SALT}".encode()).hexdigest()


# ---- gates -----------------------------------------------------------------

def test_payments_off_by_default():
    assert not svc.payments_allowed(settings(payments_enabled=False))


def test_test_mode_refused_on_production_site():
    assert not svc.payments_allowed(settings(is_production=True))


def test_production_payu_refused_without_uat_approval():
    assert not svc.payments_allowed(settings(payu_env="production"))


def test_test_mode_allowed_outside_production():
    assert svc.payments_allowed(settings())


def test_fulfilment_off_unless_enabled():
    assert not svc.fulfilment_allowed(settings(payment_fulfilment_enabled=False))


def test_test_payu_never_books_against_production_tripjack():
    assert not svc.fulfilment_allowed(settings(tripjack_hotel_booker_url="https://api.tripjack.com"))
    assert svc.fulfilment_allowed(settings())


def test_production_payu_never_books_against_uat_tripjack():
    assert not svc.fulfilment_allowed(settings(payu_env="production", payu_production_approved=True))


# ---- order -----------------------------------------------------------------

def test_order_amount_comes_from_booking_and_is_signed():
    repo, c = FakeRepo(total="4999.5"), FakeClient()
    form = order(repo, c)
    assert form.amount == "4999.50" and form.fields["amount"] == "4999.50"
    assert form.fields["hash"] == payu.request_hash(KEY, SALT, form.fields)
    assert form.action == "https://test.payu.in/_payment"
    assert "salt" not in str(form.fields).lower()


def test_repeat_order_reuses_same_txnid():
    repo, c = FakeRepo(), FakeClient()
    a, b = order(repo, c), order(repo, c)
    assert a.txnid == b.txnid and len(repo.payments) == 1


def test_concurrent_order_returns_the_winning_attempt():
    repo, c = FakeRepo(), FakeClient()
    repo.race = True
    assert order(repo, c).txnid == "WINNER" and len(repo.payments) == 1


def test_order_refused_for_other_user():
    with pytest.raises(svc.PaymentBookingNotFound):
        order(FakeRepo(), FakeClient(), auth=AuthContext(user_id="u2"))


def test_booking_reference_alone_grants_no_access_to_guest_booking():
    repo = FakeRepo(user_id=None, guest_hash=hash_token("guest-secret"))
    with pytest.raises(svc.PaymentBookingNotFound):
        order(repo, FakeClient(), auth=AuthContext(user_id=None))
    assert order(repo, FakeClient(), auth=AuthContext(user_id=None), guest_token="guest-secret").txnid


def test_order_refused_when_amount_changed_under_open_attempt():
    repo, c = FakeRepo(), FakeClient()
    order(repo, c)
    repo.subject["amount"] = "5100.00"
    with pytest.raises(svc.PaymentNotPayable):
        order(repo, c)


def test_hotel_order_only_from_draft():
    repo = FakeRepo(kind="hotel", status="DRAFT")
    assert order(repo, FakeClient()).fields["productinfo"] == "FNF hotel booking"
    repo2 = FakeRepo(kind="hotel", status="CONFIRMED")
    with pytest.raises(svc.PaymentNotPayable):
        order(repo2, FakeClient())


# ---- settle ----------------------------------------------------------------

def test_verified_success_captures_once_across_return_and_webhook():
    repo = FakeRepo()
    c = FakeClient(("success", "4999.50", "MIH1"))
    f = signed_return(order(repo, c).fields)
    assert run(svc.settle(repo, c, f, source="return")).status == "captured"
    assert run(svc.handle_webhook(repo, c, f)).status == "captured"
    assert run(svc.handle_webhook(repo, c, f)).status == "captured"
    assert repo.events.count("payment_succeeded") == 1
    assert len(repo.jobs) == 1
    assert repo.subject["status"] == "payment_processing"


def test_tampered_hash_rejected_without_capture():
    repo = FakeRepo()
    c = FakeClient(("success", "4999.50", "MIH1"))
    f = signed_return(order(repo, c).fields)
    f["amount"] = "1.00"
    assert run(svc.settle(repo, c, f, source="webhook")).status == "rejected"
    assert repo.payments[0]["status"] == "created" and c.verify_calls == 0


def test_valid_hash_but_verify_says_failure_is_not_captured():
    repo = FakeRepo()
    c = FakeClient(("failure", "4999.50", "MIH1"))
    f = signed_return(order(repo, c).fields)
    assert run(svc.settle(repo, c, f, source="return")).status == "failed"
    assert repo.subject["status"] == "pending" and not repo.jobs


def test_delayed_failure_never_downgrades_capture():
    repo = FakeRepo()
    c = FakeClient(("success", "4999.50", "MIH1"))
    fields = order(repo, c).fields
    run(svc.settle(repo, c, signed_return(fields), source="return"))
    c.verified = ("failure", "4999.50", "MIH1")
    assert run(svc.settle(repo, c, signed_return(fields, status="failure"), source="webhook")).status == "captured"
    assert repo.payments[0]["status"] == "captured"


def test_late_verified_success_after_failure_is_captured():
    repo = FakeRepo()
    c = FakeClient(("failure", "4999.50", None))
    fields = order(repo, c).fields
    run(svc.settle(repo, c, signed_return(fields, status="failure"), source="return"))
    c.verified = ("success", "4999.50", "MIH1")
    assert run(svc.settle(repo, c, signed_return(fields), source="webhook")).status == "captured"
    assert len(repo.jobs) == 1


def test_amount_mismatch_from_verify_is_held_pending():
    repo = FakeRepo()
    c = FakeClient(("success", "1.00", "MIH1"))
    f = signed_return(order(repo, c).fields)
    assert run(svc.settle(repo, c, f, source="return")).status == "pending"
    assert repo.payments[0]["status"] == "pending" and not repo.jobs


def test_payu_unreachable_leaves_payment_pending():
    class Down(FakeClient):
        async def verify_payment(self, txnid):
            raise PayUError("payu_unreachable")
    repo, c = FakeRepo(), Down()
    f = signed_return(order(repo, c).fields)
    assert run(svc.settle(repo, c, f, source="return")).status == "pending"


def test_reconcile_captures_stale_pending_payment():
    repo = FakeRepo()
    c = FakeClient(("success", "4999.50", "MIH1"))
    order(repo, c)
    assert [o.status for o in run(svc.reconcile(repo, c))] == ["captured"]


def test_reconcile_marks_old_unknown_attempt_abandoned():
    repo, c = FakeRepo(), FakeClient()
    order(repo, c)
    repo.payments[0]["created_at"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    assert [o.status for o in run(svc.reconcile(repo, c))] == ["failed"]


# ---- fulfilment ------------------------------------------------------------

class FakeHotel:
    available = True  # stands in for a future, reviewed hotel port
    def __init__(self, status="DRAFT", book_result="CONFIRMED", book_raises=None, after_raise="DRAFT"):
        self.b = SimpleNamespace(status=status)
        self.book_result, self.book_raises, self.after_raise = book_result, book_raises, after_raise
        self.book_calls = 0
        self.refresh_calls = 0
        self.refresh_to = None

    async def get(self, ref):
        return self.b

    async def book(self, ref, key):
        self.book_calls += 1
        assert key.startswith("payu:")
        if self.book_raises:
            self.b.status = self.after_raise
            raise self.book_raises
        self.b.status = self.book_result
        return self.b

    async def refresh(self, ref):
        self.refresh_calls += 1
        if self.refresh_to:
            self.b.status = self.refresh_to
        return self.b


def _captured(kind="hotel", status="DRAFT"):
    repo = FakeRepo(kind=kind, status=status)
    c = FakeClient(("success", "4999.50", "MIH1"))
    run(svc.settle(repo, c, signed_return(order(repo, c).fields), source="return"))
    return repo, c


def test_fulfilment_disabled_does_nothing():
    repo, _ = _captured("hotel", "DRAFT")
    hotel = FakeHotel()
    assert run(fulfil.run_once(repo, settings(payment_fulfilment_enabled=False), hotel=hotel)) == []
    assert hotel.book_calls == 0


def test_verified_hotel_payment_books_once():
    repo, _ = _captured("hotel", "DRAFT")
    hotel = FakeHotel()
    assert run(fulfil.run_once(repo, settings(), hotel=hotel)) == ["succeeded"]
    assert run(fulfil.run_once(repo, settings(), hotel=hotel)) == []
    assert hotel.book_calls == 1


def test_hotel_timeout_is_never_rebooked():
    repo, _ = _captured("hotel", "DRAFT")
    hotel = FakeHotel(book_result="BOOKING_IN_PROGRESS")
    assert run(fulfil.run_once(repo, settings(), hotel=hotel)) == ["uncertain"]
    hotel.refresh_to = "CONFIRMED"
    assert run(fulfil.run_once(repo, settings(), hotel=hotel)) == ["succeeded"]
    assert hotel.book_calls == 1 and hotel.refresh_calls == 1


def test_crashed_worker_after_send_only_reconciles():
    repo, _ = _captured("hotel", "DRAFT")
    hotel = FakeHotel(status="BOOKING_IN_PROGRESS")
    hotel.refresh_to = "FAILED"
    assert run(fulfil.run_once(repo, settings(), hotel=hotel)) == ["failed_confirmed"]
    assert hotel.book_calls == 0


def test_hotel_refused_before_send_is_failed_confirmed():
    class PriceChanged(AppError):
        code = "PRICE_CHANGED"
    repo, _ = _captured("hotel", "DRAFT")
    hotel = FakeHotel(book_raises=PriceChanged())
    assert run(fulfil.run_once(repo, settings(), hotel=hotel)) == ["failed_confirmed"]


def test_flight_jobs_go_to_staff():
    repo, _ = _captured()
    assert run(fulfil.run_once(repo, settings(), hotel=FakeHotel())) == ["manual_review"]


# ---- refunds ---------------------------------------------------------------

def _refund(repo, c, token="tok12345", amount="100.00", eligible=always):
    return run(svc.refund(repo, c, payment_id="p1", amount=amount, reason="customer cancel",
                          staff_id="s", request_token=token, eligible=eligible))


def test_refund_is_idempotent_by_token():
    repo, c = _captured()
    _refund(repo, c)
    _refund(repo, c)
    assert c.refund_calls == 1 and len(repo.refunds) == 1


def test_refund_over_balance_refused():
    repo, c = _captured()
    with pytest.raises(svc.RefundNotAllowed):
        _refund(repo, c, amount="5000.00")


def test_partial_refunds_cannot_exceed_capture():
    repo, c = _captured()
    _refund(repo, c, token="tokAAAAA", amount="4000.00")
    with pytest.raises(svc.RefundNotAllowed):
        _refund(repo, c, token="tokBBBBB", amount="1000.00")
    _refund(repo, c, token="tokCCCCC", amount="999.50")


def test_refund_refused_when_payu_no_longer_reports_success():
    repo, c = _captured()
    c.verified = ("failure", "4999.50", "MIH1")
    with pytest.raises(svc.RefundNotAllowed):
        _refund(repo, c)


def test_refund_refused_until_booking_reconciled():
    repo, c = _captured()
    with pytest.raises(svc.RefundNotAllowed):
        _refund(repo, c, eligible=never)
    assert c.refund_calls == 0


def test_ambiguous_refund_is_not_resent_and_blocks_new_ones():
    repo, c = _captured()
    c.refund_raises = True
    assert _refund(repo, c)["status"] == "unknown"
    c.refund_raises = False
    assert _refund(repo, c)["status"] == "unknown"  # same token: no resend
    with pytest.raises(svc.RefundNotAllowed):
        _refund(repo, c, token="tokNEW000")
    assert c.refund_calls == 1


def test_refund_status_success_updates_payment():
    repo, c = _captured()
    _refund(repo, c, amount="4999.50")
    c.refund_status_body = {"transaction_details": {"RQ1": {"status": "success"}}}
    assert run(svc.reconcile_refunds(repo, c)) == ["success"]
    assert repo.payments[0]["status"] == "refunded"
    assert repo.payments[0]["amount_refunded"] == "4999.50"


def test_hotel_refund_eligibility_requires_provider_confirmed_failure():
    repo, _ = _captured("hotel", "DRAFT")
    hotel = FakeHotel(status="BOOKING_IN_PROGRESS")
    eligible = fulfil.refund_eligibility(repo, hotel=hotel)
    p = repo.payments[0]
    assert not run(eligible(p, repo.subject))
    hotel.refresh_to = "FAILED"
    assert run(eligible(p, repo.subject))
