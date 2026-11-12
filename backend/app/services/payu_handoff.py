"""Additive iOS handoff. Never settles, retries with a new txnid, or fulfils.

Safety model:
* One payment attempt (txnid) per handoff chain. A replacement link re-opens the
  SAME txnid; it never calls create_order again, so no second order exists.
* Replacement only while the attempt is still 'created' (no PayU return or
  webhook seen), younger than ATTEMPT_WINDOW, under MAX_LINKS, and server-side
  PayU Verify reports no transaction for the txnid. Any doubt -> status only.
* A late capture lands on the same single payment row through the unchanged
  settlement path, so it can be fulfilled at most once.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from html import escape
from urllib.parse import urlparse

from app.core.errors import AppError
from app.integrations.payu.client import HOSTS
from app.services import payments

TTL_SECONDS = 120
MAX_LINKS = 3                     # first link + two replacements, DB-enforced too
ATTEMPT_WINDOW = timedelta(minutes=15)
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")
PRODUCTION_HOSTS = ("flynfeelholiday.com", "www.flynfeelholiday.com")


class HandoffUnavailable(AppError):
    status_code = 409
    code = "PAYU_HANDOFF_UNAVAILABLE"
    message = "App payment is unavailable. Check your booking status before trying again."


def _production_like(settings):
    host = (urlparse(settings.public_site_url).hostname or "").lower()
    return bool(settings.is_production or settings.payu_env != "test" or host in PRODUCTION_HOSTS)


def require_enabled(settings):
    site = urlparse(settings.public_site_url)
    if (not getattr(settings, "payu_handoff_enabled", False)
            or settings.payu_env not in HOSTS
            or site.scheme != "https" or not site.hostname
            or site.username or site.password or site.query or site.fragment
            or site.path not in ("", "/")):
        raise HandoffUnavailable()
    if _production_like(settings) and not (
            getattr(settings, "payu_handoff_production_approved", False) is True
            and getattr(settings, "payu_production_approved", False) is True
            and settings.payu_env == "production" and settings.is_production):
        # Production needs both approvals AND a consistent production pair.
        raise HandoffUnavailable()


def expected_action(settings):
    return HOSTS[settings.payu_env]["pay"]


def token_digest(token):
    if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
        raise HandoffUnavailable()
    return hashlib.sha256(token.encode()).hexdigest()


def _payable(payment, subject):
    return (payment and subject and subject["kind"] == "hotel" and subject["status"] == "DRAFT"
            and payment.get("provider") == "payu"
            and payment.get("currency") == "INR" and subject.get("currency") == "INR"
            and payments.to_amount(payment["amount"]) == payments.to_amount(subject["amount"]))


def _created_at(payment):
    try:
        value = datetime.fromisoformat(str(payment["created_at"]).replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return None
    return value if value.tzinfo else None


async def _replaceable(store, client, payment, subject, now):
    if not _payable(payment, subject) or payment["status"] != "created":
        return False
    created = _created_at(payment)
    if created is None or now - created > ATTEMPT_WINDOW:
        return False
    chain = await store.chain(payment["id"])
    # Only attempts that began as an iOS handoff; website attempts stay untouched.
    if not chain or chain["links"] >= MAX_LINKS:
        return False
    try:
        verified = await client.verify_payment(payment["txnid"])
    except Exception:
        return False                       # unknown PayU state -> status only
    return verified.status == "not_found"


async def issue(repo, store, client, settings, *, booking_reference, auth, guest_token):
    require_enabled(settings)
    subject = await repo.subject_by_reference(booking_reference)
    if not subject or not payments.owns(subject, auth, guest_token):
        raise payments.PaymentBookingNotFound()
    if subject["kind"] != "hotel":
        raise HandoffUnavailable()
    now = datetime.now(timezone.utc)
    latest = await repo.latest_payment_for(subject)
    if latest:
        if not await _replaceable(store, client, latest, subject, now):
            raise HandoffUnavailable()
        payment = latest                   # SAME attempt; never create_order
    else:
        form = await payments.create_order(repo, client, settings,
            booking_reference=booking_reference, auth=auth, guest_token=guest_token)
        payment = await repo.payment_by_txnid(form.txnid)
        if not payment:
            raise HandoffUnavailable()
    token = secrets.token_urlsafe(32)
    expires = now + timedelta(seconds=TTL_SECONDS)
    # Atomic in the DB: re-checks payability, revokes the previous unused link,
    # enforces MAX_LINKS and the attempt window. Stores a digest only.
    if not await store.issue(payment["id"], token_digest(token), expires.isoformat()):
        raise HandoffUnavailable()
    return {"handoffUrl": settings.public_site_url.rstrip("/") +
            "/api/public/payu-handoff#token=" + token,
            "bookingReference": booking_reference, "expiresAt": expires.isoformat()}


async def redeem(repo, store, client, settings, token):
    require_enabled(settings)
    row = await store.consume(token_digest(token))   # burns atomically
    if not row:
        raise HandoffUnavailable()
    payment = await repo.payment_by_id(row["payment_id"])
    subject = await repo.subject_for_payment(payment) if payment else None
    if not _payable(payment, subject) or payment["status"] not in ("created", "pending"):
        raise HandoffUnavailable()
    action = expected_action(settings)
    if client.payment_url != action:
        raise HandoffUnavailable()
    return_url = settings.payu_return_base_url.rstrip("/") + "/api/v1/payments/payu/return"
    fields = {"key": client.key, "txnid": payment["txnid"],
              "amount": payments.to_amount(payment["amount"]),
              "productinfo": "FNF hotel booking", "firstname": "Traveller",
              "email": subject.get("email") or "", "phone": subject.get("phone") or "",
              "udf1": subject["reference"], "udf2": "", "udf3": "", "udf4": "", "udf5": "",
              "surl": return_url, "furl": return_url}
    fields["hash"] = client.sign(fields)
    return render_form(action, fields)


def render_form(action, fields):
    origin = "https://" + urlparse(action).hostname
    nonce = secrets.token_urlsafe(24)
    inputs = "".join('<input type="hidden" name="' + escape(k, quote=True) +
                     '" value="' + escape(v, quote=True) + '">' for k, v in fields.items())
    html = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<meta name="robots" content="noindex,nofollow"><title>Secure payment — Fly n Feel</title>'
            '</head><body><p>Opening secure payment…</p><form method="post" action="' +
            escape(action, quote=True) + '">' + inputs + '</form><script nonce="' + nonce + '">'
            'document.forms[0].submit();</script></body></html>')
    return html, {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; script-src 'nonce-" + nonce +
        "'; form-action " + origin + "; frame-ancestors 'none'; base-uri 'none'"}
