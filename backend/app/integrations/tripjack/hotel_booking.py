"""TripJack Hotel API v3 — Book, Booking Details, Confirm Hold, Cancel.

Wire contract (TripJack Hotel API v3 documentation, "Book", "Booking Details",
"Confirm Book", "Cancel Booking"). NOT yet confirmed against live UAT — the
controlled certification run is what confirms it:

  Host: the separate hotel BOOKER host (UAT https://apitest-hotel-booker.tripjack.com)

  POST /oms/v3/hotel/book
    {"bookingId": <Review bookingId>, "type": "HOTEL",
     "roomTravellerInfo": [{"travellerInfo": [{"ti","pt","fN","lN","pan"?,"pNum"?}]}],
     "deliveryInfo": {"emails": [..], "contacts": [..], "code": [..]},
     "gstInfo"?: {...},                     # only when Review requires it
     "paymentInfos"?: [{"amount": <review totalPrice>}]}   # INSTANT only
    paymentInfos ABSENT == HOLD booking.

  POST /oms/v3/hotel/booking-details   {"bookingId"}
    order.status: SUCCESS | ON_HOLD | ABORTED | FAILED | CANCELLED |
                  CANCELLATION_PENDING | (in-progress values)

  POST /oms/v3/hotel/confirm-book      {"bookingId", "paymentInfos": [{"amount"}]}

  POST /oms/v3/hotel/cancel-booking/{bookingId}   (no request body)

Everything here is provider-only. Nothing in this module's inputs or outputs
(bookingId, PAN, passport, raw bodies) may reach the browser; the service layer
maps these results onto our own booking record.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

HOTEL_BOOK_PATH = "oms/v3/hotel/book"
HOTEL_BOOKING_DETAILS_PATH = "oms/v3/hotel/booking-details"
HOTEL_CONFIRM_BOOK_PATH = "oms/v3/hotel/confirm-book"
HOTEL_CANCEL_BOOKING_PATH = "oms/v3/hotel/cancel-booking"

# Provider order statuses we understand. Anything else is "unknown" and is
# never treated as success or failure.
PROVIDER_TERMINAL = {"SUCCESS", "ON_HOLD", "ABORTED", "FAILED", "CANCELLED"}
PROVIDER_KNOWN = PROVIDER_TERMINAL | {"CANCELLATION_PENDING"}

ADULT_TITLES = {"Mr", "Mrs", "Ms"}
CHILD_TITLES = {"Master", "Miss"}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z ]{1,49}$")
_DIAL_RE = re.compile(r"^\+[0-9]{1,4}$")


# ------------------------------------------------------------------- inputs --


@dataclass(frozen=True)
class BookTraveller:
    room_index: int  # 1-based, search order
    type: str  # "adult" | "child"
    title: str
    first_name: str
    last_name: str
    pan: Optional[str] = None
    passport: Optional[str] = None


@dataclass(frozen=True)
class BookContact:
    email: str
    phone: str
    dial_code: str = "+91"


def _tj_title(t: BookTraveller) -> str:
    title = (t.title or "").strip().rstrip(".").title()
    if t.type == "child":
        if title in ("Mstr", "Master"):
            return "Master"
        return "Miss" if title in ("Miss", "Ms") else "Master"
    return title if title in ADULT_TITLES else "Mr"


def _digits_phone(phone: str, dial_code: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    code = re.sub(r"\D", "", dial_code or "")
    if code and digits.startswith(code) and len(digits) > 10:
        digits = digits[len(code):]
    return digits.lstrip("0") if code == "91" else digits


def build_book_payload(
    *,
    booking_id: str,
    rooms: list[dict[str, Any]],
    travellers: list[BookTraveller],
    contact: BookContact,
    amount: Optional[float],
    gst_info: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """amount given -> INSTANT (paymentInfos). amount None -> HOLD (no paymentInfos)."""
    if not booking_id:
        raise ValueError("missing_booking_id")
    if amount is not None and not (isinstance(amount, (int, float)) and amount > 0):
        raise ValueError("invalid_amount")
    room_info = []
    for idx in range(1, len(rooms) + 1):
        occupants = [t for t in travellers if t.room_index == idx]
        # Adults first, then children — TripJack pairs ADULT/CHILD by type.
        occupants.sort(key=lambda t: 0 if t.type == "adult" else 1)
        infos = []
        for t in occupants:
            info: dict[str, Any] = {
                "ti": _tj_title(t),
                "pt": "ADULT" if t.type == "adult" else "CHILD",
                "fN": t.first_name,
                "lN": t.last_name,
            }
            if t.pan:
                info["pan"] = t.pan
            if t.passport:
                info["pNum"] = t.passport
            infos.append(info)
        room_info.append({"travellerInfo": infos})
    payload: dict[str, Any] = {
        "bookingId": booking_id,
        "type": "HOTEL",
        "roomTravellerInfo": room_info,
        "deliveryInfo": {
            "emails": [contact.email],
            "contacts": [_digits_phone(contact.phone, contact.dial_code)],
            "code": [contact.dial_code or "+91"],
        },
    }
    if gst_info:
        payload["gstInfo"] = dict(gst_info)
    if amount is not None:
        payload["paymentInfos"] = [{"amount": round(float(amount), 2)}]
    return payload


def validate_book_payload(
    payload: dict[str, Any],
    rooms: list[dict[str, Any]],
    *,
    hold: bool,
    pan_required: bool = False,
    passport_required: bool = False,
    gst_required: bool = False,
) -> list[str]:
    """Pre-flight checks. Returns rule CODES only — never the offending value."""
    fails: list[str] = []
    if not isinstance(payload.get("bookingId"), str) or not payload["bookingId"].strip():
        fails.append("bookingId.missing")
    if payload.get("type") != "HOTEL":
        fails.append("type.invalid")
    if hold and "paymentInfos" in payload:
        fails.append("paymentInfos.present_on_hold")
    if not hold:
        pi = payload.get("paymentInfos")
        if not (isinstance(pi, list) and len(pi) == 1 and isinstance(pi[0], dict)
                and isinstance(pi[0].get("amount"), (int, float)) and pi[0]["amount"] > 0):
            fails.append("paymentInfos.missing_on_instant")
    if gst_required and not isinstance(payload.get("gstInfo"), dict):
        fails.append("gstInfo.required")
    d = payload.get("deliveryInfo") if isinstance(payload.get("deliveryInfo"), dict) else {}
    emails, contacts, codes = d.get("emails"), d.get("contacts"), d.get("code")
    if not (isinstance(emails, list) and emails and all(isinstance(e, str) and _EMAIL_RE.match(e) for e in emails)):
        fails.append("deliveryInfo.emails.invalid")
    if not (isinstance(contacts, list) and contacts and all(isinstance(c, str) and c.isdigit() for c in contacts)):
        fails.append("deliveryInfo.contacts.invalid")
    if not (isinstance(codes, list) and codes and all(isinstance(c, str) and _DIAL_RE.match(c) for c in codes)):
        fails.append("deliveryInfo.code.invalid")
    if isinstance(contacts, list) and isinstance(codes, list):
        for c, k in zip(contacts, codes):
            if k == "+91" and isinstance(c, str) and not (len(c) == 10 and c[:1] in "6789"):
                fails.append("deliveryInfo.contacts.indian_format")
                break
    rti = payload.get("roomTravellerInfo")
    if not isinstance(rti, list) or len(rti) != len(rooms):
        fails.append("roomTravellerInfo.room_count")
        return fails
    leads = []
    for ri, (block, room) in enumerate(zip(rti, rooms)):
        tis = block.get("travellerInfo") if isinstance(block, dict) else None
        if not isinstance(tis, list) or not tis:
            fails.append(f"room[{ri}].travellerInfo.empty")
            continue
        pts = [t.get("pt") for t in tis if isinstance(t, dict)]
        adults = int(room.get("adults") or 0)
        children = len(room.get("childAges") or [])
        if pts.count("ADULT") != adults or pts.count("CHILD") != children:
            fails.append(f"room[{ri}].occupancy_mismatch")
        for gi, t in enumerate(tis):
            where = f"room[{ri}].guest[{gi}]"
            titles = ADULT_TITLES if t.get("pt") == "ADULT" else CHILD_TITLES
            if t.get("ti") not in titles:
                fails.append(f"{where}.ti.invalid")
            for k in ("fN", "lN"):
                if not (isinstance(t.get(k), str) and _NAME_RE.match(t[k])):
                    fails.append(f"{where}.{k}.invalid")
            pan = t.get("pan")
            if pan_required and not (isinstance(pan, str) and _PAN_RE.match(pan)):
                fails.append(f"{where}.pan.required")
            elif pan is not None and not (isinstance(pan, str) and _PAN_RE.match(pan)):
                fails.append(f"{where}.pan.format")
            if passport_required and not (isinstance(t.get("pNum"), str) and t["pNum"].strip()):
                fails.append(f"{where}.pNum.required")
        lead = tis[0]
        leads.append((str(lead.get("fN", "")).lower(), str(lead.get("lN", "")).lower()))
    if len(set(leads)) != len(leads):
        fails.append("roomTravellerInfo.lead_not_unique")
    return fails


def build_details_payload(booking_id: str) -> dict[str, Any]:
    if not booking_id:
        raise ValueError("missing_booking_id")
    return {"bookingId": booking_id}


def build_confirm_payload(booking_id: str, amount: float) -> dict[str, Any]:
    if not booking_id:
        raise ValueError("missing_booking_id")
    if not (isinstance(amount, (int, float)) and amount > 0):
        raise ValueError("invalid_amount")
    return {"bookingId": booking_id, "paymentInfos": [{"amount": round(float(amount), 2)}]}


def cancel_path(booking_id: str) -> str:
    if not booking_id or not re.match(r"^[A-Za-z0-9_-]{1,64}$", booking_id):
        raise ValueError("invalid_booking_id")
    return f"{HOTEL_CANCEL_BOOKING_PATH}/{booking_id}"


# ------------------------------------------------------------------ outputs --


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None and not isinstance(v, bool) else None
    except (TypeError, ValueError):
        return None


def _map(v: Any) -> dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _error_code(body: Any) -> Optional[str]:
    if not isinstance(body, dict):
        return None
    err = body.get("error")
    if isinstance(err, dict) and err.get("code") is not None:
        return str(err.get("code"))
    errs = body.get("errors")
    if isinstance(errs, list) and errs and isinstance(errs[0], dict):
        c = errs[0].get("errCode") or errs[0].get("code")
        return str(c) if c is not None else None
    return None


@dataclass
class ProviderAck:
    """Book / confirm / cancel acknowledgement. `accepted` only on explicit success."""

    accepted: bool
    booking_id: Optional[str] = None
    error_code: Optional[str] = None


def parse_ack(body: Any, *, expected_booking_id: Optional[str] = None) -> ProviderAck:
    if not isinstance(body, dict):
        return ProviderAck(False, error_code="MALFORMED")
    status = _map(body.get("status"))
    code = _error_code(body)
    returned = body.get("bookingId")
    returned = str(returned) if returned not in (None, "") else None
    if status.get("success") is not True or code:
        return ProviderAck(False, returned, code or "REJECTED")
    if expected_booking_id and returned and returned != expected_booking_id:
        return ProviderAck(False, returned, "BOOKING_ID_MISMATCH")
    return ProviderAck(True, returned or expected_booking_id, None)


@dataclass
class PenaltyWindow:
    from_: Optional[str]
    to: Optional[str]
    amount: Optional[float]


@dataclass
class BookingDetails:
    provider_status: Optional[str]  # raw TripJack order.status (UPPER) or None
    known: bool
    amount: Optional[float] = None
    hold_deadline: Optional[str] = None
    confirmation_number: Optional[str] = None
    refundable: Optional[bool] = None
    penalties: list[PenaltyWindow] = field(default_factory=list)
    error_code: Optional[str] = None


def parse_booking_details(body: Any) -> BookingDetails:
    """Defensive parser. A malformed reply is 'unknown', never success/failure."""
    if not isinstance(body, dict):
        return BookingDetails(None, False, error_code="MALFORMED")
    code = _error_code(body)
    status = _map(body.get("status"))
    order = _map(body.get("order"))
    raw = order.get("status")
    pstatus = str(raw).strip().upper() if isinstance(raw, str) and raw.strip() else None
    if status.get("success") is False or code:
        return BookingDetails(pstatus, False, error_code=code or "REJECTED")
    hotel = _map(_map(body.get("itemInfos")).get("HOTEL"))
    ops = _map(hotel.get("hInfo")).get("ops")
    op = ops[0] if isinstance(ops, list) and ops and isinstance(ops[0], dict) else {}
    cnp = _map(op.get("cnp"))
    penalties = []
    for p in cnp.get("pd") or []:
        if isinstance(p, dict):
            penalties.append(PenaltyWindow(
                from_=p.get("fdt") or p.get("from"),
                to=p.get("tdt") or p.get("to"),
                amount=_num(p.get("am") if "am" in p else p.get("amount")),
            ))
    conf = body.get("hotelConfirmationNumber") or hotel.get("hotelConfirmationNumber") \
        or _map(hotel.get("hInfo")).get("hotelConfirmationNumber")
    return BookingDetails(
        provider_status=pstatus,
        known=pstatus in PROVIDER_KNOWN,
        amount=_num(order.get("amount")),
        hold_deadline=str(op["ddt"]) if op.get("ddt") else None,
        confirmation_number=str(conf) if conf else None,
        refundable=cnp.get("ifra") if isinstance(cnp.get("ifra"), bool) else None,
        penalties=penalties,
    )


@dataclass
class FreshReview:
    """Provider-only facts from the Review call made immediately before Book."""

    booking_id: Optional[str]
    total: Optional[float]
    onhold_allowed: bool
    pan_required: bool
    passport_required: bool
    gst_type: Optional[str]
    hold_deadline: Optional[str]


def parse_fresh_review(body: Any) -> FreshReview:
    b = body if isinstance(body, dict) else {}
    opt = _map(b.get("option"))
    comp = _map(opt.get("compliance"))
    pricing = _map(opt.get("pricing"))
    canc = _map(opt.get("cancellation"))
    raw_hold = b.get("onholdAllowed")
    return FreshReview(
        booking_id=str(b["bookingId"]) if b.get("bookingId") else None,
        total=_num(pricing.get("totalPrice")),
        onhold_allowed=str(raw_hold).strip().lower() == "true",
        pan_required=comp.get("panRequired") is True,
        passport_required=comp.get("passportRequired") is True,
        gst_type=str(comp["gstType"]).upper() if comp.get("gstType") else None,
        hold_deadline=str(canc.get("deadlineDateTime") or opt.get("deadlineDateTime") or "") or None,
    )
