"""PayU payment endpoints (v1). Thin handlers; rules live in services/payments."""

from __future__ import annotations

import hmac
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field

from app.core.admin_auth import AdminContext, require_admin
from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.repositories.payments import PaymentsRepo
from app.services import payment_fulfilment as fulfil
from app.services import payments as svc

router = APIRouter(prefix="/api/v1/payments", tags=["payments"])

REF_PATTERN = r"^(FF-[0-9A-Z]{8}|FNFH[0-9A-F]{6})$"


class OrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")  # an amount can never be sent
    bookingReference: str = Field(min_length=4, max_length=32, pattern=REF_PATTERN)
    guestToken: Optional[str] = Field(default=None, max_length=128)
    method: Optional[str] = Field(default=None, max_length=32)
    idempotencyKey: Optional[str] = Field(default=None, max_length=128)


class RefundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    paymentId: uuid.UUID
    # Decimal string (e.g. "1250.50"), never a float.
    amount: str = Field(pattern=r"^[0-9]{1,10}(\.[0-9]{1,2})?$")
    reason: str = Field(min_length=3, max_length=500)
    requestToken: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


async def _form(request: Request) -> dict[str, str]:
    form = await request.form()
    return {k: str(v) for k, v in form.items() if isinstance(v, str)}


@router.post("/order")
async def create_order(payload: OrderRequest, auth: AuthContext = Depends(optional_user),
                       settings: Settings = Depends(get_settings)):
    client = svc.build_client(settings)
    form = await svc.create_order(PaymentsRepo(settings), client, settings,
                                  booking_reference=payload.bookingReference, auth=auth,
                                  guest_token=payload.guestToken)
    return {
        "provider": "payu", "bookingReference": form.booking_reference, "orderId": form.txnid,
        # Display only; the signed PayU field `amount` is the exact decimal string.
        "amount": {"amount": float(form.amount), "currency": form.currency},
        "action": form.action, "fields": form.fields,
    }


def _redirect(settings: Settings, outcome: svc.Outcome) -> RedirectResponse:
    base = settings.public_site_url.rstrip("/")
    if not outcome.booking_reference:
        return RedirectResponse(f"{base}/booking-lookup?payment=unknown", status_code=303)
    kind = "hotels" if outcome.booking_type == "hotel" else "flights"
    # The page re-reads the status from the server; this query is display-only.
    return RedirectResponse(
        f"{base}/{kind}/confirmation?ref={outcome.booking_reference}&payment={outcome.status}",
        status_code=303)


@router.post("/payu/return", include_in_schema=False)
async def payu_return(request: Request, settings: Settings = Depends(get_settings)):
    client = svc.build_client(settings)
    outcome = await svc.settle(PaymentsRepo(settings), client, await _form(request), source="return")
    return _redirect(settings, outcome)


@router.post("/payu/webhook/{secret_path}", include_in_schema=False)
async def payu_webhook(secret_path: str, request: Request, settings: Settings = Depends(get_settings)):
    # The path only filters noise. Authentication is the reverse hash plus the
    # server-to-server verify_payment call inside settle().
    expected = settings.payu_webhook_secret_path
    if not expected or not hmac.compare_digest(secret_path, expected):
        raise HTTPException(status_code=404)
    client = svc.build_client(settings)
    outcome = await svc.handle_webhook(PaymentsRepo(settings), client, await _form(request))
    return {"ok": True, "status": outcome.status}


@router.get("/status/{booking_reference}")
async def payment_status(booking_reference: str, auth: AuthContext = Depends(optional_user),
                         settings: Settings = Depends(get_settings),
                         x_guest_token: Optional[str] = Header(default=None)):
    repo = PaymentsRepo(settings)
    subject = await repo.subject_by_reference(booking_reference)
    if not subject or not svc.owns(subject, auth, x_guest_token):
        raise svc.PaymentBookingNotFound()
    payment = await repo.latest_payment_for(subject)
    job = await repo.job_for_payment(payment["id"]) if payment else None
    return {"bookingReference": booking_reference, "bookingStatus": subject["status"],
            "paymentStatus": payment["status"] if payment else None,
            "fulfilmentStatus": job["status"] if job else None}


@router.post("/refunds")
async def create_refund(payload: RefundRequest, settings: Settings = Depends(get_settings),
                        admin: AdminContext = Depends(require_admin(2))):
    client = svc.build_client(settings)
    repo = PaymentsRepo(settings)
    row = await svc.refund(repo, client, payment_id=str(payload.paymentId), amount=payload.amount,
                           reason=payload.reason, staff_id=str(getattr(admin, "user_id", "") or ""),
                           request_token=payload.requestToken,
                           eligible=fulfil.refund_eligibility(repo, hotel=fulfil.LiveHotelPort(settings)))
    return {"id": row.get("id"), "status": row.get("status")}
