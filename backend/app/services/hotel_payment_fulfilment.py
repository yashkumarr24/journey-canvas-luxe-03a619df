"""VPS-only Hotel payment adapter; no browser authorization and no wire changes."""

from __future__ import annotations

import secrets
from decimal import Decimal, InvalidOperation

from app.integrations.tripjack.config import (
    HOTEL_ENV_UAT, build_hotel_config, build_hotel_booker_config, hotel_environment,
)
from app.services import hotel_booking as hb
from app.services import payments as pay


class HotelPaymentMismatch(hb.HotelPaymentRequiredError):
    code = "HOTEL_PAYMENT_EVIDENCE_MISMATCH"


def _amount(value):
    try:
        result = Decimal(str(value))
        if not result.is_finite() or result <= 0 or result != result.quantize(Decimal("0.01")):
            raise HotelPaymentMismatch()
    except (InvalidOperation, ValueError, TypeError):
        raise HotelPaymentMismatch() from None
    return result


class DatabaseHotelPort:
    """Captured DB state authorizes only its direct Hotel FK, never a parent.

    Production is deliberately unavailable. Checkout's linked-draft RPC is a
    separate prerequisite; this adapter neither creates drafts nor probes SQL.
    """

    def __init__(self, settings, repo):
        self.settings, self.repo = settings, repo
        self.store = hb.BookingStore(settings)

    def allows(self, settings):
        # Hotel hosts are checked independently of Flight's UAT configuration.
        return bool(
            not settings.is_production and settings.payu_env == "test"
            and pay.payments_allowed(settings) and settings.payment_fulfilment_enabled
            and self.store.repo is not None
            and hotel_environment(settings) == HOTEL_ENV_UAT
            and build_hotel_config(settings).is_configured
            and build_hotel_booker_config(settings).is_configured
        )

    @property
    def available(self):
        return self.allows(self.settings)

    async def get(self, reference):
        if self.store.repo is None:
            raise hb.HotelBookingUnavailableError()
        return await self.store.get(reference)

    async def authorize_job(self, job):
        if job.get("subject_type") != "hotel":
            raise HotelPaymentMismatch()
        return await self._validated(job.get("payment_id"), job.get("subject_ref"))

    async def _validated(self, payment_id, reference):
        if not payment_id or not reference:
            raise HotelPaymentMismatch()
        p = await self.repo.payment_by_id(payment_id)
        if not p or str(p.get("id")) != str(payment_id) or p.get("provider") != "payu" \
                or p.get("status") != "captured" or not p.get("hotel_booking_id") \
                or p.get("booking_id") is not None:
            raise HotelPaymentMismatch()
        if not p.get("verified_at") or p.get("verification_source") not in ("return", "webhook", "reconcile") \
                or p.get("raw_status") != "success" or not p.get("txnid") \
                or not p.get("provider_mihpayid") \
                or p.get("provider_payment_id") != p.get("provider_mihpayid") \
                or Decimal(str(p.get("amount_refunded") or "0")) != 0:
            raise HotelPaymentMismatch()
        subject = await self.repo.subject_for_payment(p)
        b = await self.get(reference)
        if not subject or b is None or subject.get("kind") != "hotel" \
                or str(subject.get("id")) != str(p["hotel_booking_id"]) \
                or str(b.row_id) != str(p["hotel_booking_id"]) \
                or subject.get("reference") != reference or b.booking_reference != reference:
            raise HotelPaymentMismatch()
        # The direct, server-written payment FK binds ownership to this Hotel.
        # There are no payment owner columns in the current schema. Compare the
        # freshly resolved subject and lifecycle row, never reference/email.
        if subject.get("user_id") != b.user_id:
            raise HotelPaymentMismatch()
        if b.user_id:
            if subject.get("guest_token_hash") or b.guest_token_hash:
                raise HotelPaymentMismatch()
        else:
            a, c = subject.get("guest_token_hash"), b.guest_token_hash
            if not isinstance(a, str) or not isinstance(c, str) or len(c) != 64 \
                    or any(ch not in "0123456789abcdef" for ch in c) \
                    or not secrets.compare_digest(a, c):
                raise HotelPaymentMismatch()
        if "user_id" in p and p["user_id"] != b.user_id:
            raise HotelPaymentMismatch()
        if p.get("currency") != subject.get("currency") or p.get("currency") != b.currency \
                or b.currency != "INR" \
                or _amount(p.get("amount")) != _amount(subject.get("amount")) \
                or _amount(p.get("amount")) != _amount(b.total_amount):
            raise HotelPaymentMismatch()
        return b

    async def book(self, reference, idempotency_key):
        if not self.available:
            raise hb.HotelBookingUnavailableError()
        prefix = "payu:"
        if not idempotency_key.startswith(prefix):
            raise HotelPaymentMismatch()
        # Read payment and Hotel again immediately before the existing CAS flow.
        b = await self._validated(idempotency_key[len(prefix):], reference)
        if b.status != hb.DRAFT:
            raise hb.HotelBookingDuplicateError()
        # No payment_verified=True shortcut: UAT-only, database-authorized loaded
        # record. Production remains refused by both adapter and lifecycle gate.
        return await hb._book_loaded(
            settings=self.settings, store=self.store, b=b, mode="instant",
            idempotency_key=idempotency_key, payment_verified=False, gst_info=None,
        )

    async def refresh(self, reference):
        if not self.available:
            raise hb.HotelBookingUnavailableError()
        b = await self.get(reference)
        if b and b.provider_booking_id and hb._due(b):
            await hb._sync_from_details(self.store, hb.provider_factory(self.settings), b)
        return b