"""TripJack Hotel v3 certification — Test Case 12 capture/export (UAT ONLY).

Matches Aryan's Test Case 12 sample:
  * 1 room: 2 adults + 1 child (age 7); 1 night, INR, nationality 231
  * Review: passportRequired=true, panRequired=false, isRefundable=true
    (onholdAllowed=true in the sample and still booked instantly: not a gate)
  * flow: search -> detail -> review -> INSTANT Book (paymentInfos.amount =
    Review totalPrice) -> booking-details SUCCESS -> cancel-booking/{id}
    (no body) -> booking-details until exactly CANCELLED
  * Book: every ADULT carries pNum, pDoE, dob, nationality (no pan);
    the CHILD carries only ti/pt/fN/lN/age
  * cancellation policy files derived from the Review (hid, optionId, reviewHash)

15 files in "Test Case 12/" (same names as Cases 10/11; after-cancel details
is Response-only). Cases 1-11 are reused, never changed.

    python -m app.diagnostics.hotel_cert_tc12 --destination Dubai \\
        --contact-email <email> --contact-phone <10 digits> \\
        --passport <no> --passport-expiry YYYY-MM-DD --dob YYYY-MM-DD \\
        --lead-guest "First Last" [--execute-uat-book --confirm CREATE-UAT-BOOK]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
import zipfile
from datetime import date
from pathlib import Path
from typing import Any, Optional

from app.diagnostics import hotel_cert_tc2 as tc2
from app.diagnostics import hotel_cert_tc3 as tc3
from app.diagnostics import hotel_cert_tc4 as tc4
from app.diagnostics import hotel_cert_tc10 as tc10
from app.diagnostics import hotel_listing_uat as uat

CASE_FOLDER = "Test Case 12"
ZIP_NAME = "Test_Case_12.zip"
BOOK_CONFIRM_PHRASE = tc10.BOOK_CONFIRM_PHRASE
CANCELLED = tc10.CANCELLED
BOOKED_STATUSES = tc10.BOOKED_STATUSES
FAIL_STATUSES = tc10.FAIL_STATUSES
NATIONALITY = "231"

TC12_ROOMS: list[dict[str, Any]] = [{"adults": 2, "childAges": [7]}]
TC12_NIGHTS = 1

FILES = tc4.FILES
FILENAMES: tuple[str, ...] = tc4.FILENAMES
review_is_refundable = tc10.review_is_refundable
parse_lead_guest = tc10.parse_lead_guest

_PASSPORT_RE = re.compile(r"^[A-Z0-9]{6,12}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _iso(value: str) -> Optional[date]:
    if not (isinstance(value, str) and _DATE_RE.match(value)):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def passport_failures(passport: str, expiry: str, dob: str, check_out: str = "") -> list[str]:
    """Shape checks only; values are never printed."""
    fails: list[str] = []
    if not _PASSPORT_RE.match((passport or "").strip().upper()):
        fails.append("--passport: 6-12 letters/digits")
    exp, born = _iso(expiry), _iso(dob)
    if exp is None:
        fails.append("--passport-expiry: YYYY-MM-DD")
    elif _iso(check_out) and exp <= _iso(check_out):
        fails.append("--passport-expiry: must be after check-out")
    if born is None:
        fails.append("--dob: YYYY-MM-DD")
    elif born >= date.today().replace(year=date.today().year - 18):
        fails.append("--dob: adult must be 18 or older")
    return fails


def review_requires_passport_not_pan(review: Any) -> bool:
    reqs = uat.book_requirements(review)
    yes = lambda v: v is True or (isinstance(v, str) and v.strip().lower() == "true")
    return yes(reqs["passport_required"]) and not yes(reqs["pan_required"])


def build_payload(review: dict, session, args) -> tuple[dict, list[str]]:
    """Sample layout: adults get pNum/pDoE/dob/nationality (no pan); child gets age."""
    rooms = uat._rooms_from_session(session)
    first, last = parse_lead_guest(args.lead_guest) if args.lead_guest else ("", "")
    hold = uat.build_uat_book_payload(
        booking_id=str(review["bookingId"]), rooms=rooms,
        email=args.contact_email or "uat@example.invalid", phone=args.contact_phone or "9000000000",
        pan="", lead_guest="",
    )
    ages = [a for r in rooms for a in (r.get("childAges") or [])]
    passport = (args.passport or "").strip().upper()
    ci = 0
    for block in hold["roomTravellerInfo"]:
        for gi, t in enumerate(block["travellerInfo"]):
            t.pop("pan", None)
            if gi == 0:
                t["isLeadGuest"] = True
            if t["pt"] == "CHILD":
                for k in ("pNum", "pDoE", "dob", "nationality"):
                    t.pop(k, None)
                t["age"] = ages[ci]
                ci += 1
            else:
                t["pNum"], t["pDoE"], t["dob"] = passport, args.passport_expiry, args.dob
                t["nationality"] = NATIONALITY
    if first:
        lead = hold["roomTravellerInfo"][0]["travellerInfo"][0]
        lead["fN"], lead["lN"] = first, last
    failures = list(uat.validate_book_payload(hold, rooms, pan_required=False, passport_required=True))
    failures += passport_failures(passport, args.passport_expiry, args.dob, getattr(session, "check_out", ""))
    amount = tc2.review_total(review)
    if amount is None:
        raise SystemExit("Review has no positive option.pricing.totalPrice; Book NOT called.")
    return tc2.build_instant_payload(hold, amount), failures


async def _session_via_search(args, settings):
    """Normal /api/v1/hotels/search in-process, with nationality 231."""
    import httpx
    from app.main import create_app
    from app.services import hotel_sessions as sessions

    ci, co = uat.dates(args.days_ahead, TC12_NIGHTS)
    body = {"destination": args.destination, "checkIn": ci, "checkOut": co,
            "rooms": [dict(r) for r in TC12_ROOMS], "nationality": NATIONALITY, "currency": "INR"}
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://diag") as c:
        r = await c.post("/api/v1/hotels/search", json=body)
    print("search HTTP status:", r.status_code)
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    token = data.get("searchId") if isinstance(data, dict) else None
    if r.status_code >= 400 or not token:
        raise SystemExit("Search did not produce a session.")
    session = await sessions.get_search_session(settings=settings, search_id=token)
    if session is None:
        raise SystemExit("Saved search session could not be loaded.")
    return session


async def _fresh_review(args):
    """First option whose Review succeeds, is refundable and asks for passport
    (not PAN). Read-only: Book never runs here."""
    settings, config = uat._config()
    session = await _session_via_search(args, settings)
    if not session.provider_search_id:
        raise SystemExit("Session has no listing correlationId.")
    if args.hotel_id:
        hotel_ids = [args.hotel_id] if args.hotel_id in session.results else []
    else:
        priced = [h for h, r in session.results.items() if getattr(r, "rate", None)]
        hotel_ids = priced or list(session.results)
    if not hotel_ids:
        raise SystemExit("No hotel id from this search session.")
    limit = max(1, int(args.max_instant_candidates or 30))
    tried = 0
    for hid in hotel_ids:
        status, detail, _ = await uat._raw_post(config, uat.build_uat_pricing_payload(
            listing_correlation_id=session.provider_search_id, hid=hid, check_in=session.check_in,
            check_out=session.check_out, rooms=uat._rooms_from_session(session),
            currency=session.currency, nationality=NATIONALITY,
        ), uat.HOTEL_PRICING_PATH)
        print("DETAIL HTTP status:", status)
        candidates = uat._detail_candidates(detail, "") if status < 400 else []
        if not candidates or not isinstance(detail, dict) or not detail.get("reviewHash"):
            print("DETAIL: no priced option / reviewHash; trying next hotel.")
            continue
        for option in candidates:
            if tried >= limit:
                break
            tried += 1
            status, review, _ = await uat._raw_post(config, uat.build_uat_review_payload(
                listing_correlation_id=session.provider_search_id, hid=hid,
                option_id=str(option["optionId"]), review_hash=str(detail["reviewHash"]),
            ), uat.HOTEL_REVIEW_PATH)
            rs = uat.review_summary(review, hid, option)
            print("REVIEW HTTP status:", status, "success:", rs.get("status_success"))
            if not (status < 400 and rs.get("status_success") is True and isinstance(review, dict)):
                print(f"CANDIDATE {tried}: review failed; skipping.")
                continue
            if not review_is_refundable(review):
                print(f"CANDIDATE {tried}: non-refundable; skipping.")
                continue
            if not review_requires_passport_not_pan(review):
                print(f"CANDIDATE {tried}: Review does not ask passport-only; skipping.")
                continue
            print("REFUNDABLE PASSPORT OPTION FOUND:",
                  json.dumps(uat.hold_candidate_summary(review, option), default=str))
            return config, session, review
        if tried >= limit:
            break
    raise SystemExit(f"NO SUITABLE OPTION: reviewed {tried} option(s) (limit {limit}); none was a "
                     "successful, refundable, passport-required Review. Book NOT called.")


async def run_book_and_cancel(args) -> None:
    config, session, review = await _fresh_review(args)
    reqs = uat.book_requirements(review)
    print("BOOK REQUIREMENTS (from Review):", json.dumps(reqs, indent=1))
    execute = bool(args.execute_uat_book)
    if not reqs["booking_id_present"]:
        raise SystemExit("Review returned no bookingId; Book cannot be built.")
    if reqs["gst_info_needed"]:
        raise SystemExit("Review needs gstInfo; not supported. Book NOT called.")
    payload, failures = build_payload(review, session, args)
    print("BOOK REQUEST (INSTANT, keys/types only):", json.dumps(uat.shape(payload), indent=1))
    print("PRE-FLIGHT VALIDATION:", "OK" if not failures else "FAILED")
    for f in failures:
        print("  -", f)
    if not execute:
        print(f"DRY RUN: Book and Cancel NOT called. Re-run with --execute-uat-book --confirm {BOOK_CONFIRM_PHRASE}.")
        return
    if args.confirm != BOOK_CONFIRM_PHRASE:
        raise SystemExit(f"Refusing: --confirm {BOOK_CONFIRM_PHRASE} is required.")
    if not (args.contact_email and args.contact_phone):
        raise SystemExit("Refusing: --contact-email and --contact-phone are required.")
    if failures:
        raise SystemExit(f"Refusing: {len(failures)} pre-flight failure(s); Book NOT called.")
    print("WARNING: creating a REAL TripJack UAT INSTANT booking (debits the UAT wallet).")
    status, body, elapsed = await uat._booker_post(config, uat.HOTEL_BOOK_PATH, payload)
    print("BOOK HTTP status:", status, "elapsed_s:", elapsed)
    print("BOOK SUMMARY:", json.dumps(uat.book_summary(body), indent=1))
    if not uat.book_created(status, body):
        if uat.is_duplicate_booking(body):
            print("DUPLICATE BOOKING (errCode 2502): change --lead-guest or dates and retry.")
        raise SystemExit("Book rejected by TripJack; stopped. Cancel NOT called.")
    booking_id = body["bookingId"]
    booked = await tc4._poll(config, booking_id, args.poll_attempts, lambda s: s in BOOKED_STATUSES | FAIL_STATUSES)
    if booked not in BOOKED_STATUSES:
        raise SystemExit(f"Booking not SUCCESS (status={booked}); Cancel NOT called.")
    print("CANCELLING the UAT booking (cancel-booking/{bookingId}).")
    st, cb, _ = await uat._booker_post(config, f"{uat.HOTEL_CANCEL_BOOKING_PATH}/{booking_id}", None)
    print("CANCEL HTTP status:", st, "summary:", json.dumps(uat.book_summary(cb)))
    final = await tc4._poll(config, booking_id, args.cancel_poll_attempts, lambda s: s == CANCELLED)
    print("POST-CANCEL order_status:", final)
    if final != CANCELLED:
        raise SystemExit(f"Final status not CANCELLED (status={final}); nothing exported.")


def export(recorder: tc4.Recorder, out_dir: Path) -> Path:
    recorder.derive_cancellation()
    missing = [s for s, _, _ in FILES if s not in recorder.pairs]
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if "confirm" in recorder.pairs:
        raise SystemExit("Refusing export: Test Case 12 must not include a confirm-hold call.")
    review = recorder.pairs["review"][1]
    if not review_is_refundable(review):
        raise SystemExit("Refusing export: Review option is not refundable.")
    book_req = recorder.pairs["hold"][0]
    if not (isinstance(book_req, dict) and book_req.get("paymentInfos")):
        raise SystemExit("Refusing export: Book request has no paymentInfos (not an instant booking).")
    adults = [t for b in book_req.get("roomTravellerInfo", []) for t in b.get("travellerInfo", []) if t.get("pt") == "ADULT"]
    if not adults or not all(t.get("pNum") and t.get("nationality") == NATIONALITY for t in adults):
        raise SystemExit("Refusing export: every adult needs a passport and nationality 231.")
    if recorder.final_status() not in BOOKED_STATUSES:
        raise SystemExit(f"Refusing export: booking not SUCCESS before cancel (status={recorder.final_status()}).")
    cancel_resp = recorder.pairs["cancel"][1]
    if not (isinstance(cancel_resp, dict) and (cancel_resp.get("status") or {}).get("success") is True):
        raise SystemExit("Refusing export: cancel-booking did not return status.success=true.")
    if recorder.after_cancel_status() != CANCELLED:
        raise SystemExit(f"Refusing export: final status is not CANCELLED (status={recorder.after_cancel_status()}).")
    folder = out_dir / CASE_FOLDER
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    for step, stem, kinds in FILES:
        req, resp = recorder.pairs[step]
        for kind in kinds:
            body = req if kind == "Request" else resp
            text = body if (step == "cancel" and kind == "Request") else json.dumps(body, indent=2, ensure_ascii=False)
            (folder / f"{stem} {kind}.json").write_text(text, encoding="utf-8")
    zip_path = out_dir / ZIP_NAME
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILENAMES:
            z.write(folder / name, f"{CASE_FOLDER}/{name}")
    return zip_path


def build_args(ns: argparse.Namespace) -> argparse.Namespace:
    return argparse.Namespace(
        destination=ns.destination, days_ahead=ns.days_ahead, hotel_id=ns.hotel_id,
        max_instant_candidates=ns.max_instant_candidates, execute_uat_book=ns.execute_uat_book,
        confirm=ns.confirm, contact_email=ns.contact_email, contact_phone=ns.contact_phone,
        passport=ns.passport, passport_expiry=ns.passport_expiry, dob=ns.dob,
        lead_guest=ns.lead_guest, poll_attempts=36, cancel_poll_attempts=ns.cancel_poll_attempts,
    )


async def run(ns: argparse.Namespace) -> Optional[Path]:
    args = build_args(ns)
    recorder = tc4.Recorder()
    undo = tc3.install_capture(recorder)
    try:
        await run_book_and_cancel(args)
    finally:
        undo()
    if not args.execute_uat_book:
        print("DRY RUN: nothing exported.")
        return None
    zip_path = export(recorder, Path(ns.out_dir))
    print("TEST CASE 12 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc12")
    p.add_argument("--destination", default="Mumbai")
    p.add_argument("--hotel-id", default="")
    p.add_argument("--days-ahead", type=int, default=30)
    p.add_argument("--execute-uat-book", action="store_true")
    p.add_argument("--confirm", default="")
    p.add_argument("--contact-email", default="")
    p.add_argument("--contact-phone", default="")
    p.add_argument("--passport", default="", help="never printed")
    p.add_argument("--passport-expiry", default="", help="YYYY-MM-DD")
    p.add_argument("--dob", default="", help="YYYY-MM-DD, adult")
    p.add_argument("--lead-guest", default="")
    p.add_argument("--max-instant-candidates", type=int, default=30)
    p.add_argument("--cancel-poll-attempts", type=int, default=36)
    p.add_argument("--out-dir", default="certification")
    asyncio.run(run(p.parse_args(argv)))


if __name__ == "__main__":
    main()
