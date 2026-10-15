"""PayU payment rules. Fakes only — no PayU or database call is ever made."""

from __future__ import annotations

import asyncio
import hashlib
from types import SimpleNamespace

import pytest

from app.core.auth import AuthContext
from app.integrations.payu import client as payu
from app.integrations.payu.client import PayUClient, VerifiedTxn
from app.services import payments as svc

KEY, SALT = "TESTKEY", "TESTSALT"


def run(c):
    return asyncio.run(c)


def settings(**kw):
    base = dict(payments_enabled=True, payu_env="test", payu_production_approved=False,
                payu_merchant_key=KEY, payu_merchant_salt=SALT,
                payu_return_base_url="https://api.example.test", is_production=False,
                payu_timeout=5.0, payu_webhook_secret_path="x")
    base.update(kw)
    return SimpleNamespace(**base)


class FakeRepo:
    def __init__(self, total="4999.50", status="pending"):
        self.booking = {"id": "b1", "booking_reference": "FF-ABCD1234", "user_id": "u1",
                        "status": status, "currency": "INR", "total_amount": total,
                        "booking_type": "flight", "contact_email": "a@b.co"}
        self.payments: list[dict] = []
        self.refunds: list[dict] = []
        self.webhooks: set[str] = set()
        self.events: list[str] = []

    async def booking_by_reference(self, ref):
        return self.booking if ref == self.booking["booking_reference"] else None

    async def booking_by_id(self, i):
        return self.booking

    async def open_payment_for_booking(self, bid):
        live = [p for p in self.payments if p["status"] in ("created", "pending", "captured")]
        return live[-1] if live else None

    async def payment_by_txnid(self, t):
        return next((p for p in self.payments if p["txnid"] == t), None)

    async def payment_by_id(self, i):
        return next((p for p in self.payments if p["id"] == i), None)

    async def create_payment(self, v):
        row = {"id": f"p{len(self.payments)+1}", "amount_refunded": 0, **v}
        self.payments.append(row)
        return row

    async def transition(self, pid, expected, values):
        p = await self.payment_by_id(pid)
        if p and p["status"] in expected:
            p.update(values)
            return True
        return False

    async def set_booking_status(self, bid, expected, status):
        if self.booking["status"] in expected:
            self.booking["status"] = status
            return True
        return False

    async def stale_payments(self, cutoff, limit=50):
        return [p for p in self.payments if p["status"] in ("created", "pending")]

    async def claim_webhook(self, k):
        if k in self.webhooks:
            return False
        self.webhooks.add(k)
        return True

    async def refund_by_token(self, t):
        return next((r for r in self.refunds if r["request_token"] == t), None)

    async def create_refund(self, v):
        row = {"id": f"r{len(self.refunds)+1}", **v}
        self.refunds.append(row)
        return row

    async def update_refund(self, i, v):
        next(r for r in self.refunds if r["id"] == i).update(v)

    async def record_event(self, bid, t, m, status=None):
        self.events.append(t)


class FakeClient(PayUClient):
    def __init__(self, verified=None):
        super().__init__(key=KEY, salt=SALT, env="test")
        self.verified = verified
        self.verify_calls = 0
        self.refund_calls = 0

    async def verify_payment(self, txnid):
        self.verify_calls += 1
        v = self.verified
        return VerifiedTxn(txnid, v[0], v[1], v[2]) if v else VerifiedTxn(txnid, "not_found", None, None)

    async def refund(self, mihpayid, token, amount):
        self.refund_calls += 1
        return {"status": 1, "request_id": "RQ1"}


AUTH = AuthContext(user_id="u1")


def signed_return(fields, status="success"):
    f = {k: fields[k] for k in ("txnid", "amount", "productinfo", "firstname", "email",
                                "udf1", "udf2", "udf3", "udf4", "udf5")}
    f.update(status=status, mihpayid="MIH1")
    f["hash"] = payu.response_hash(KEY, SALT, f)
    return f


def order(repo, client):
    return run(svc.create_order(repo, client, settings(), booking_reference="FF-ABCD1234",
                                auth=AUTH, guest_token=None))


# ---- hashing (docs.payu.in hashing-request-and-response) -------------------

