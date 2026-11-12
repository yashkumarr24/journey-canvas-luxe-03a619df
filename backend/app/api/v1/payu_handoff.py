"""New endpoints only; existing payment routes and settlement stay untouched."""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from app.api.v1.payments import OrderRequest
from app.core.auth import AuthContext, optional_user
from app.core.config import Settings, get_settings
from app.repositories.payments import PaymentsRepo
from app.repositories.payu_handoff import HandoffRepo
from app.services import payments
from app.services import payu_handoff as svc

router = APIRouter(prefix="/api/v1/payments/handoff", tags=["iOS payment handoff"])


@router.post("")
async def create_handoff(payload: OrderRequest, auth: AuthContext = Depends(optional_user),
                         settings: Settings = Depends(get_settings)):
    svc.require_enabled(settings)  # before any DB/client construction
    return await svc.issue(PaymentsRepo(settings), HandoffRepo(settings),
                           payments.build_client(settings), settings,
                           booking_reference=payload.bookingReference, auth=auth,
                           guest_token=payload.guestToken)


@router.post("/redeem", include_in_schema=False)
async def redeem_handoff(request: Request, settings: Settings = Depends(get_settings)):
    svc.require_enabled(settings)
    if request.headers.get("content-type", "").split(";")[0] != "application/x-www-form-urlencoded":
        raise HTTPException(415)
    body = await request.body()
    if len(body) > 256:
        raise HTTPException(413)
    from urllib.parse import parse_qs
    values = parse_qs(body.decode("ascii", errors="replace"), keep_blank_values=True)
    if set(values) != {"token"} or len(values["token"]) != 1:
        raise svc.HandoffUnavailable()
    html, headers = await svc.redeem(PaymentsRepo(settings), HandoffRepo(settings),
                                    payments.build_client(settings), settings, values["token"][0])
    return HTMLResponse(html, headers=headers)