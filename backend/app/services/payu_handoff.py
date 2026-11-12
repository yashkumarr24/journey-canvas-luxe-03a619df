"""Additive, staging-only iOS handoff. Never settle, retry or fulfil a payment."""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from html import escape
from urllib.parse import urlparse

from app.core.errors import AppError
from app.services import payments

TTL_SECONDS = 120
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")


class HandoffUnavailable(AppError):
    status_code = 409
    code = "PAYU_HANDOFF_UNAVAILABLE"
    message = "App payment is unavailable. Check your booking status before trying again."


def require_enabled(settings):
    site = urlparse(settings.public_site_url)
    if (not getattr(settings, "payu_handoff_enabled", False)
            or settings.is_production or settings.payu_env != "test"
            or site.scheme != "https" or not site.hostname
            or site.username or site.password or site.query or site.fragment
            or site.path not in ("", "/")
            or site.hostname.lower() in ("flynfeelholiday.com", "www.flynfeelholiday.com")):
        raise HandoffUnavailable()


def token_digest(token):
    if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
        raise HandoffUnavailable()
    return hashlib.sha256(token.encode()).hexdigest()


async def issue(repo, store, client, settings, *, booking_reference, auth, guest_token):
    require_enabled(settings)
    subject = await repo.subject_by_reference(booking_reference)
    if not subject or not payments.owns(subject, auth, guest_token):
        raise payments.PaymentBookingNotFound()
    # iOS never retries an existing payment, even failed/expired attempts. This
    # conservative new-flow rule does not alter website create_order behavior.
    if subject["kind"] != "hotel" or await repo.latest_payment_for(subject):
        raise HandoffUnavailable()
    form = await payments.create_order(repo, client, settings,
        booking_reference=booking_reference, auth=auth, guest_token=guest_token)
    payment = await repo.payment_by_txnid(form.txnid)
    if not payment:
        raise HandoffUnavailable()
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=TTL_SECONDS)
    # Persist only a digest, payment binding and lifetime. No signed fields,
    # guest details, merchant salt, access pass or raw token in the database.
    if not await store.insert({"token_hash": token_digest(token), "payment_id": payment["id"],
                              "expires_at": expires.isoformat()}):
        raise HandoffUnavailable()
    return {"handoffUrl": settings.public_site_url.rstrip("/") +
            "/api/public/payu-handoff#token=" + token,
            "bookingReference": booking_reference, "expiresAt": expires.isoformat()}


async def redeem(repo, store, client, settings, token):
    require_enabled(settings)
    # RPC burns the token atomically, under the associated payment/booking locks.
    # All later failures keep it burned. Never invoke create_order here.
    row = await store.consume(token_digest(token))
    if not row:
        raise HandoffUnavailable()
    payment = await repo.payment_by_id(row["payment_id"])
    subject = await repo.subject_for_payment(payment) if payment else None
    if (not payment or not subject or subject["kind"] != "hotel"
            or subject["status"] != "DRAFT" or payment.get("provider") != "payu"
            or payment["status"] not in ("created", "pending")
            or payment.get("currency") != "INR" or subject.get("currency") != "INR"
            or payments.to_amount(payment["amount"]) != payments.to_amount(subject["amount"])):
        raise HandoffUnavailable()
    if client.payment_url != "https://test.payu.in/_payment":
        raise HandoffUnavailable()
    return_url = settings.payu_return_base_url.rstrip("/") + "/api/v1/payments/payu/return"
    # Match the existing CheckoutForm contract without refactoring production code.
    fields = {"key": client.key, "txnid": payment["txnid"],
              "amount": payments.to_amount(payment["amount"]),
              "productinfo": "FNF hotel booking", "firstname": "Traveller",
              "email": subject.get("email") or "", "phone": subject.get("phone") or "",
              "udf1": subject["reference"], "udf2": "", "udf3": "", "udf4": "", "udf5": "",
              "surl": return_url, "furl": return_url}
    fields["hash"] = client.sign(fields)
    return render_form(client.payment_url, fields)


def render_form(action, fields):
    nonce = secrets.token_urlsafe(24)
    inputs = "".join('<input type="hidden" name="' + escape(k, quote=True) +
                     '" value="' + escape(v, quote=True) + '">' for k, v in fields.items())
    # No manual resubmit button: a replay must not send the same txnid again.
    html = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<meta name="robots" content="noindex,nofollow"><title>Secure payment — Fly n Feel</title>'
            '</head><body><p>Opening secure payment…</p><form method="post" action="' +
            escape(action, quote=True) + '">' + inputs + '</form><script nonce="' + nonce + '">'
            'document.forms[0].submit();</script></body></html>')
    return html, {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; script-src 'nonce-" + nonce +
        "'; form-action https://test.payu.in; frame-ancestors 'none'; base-uri 'none'"}