def test_request_hash_matches_documented_formula():
    f = {"txnid": "T1", "amount": "10.00", "productinfo": "P", "firstname": "A", "email": "a@b.co",
         "udf1": "FF-1"}
    raw = f"{KEY}|T1|10.00|P|A|a@b.co|FF-1||||||||||{SALT}"
    assert payu.request_hash(KEY, SALT, f) == hashlib.sha512(raw.encode()).hexdigest()


def test_response_hash_matches_documented_reverse_formula():
    f = {"status": "success", "txnid": "T1", "amount": "10.00", "productinfo": "P",
         "firstname": "A", "email": "a@b.co", "udf1": "FF-1"}
    raw = f"{SALT}|success|||||||||FF-1|a@b.co|A|P|10.00|T1|{KEY}"
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


def test_order_refused_for_other_user():
    with pytest.raises(svc.PaymentBookingNotFound):
        run(svc.create_order(FakeRepo(), FakeClient(), settings(), booking_reference="FF-ABCD1234",
                             auth=AuthContext(user_id="u2"), guest_token=None))


# ---- settle ----------------------------------------------------------------

def test_verified_success_captures_once_across_return_and_webhook():
    repo = FakeRepo()
    c = FakeClient(("success", "4999.50", "MIH1"))
    f = signed_return(order(repo, c).fields)
    assert run(svc.settle(repo, c, f, source="return")).status == "captured"
    assert run(svc.handle_webhook(repo, c, f)).status == "captured"
    assert run(svc.handle_webhook(repo, c, f)).status == "duplicate"
    assert repo.events.count("payment_succeeded") == 1
    assert repo.booking["status"] == "payment_processing"


def test_tampered_hash_rejected_without_capture():
    repo = FakeRepo()
    c = FakeClient(("success", "4999.50", "MIH1"))
    f = signed_return(order(repo, c).fields)
    f["amount"] = "1.00"
    assert run(svc.settle(repo, c, f, source="return")).status == "rejected"
    assert repo.payments[0]["status"] == "created" and c.verify_calls == 0


def test_valid_hash_but_verify_says_failure_is_not_captured():
    repo = FakeRepo()
    c = FakeClient(("failure", "4999.50", "MIH1"))
    f = signed_return(order(repo, c).fields)
    assert run(svc.settle(repo, c, f, source="return")).status == "failed"
    assert repo.booking["status"] == "pending"


def test_amount_mismatch_from_verify_is_held_pending():
    repo = FakeRepo()
    c = FakeClient(("success", "1.00", "MIH1"))
    f = signed_return(order(repo, c).fields)
    assert run(svc.settle(repo, c, f, source="return")).status == "pending"
    assert repo.payments[0]["status"] == "pending"


def test_reconcile_captures_stale_pending_payment():
    repo = FakeRepo()
    c = FakeClient(("success", "4999.50", "MIH1"))
    order(repo, c)
    assert [o.status for o in run(svc.reconcile(repo, c))] == ["captured"]


# ---- refunds ---------------------------------------------------------------

def _captured():
    repo = FakeRepo()
    c = FakeClient(("success", "4999.50", "MIH1"))
    run(svc.settle(repo, c, signed_return(order(repo, c).fields), source="return"))
    return repo, c


def test_refund_is_idempotent_by_token():
    repo, c = _captured()
    kw = dict(payment_id="p1", amount=100, reason="customer cancel", staff_id="s", request_token="tok12345")
    run(svc.refund(repo, c, **kw))
    run(svc.refund(repo, c, **kw))
    assert c.refund_calls == 1 and len(repo.refunds) == 1


def test_refund_over_balance_refused():
    repo, c = _captured()
    with pytest.raises(svc.RefundNotAllowed):
        run(svc.refund(repo, c, payment_id="p1", amount=5000, reason="x" * 5, staff_id="s",
                       request_token="tok99999"))


def test_refund_refused_when_payu_no_longer_reports_success():
    repo, c = _captured()
    c.verified = ("failure", "4999.50", "MIH1")
    with pytest.raises(svc.RefundNotAllowed):
        run(svc.refund(repo, c, payment_id="p1", amount=10, reason="xxxxx", staff_id="s",
                       request_token="tok77777"))
