"""Hotel v3 Book / Booking Details / Confirm Hold / Cancel lifecycle. Mocks only —
no real TripJack call is ever made."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.diagnostics import hotel_certification as cert
from app.integrations.tripjack import hotel_booking as wire
from app.integrations.tripjack import hotels as tj
from app.integrations.tripjack.exceptions import TripJackBadRequestError, TripJackTimeoutError
from app.schemas.hotels import (
    HotelContactInput,
    HotelGuestInput,
    HotelOccupancy,
    HotelStay,
    HotelSummary,
)
from app.services import hotel_booking as bk
from app.services import hotel_search as svc
from app.services import hotel_sessions as sessions
from tests.test_hotel_detail import Cfg, FakeClient, option, reply
from tests.test_hotel_review import review_reply

HID = "100000001897"
TOTAL = 2136.07
PAN1, PAN2 = "ABCDE1234F", "PQRSX6789Z"


def settings(prod=False):
    return SimpleNamespace(supabase_url="", supabase_service_role_key="", is_production=prod,
                           supabase_rest_timeout=5.0)


class FakeBooker:
    def __init__(self, replies=None):
        self.replies = list(replies or [])
        self.calls: list[tuple[str, object]] = []

    async def post(self, path, payload, *, retries=0, operation=""):
        self.calls.append((path, payload))
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    async def post_no_body(self, path, *, operation=""):
        self.calls.append((path, None))
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def ok(bid="BK-1", **extra):
    return {"bookingId": bid, "status": {"success": True}, **extra}


def details(status, ddt=None, conf=None, amount=TOTAL):
    op = {"tp": amount, "cnp": {"ifra": True, "pd": [{"fdt": "2026-10-01", "tdt": "2026-10-20", "am": 0}]}}
    if ddt:
        op["ddt"] = ddt
    b = {"status": {"success": True}, "order": {"status": status, "amount": amount},
         "itemInfos": {"HOTEL": {"hInfo": {"ops": [op]}}}}
    if conf:
        b["hotelConfirmationNumber"] = conf
    return b


FUTURE = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%S")
PAST = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")


@pytest.fixture(autouse=True)
def clean_memory():
    bk._memory.by_ref.clear()
    bk._memory.events.clear()
    yield


@pytest.fixture
def wired(monkeypatch):
    hms = FakeClient([])
    booker = FakeBooker()
    monkeypatch.setattr(svc, "_provider", lambda s: (hms, Cfg))
    monkeypatch.setattr(bk, "provider_factory", lambda s: bk.Provider(hms, booker))
    return SimpleNamespace(hms=hms, booker=booker)


def review_session(rooms=None, total=TOTAL, pan_required=True, user_id="u1"):
    rooms = rooms or [HotelOccupancy(adults=2)]
    room = tj._room_option(option(total=total), "INR")
    return sessions.ReviewSession(
        token="r" * 48, row_id=None, search_id="", hotel=HotelSummary(id=HID, name="Live Name"),
        room=room, stay=HotelStay(check_in="2026-10-28", check_out="2026-10-29", nights=1, rooms=rooms),
        currency="INR", expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        provider_search_id="LIST-CORR", provider_hotel_id=HID, provider_option_id=room.id,
        user_id=user_id, requirements={"panRequired": pan_required},
    )


def guests(rooms=1, pans=(PAN1, PAN2), child=False):
    out, i = [], 0
    names = ["Asha", "Ravi", "Meera", "Karan", "Divya", "Arjun"]
    for r in range(1, rooms + 1):
        for _ in range(2):
            out.append(HotelGuestInput(type="adult", room_index=r, is_lead=(i == 0), title="Mr",
                                       first_name=names[i], last_name="Sharma",
                                       pan_number=pans[i % len(pans)] if pans else None))
            i += 1
        if child:
            out.append(HotelGuestInput(type="child", room_index=r, first_name="Tara", last_name="Sharma",
                                       age=6, pan_number=pans[0] if pans else None))
    return out


def contact(phone="9876543210"):
    return HotelContactInput(email="ops@flynfeel.in", phone=phone, dial_code="+91")


def draft(ref="FNFHA1B2C3", **kw):
    rs = review_session(**{k: v for k, v in kw.items() if k in ("rooms", "total", "pan_required")})
    g = kw.get("guests") or guests()
    return asyncio.run(bk.create_draft(settings=settings(), review_session=rs, booking_reference=ref,
                                       guests=g, contact=kw.get("contact") or contact(),
                                       special_requests=None, nationality="IN"))


def prebook(wired, review=None, detail=None):
    wired.hms.replies += [detail or reply(), review or review_reply()]


def do_book(mode="instant", ref="FNFHA1B2C3", key="k1", prod=False, user="u1"):
    return asyncio.run(bk.book(settings=settings(prod), reference=ref, mode=mode, user_id=user,
                               guest_token=None, idempotency_key=key))


# ------------------------------------------------------------ Book request --


def test_instant_book_request(wired):
    draft()
    prebook(wired)
    wired.booker.replies.append(ok("BK-SECRET"))
    b = do_book("instant")
    path, p = wired.booker.calls[0]
    assert path == wire.HOTEL_BOOK_PATH
    assert p["bookingId"] == "BK-SECRET" and p["type"] == "HOTEL"
    assert p["paymentInfos"] == [{"amount": TOTAL}]  # server Review amount
    assert p["deliveryInfo"] == {"emails": ["ops@flynfeel.in"], "contacts": ["9876543210"], "code": ["+91"]}
    assert [t["pan"] for t in p["roomTravellerInfo"][0]["travellerInfo"]] == [PAN1, PAN2]
    assert "gstInfo" not in p
    assert b.status == bk.BOOKING_IN_PROGRESS and b.mode == "instant"
    assert all("pan_number" not in g for g in b.guests)  # scrubbed after Book


def test_hold_book_request_has_no_payment(wired):
    draft()
    prebook(wired)
    wired.booker.replies.append(ok("BK-SECRET"))
    do_book("hold")
    p = wired.booker.calls[0][1]
    assert "paymentInfos" not in p


def test_hold_refused_when_review_disallows(wired):
    draft()
    prebook(wired, review=review_reply(onholdAllowed="false"))
    with pytest.raises(bk.HotelHoldNotAllowedError):
        do_book("hold")
    assert wired.booker.calls == []
    assert bk._memory.by_ref["FNFHA1B2C3"].status == bk.DRAFT


def test_price_authority_refuses_changed_total(wired):
    draft()
    prebook(wired, detail=reply(options=[option(total=2500.0)]),
            review=review_reply(opt=option(total=2500.0)))
    with pytest.raises(bk.HotelBookingPriceChangedError):
        do_book()
    assert wired.booker.calls == []


def test_instant_refused_in_production_without_payment(wired):
    draft()
    with pytest.raises(bk.HotelPaymentRequiredError):
        do_book("instant", prod=True)
    assert wired.hms.calls == [] and wired.booker.calls == []


def test_preflight_validation_blocks_bad_phone(wired):
    draft(contact=contact(phone="+44 20 7946 0958"))
    prebook(wired)
    with pytest.raises(bk.HotelBookingValidationError):
        do_book()
    assert wired.booker.calls == []


def test_pan_required_missing_blocks(wired):
    draft(guests=guests(pans=()))
    prebook(wired)
    with pytest.raises(bk.HotelBookingValidationError) as e:
        do_book()
    assert any("pan.required" in r for r in e.value.details["rules"])


def test_passport_required(wired):
    draft()
    opt = option(compliance={"gstType": "NA", "panRequired": True, "passportRequired": True})
    prebook(wired, review=review_reply(opt=opt))
    with pytest.raises(bk.HotelBookingValidationError) as e:
        do_book()
    assert any("pNum.required" in r for r in e.value.details["rules"])


def test_gst_required(wired):
    draft()
    opt = option(compliance={"gstType": "PASSTHROUGH", "panRequired": True})
    prebook(wired, review=review_reply(opt=opt))
    with pytest.raises(bk.HotelBookingValidationError) as e:
        do_book()
    assert "gstInfo.required" in e.value.details["rules"]


def test_multiple_rooms_adults_children_same_pan(wired):
    rooms = [HotelOccupancy(adults=2, child_ages=[6]), HotelOccupancy(adults=2, child_ages=[6])]
    two_room = option(total=TOTAL, roomInfo=[{"id": "r1", "name": "Deluxe", "adults": 2, "children": 1},
                                             {"id": "r2", "name": "Deluxe", "adults": 2, "children": 1}])
    rs = review_session(rooms=rooms)
    rs.room = tj._room_option(two_room, "INR")
    rs.provider_option_id = rs.room.id
    asyncio.run(bk.create_draft(settings=settings(), review_session=rs, booking_reference="FNFHA1B2C3",
                                guests=guests(rooms=2, pans=(PAN1,), child=True), contact=contact(),
                                special_requests=None, nationality="IN"))
    prebook(wired, detail=reply(options=[two_room]), review=review_reply(opt=two_room))
    wired.booker.replies.append(ok("BK-SECRET"))
    do_book()
    rti = wired.booker.calls[0][1]["roomTravellerInfo"]
    assert len(rti) == 2
    for block in rti:
        assert [t["pt"] for t in block["travellerInfo"]] == ["ADULT", "ADULT", "CHILD"]
        assert block["travellerInfo"][2]["ti"] == "Master"
        assert {t["pan"] for t in block["travellerInfo"]} == {PAN1}  # same PAN everywhere


def test_international_booking_nationality_used(wired):
    rs = review_session()
    b = asyncio.run(bk.create_draft(settings=settings(), review_session=rs, booking_reference="FNFHA1B2C3",
                                    guests=guests(), contact=contact(), special_requests=None,
                                    nationality="IN"))
    assert b.nationality == "IN"
    prebook(wired)
    wired.booker.replies.append(ok("BK-SECRET"))
    do_book()
    assert wired.hms.calls[0][1]["nationality"] == "106"


# ----------------------------------------------- duplicates / idempotency --


def test_duplicate_booking_prevented_and_idempotent_replay(wired):
    draft()
    prebook(wired)
    wired.booker.replies.append(ok("BK-SECRET"))
    first = do_book(key="same")
    again = do_book(key="same")
    assert again.status == first.status
    with pytest.raises(bk.HotelBookingDuplicateError):
        do_book(key="other")
    assert len([c for c in wired.booker.calls if c[0] == wire.HOTEL_BOOK_PATH]) == 1


def test_invalid_transition_rejected():
    assert not bk.can_transition(bk.CONFIRMED, bk.ON_HOLD)
    assert not bk.can_transition(bk.CANCELLED, bk.CONFIRMED)
    assert not bk.can_transition(bk.FAILED, bk.BOOKING_IN_PROGRESS)
    assert bk.can_transition(bk.ON_HOLD, bk.CONFIRMING)


def test_other_owner_cannot_book(wired):
    draft()
    with pytest.raises(bk.HotelBookingNotFoundError):
        do_book(user="someone-else")


# --------------------------------------------------------- provider errors --


def test_rejected_book_no_polling(wired):
    draft()
    prebook(wired)
    wired.booker.replies.append({"status": {"success": False}, "error": {"code": "810", "message": "bad"}})
    b = do_book()
    assert b.status == bk.FAILED
    assert len(wired.booker.calls) == 1  # no booking-details, no cancel


def test_bad_request_book_fails(wired):
    draft()
    prebook(wired)
    wired.booker.replies.append(TripJackBadRequestError("x"))
    assert do_book().status == bk.FAILED


def test_timeout_keeps_in_progress_then_details_resolves(wired):
    draft()
    prebook(wired)
    wired.booker.replies += [TripJackTimeoutError("t"), details("SUCCESS", conf="HCN-77")]
    b = do_book()
    assert b.status == bk.BOOKING_IN_PROGRESS and b.provider_booking_id == "BK-SECRET"
    b = asyncio.run(bk.get_booking(settings=settings(), reference="FNFHA1B2C3", user_id="u1", guest_token=None))
    assert b.status == bk.CONFIRMED and b.hotel_confirmation_number == "HCN-77"


def test_malformed_provider_response():
    assert wire.parse_ack("not json").accepted is False
    d = wire.parse_booking_details(["x"])
    assert d.known is False and d.provider_status is None
    d = wire.parse_booking_details({"status": {"success": True}, "order": {"status": "WEIRD"}})
    assert d.known is False


# ------------------------------------------------------------------ polling --


def _in_progress(wired, mode="instant"):
    draft()
    prebook(wired)
    wired.booker.replies.append(ok("BK-SECRET"))
    return do_book(mode)


@pytest.mark.parametrize("pstatus,state", [("SUCCESS", bk.CONFIRMED), ("ON_HOLD", bk.ON_HOLD),
                                           ("ABORTED", bk.ABORTED), ("FAILED", bk.FAILED),
                                           ("CANCELLED", bk.CANCELLED)])
def test_polling_terminal_states(wired, pstatus, state):
    b = _in_progress(wired, "hold" if pstatus == "ON_HOLD" else "instant")
    wired.booker.replies += [details("PENDING"), details(pstatus, ddt=FUTURE)]
    sleeps = []

    async def fake_sleep(s):
        sleeps.append(s)

    store = bk.BookingStore(settings())
    b = asyncio.run(bk.poll_until_terminal(store, bk.provider_factory(None), b, sleep=fake_sleep))
    assert b.status == state and sleeps == [5.0]


def test_polling_stops_at_180s(wired):
    b = _in_progress(wired)
    wired.booker.replies += [details("PENDING")] * 40
    sleeps = []

    async def fake_sleep(s):
        sleeps.append(s)

    b = asyncio.run(bk.poll_until_terminal(bk.BookingStore(settings()), bk.provider_factory(None), b,
                                           sleep=fake_sleep))
    assert b.status == bk.BOOKING_IN_PROGRESS and sum(sleeps) <= 180 and len(sleeps) == 36
    assert b.status_message


# --------------------------------------------------------- hold / confirm --


def _on_hold(wired, ddt=FUTURE):
    b = _in_progress(wired, "hold")
    wired.booker.replies.append(details("ON_HOLD", ddt=ddt))
    b = asyncio.run(bk.get_booking(settings=settings(), reference="FNFHA1B2C3", user_id="u1", guest_token=None))
    assert b.status == bk.ON_HOLD and b.hold_deadline == ddt
    return b


def test_hold_deadline_from_tripjack_and_confirm(wired):
    _on_hold(wired)
    wired.booker.replies += [ok("BK-SECRET")]
    b = asyncio.run(bk.confirm_hold(settings=settings(), reference="FNFHA1B2C3", user_id="u1", guest_token=None))
    path, p = wired.booker.calls[-1]
    assert path == wire.HOTEL_CONFIRM_BOOK_PATH
    assert p == {"bookingId": "BK-SECRET", "paymentInfos": [{"amount": TOTAL}]}
    assert b.status == bk.CONFIRMING
    with pytest.raises(bk.HotelBookingDuplicateError):
        asyncio.run(bk.confirm_hold(settings=settings(), reference="FNFHA1B2C3", user_id="u1", guest_token=None))


def test_expired_hold_cannot_confirm(wired):
    _on_hold(wired, ddt=PAST)
    n = len(wired.booker.calls)
    with pytest.raises(bk.HotelHoldExpiredError):
        asyncio.run(bk.confirm_hold(settings=settings(), reference="FNFHA1B2C3", user_id="u1", guest_token=None))
    assert len(wired.booker.calls) == n


def test_confirm_rejected_returns_to_hold(wired):
    _on_hold(wired)
    wired.booker.replies.append({"status": {"success": False}})
    b = asyncio.run(bk.confirm_hold(settings=settings(), reference="FNFHA1B2C3", user_id="u1", guest_token=None))
    assert b.status == bk.ON_HOLD


def test_confirm_refused_in_production_without_payment(wired):
    _on_hold(wired)
    with pytest.raises(bk.HotelPaymentRequiredError):
        asyncio.run(bk.confirm_hold(settings=settings(True), reference="FNFHA1B2C3", user_id="u1",
                                    guest_token=None))


# ------------------------------------------------------------ cancellation --


def _confirmed(wired):
    _in_progress(wired)
    wired.booker.replies.append(details("SUCCESS"))
    return asyncio.run(bk.get_booking(settings=settings(), reference="FNFHA1B2C3", user_id="u1", guest_token=None))


def _cancel():
    return asyncio.run(bk.cancel(settings=settings(), reference="FNFHA1B2C3", user_id="u1", guest_token=None))


def test_cancellation_success(wired):
    _confirmed(wired)
    wired.booker.replies += [ok("BK-SECRET"), details("CANCELLED")]
    b = _cancel()
    assert wired.booker.calls[-2] == (f"{wire.HOTEL_CANCEL_BOOKING_PATH}/BK-SECRET", None)  # no body
    assert b.status == bk.CANCELLED


def test_cancellation_pending_not_polled_continuously(wired):
    _confirmed(wired)
    wired.booker.replies += [ok("BK-SECRET"), details("CANCELLATION_PENDING")]
    b = _cancel()
    assert b.status == bk.CANCELLATION_PENDING
    n = len(wired.booker.calls)
    asyncio.run(bk.get_booking(settings=settings(), reference="FNFHA1B2C3", user_id="u1", guest_token=None))
    assert len(wired.booker.calls) == n  # throttled, no immediate re-poll
    assert _cancel().status == bk.CANCELLATION_PENDING  # idempotent, no second cancel call
    assert len(wired.booker.calls) == n


def test_cancellation_failure_restores_state(wired):
    _confirmed(wired)
    wired.booker.replies.append({"status": {"success": False}, "error": {"code": "X"}})
    assert _cancel().status == bk.CONFIRMED


def test_cancel_on_hold(wired):
    _on_hold(wired)
    wired.booker.replies += [ok("BK-SECRET"), details("CANCELLED")]
    assert _cancel().status == bk.CANCELLED


# ------------------------------------------------------------------ leakage --


def test_api_view_never_leaks_provider_fields(wired):
    from app.api.v1.hotels import _view

    b = _confirmed(wired)
    text = _view(b).model_dump_json(by_alias=True)
    for leak in ("BK-SECRET", "LIST-CORR", PAN1, PAN2, "provider", "reviewHash"):
        assert leak not in text


# ------------------------------------------------------------ certification --


def test_certification_cases_and_redaction(tmp_path, monkeypatch):
    assert len(cert.CASES) == 14
    r = cert.build_record(case="INSTANT_DOMESTIC", request={"bookingId": "x", "roomTravellerInfo": [
        {"travellerInfo": [{"pan": PAN1, "fN": "A"}]}], "deliveryInfo": {"emails": ["a@b.in"]}},
        final_status="CONFIRMED")
    s = str(r)
    assert PAN1 not in s and "a@b.in" not in s and r["confirmation_number"] is None
    with pytest.raises(ValueError):
        cert.build_record(case="NOPE")
    f = tmp_path / "ev.jsonl"
    monkeypatch.setattr(cert, "EVIDENCE_FILE", f)
    asyncio.run(cert.save(r, settings=settings()))
    assert cert.report(f)["INSTANT_DOMESTIC"][0]["final_status"] == "CONFIRMED"
