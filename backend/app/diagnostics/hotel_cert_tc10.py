"""TripJack Hotel v3 certification — Test Case 10 capture/export (UAT ONLY).

Matches Aryan's Test Case 10 sample:
  * 2 rooms: R1 2 adults + 1 child (age 5), R2 2 adults; 1 night, INR, nationality 106
  * flow: search -> detail -> review (refundable option) -> INSTANT Book
    (paymentInfos.amount = latest Review totalPrice) -> booking-details SUCCESS
    -> cancel-booking/{id} -> booking-details until exactly CANCELLED
  * cancellation policy files derived from the Review (hid, optionId, reviewHash)

15 files in "Test Case 10/" (the sample ZIP holds 15): same names as Case 4,
Cancel Request saved as the plain cancel URL, after-cancel details Response-only.

The sample's Review had onholdAllowed=true and was still booked instantly, so
the hold flag is NOT a gate here; the option must be refundable (cancel flow).
Reuses Case 4/5 helpers (recorder, payload, polling, lead name); none changed.

    python -m app.diagnostics.hotel_cert_tc10 --destination Mumbai \\
        --execute-uat-book --confirm CREATE-UAT-BOOK \\
        --contact-email <email> --contact-phone <10 digits> --pan <PAN> \\
        --lead-guest "First Last" [--out-dir certification]
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import shutil
import zipfile
from pathlib import Path
from typing import Any, Optional

from app.diagnostics import hotel_cert_tc2 as tc2
from app.diagnostics import hotel_cert_tc3 as tc3
from app.diagnostics import hotel_cert_tc4 as tc4
from app.diagnostics import hotel_listing_uat as uat

CASE_FOLDER = "Test Case 10"
ZIP_NAME = "Test_Case_10.zip"
BOOK_CONFIRM_PHRASE = "CREATE-UAT-BOOK"
BOOKED_STATUSES = {"SUCCESS"}
FAIL_STATUSES = {"FAILED", "ABORTED", "CANCELLED"}
CANCELLED = "CANCELLED"

TC10_ROOMS: list[dict[str, Any]] = [{"adults": 2, "childAges": [5]}, {"adults": 2, "childAges": []}]
TC10_NIGHTS = 1

FILES = tc4.FILES
FILENAMES: tuple[str, ...] = tc4.FILENAMES
Recorder = tc4.Recorder


def review_is_refundable(review: Any) -> bool:
    """True only when the Review's option cancellation explicitly says refundable."""
    opt = review.get("option") if isinstance(review, dict) else None
    canc = (opt or {}).get("cancellation") if isinstance(opt, dict) else None
    v = (canc or {}).get("isRefundable") if isinstance(canc, dict) else None
    return v is True or (isinstance(v, str) and v.strip().lower() == "true")


async def _fresh_refundable_instant_review(args: argparse.Namespace):
    """Case 10 picker: like tc2._fresh_instant_review, but an option counts only
    when Review says onholdAllowed=false AND the option is refundable — the
    cancel-flow test needs a booking that can actually be cancelled. Read-only:
    Book never runs here. Returns (config, session, option, review)."""
    settings, config = uat._config()
    if args.search_id:
        from app.services import hotel_sessions as sessions
        session = await sessions.get_search_session(settings=settings, search_id=args.search_id)
        if session is None:
            raise SystemExit("Search session not found or expired.")
    else:
        session = await uat._session_via_search(args, settings)
    if not session.provider_search_id:
        raise SystemExit("Session has no listing correlationId.")
    if args.hotel_id:
        hotel_ids = [args.hotel_id] if args.hotel_id in session.results else []
    else:
        priced = [hid for hid, r in session.results.items() if getattr(r, "rate", None)]
        hotel_ids = priced or list(session.results)
    if not hotel_ids:
        raise SystemExit("No hotel id from this search session.")
    limit = max(1, int(getattr(args, "max_instant_candidates", 30) or 30))
    tried = 0
    for hid in hotel_ids:
        status, detail, _ = await uat._raw_post(config, uat.build_uat_pricing_payload(
            listing_correlation_id=session.provider_search_id, hid=hid, check_in=session.check_in,
            check_out=session.check_out, rooms=uat._rooms_from_session(session), currency=session.currency,
        ), uat.HOTEL_PRICING_PATH)
        print("DETAIL HTTP status:", status)
        candidates = uat._detail_candidates(detail, getattr(args, "option_id", "")) if status < 400 else []
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
            print("REVIEW HTTP status:", status, "success:", rs.get("status_success"),
                  "total_matches_detail:", rs.get("review_total_matches_detail"))
            ok = status < 400 and rs.get("status_success") is True and isinstance(review, dict)
            if not ok:
                print(f"CANDIDATE {tried}: review failed; skipping.")
                continue
            safe = uat.hold_candidate_summary(review, option)
            print(f"CANDIDATE {tried}:", json.dumps(safe, default=str))
            if not review_is_refundable(review):
                print("NON-REFUNDABLE OPTION: not usable for the cancel-flow test; trying next.")
                continue
            print("REFUNDABLE OPTION FOUND (isRefundable=true):",
                  json.dumps(safe, default=str))
            return config, session, option, review
        if tried >= limit:
            break
    raise SystemExit(f"NO REFUNDABLE OPTION: reviewed {tried} option(s) (limit {limit}); "
                     "none returned a successful Review with isRefundable=true. Book NOT called. "
                     "Re-run with a higher --max-instant-candidates to widen the sweep.")


parse_lead_guest_unused = None


def _parse_lead_guest_doc(raw: str) -> tuple[str, str]:
    """Case 10 lead name: 2 or 3 letter-only words -> (first, last).
    "Rohit Mehta" -> ("Rohit", "Mehta"); "Test Guest Five" -> ("Test", "Guest Five").
    Both parts must still pass the shared traveller-name rule (uat._NAME_RE)."""
    parts = (raw or "").split()
    if not 2 <= len(parts) <= 3:
        raise SystemExit("--lead-guest: use 2 or 3 words, e.g. \"Rohit Mehta\" or \"Test Guest Five\".")
    first, last = parts[0], " ".join(parts[1:])
    for value in (first, last):
        if not uat._NAME_RE.match(value) or not all(p.isalpha() for p in value.split()):
            raise SystemExit("--lead-guest: letters only, each name at least 2 characters.")
    return first, last


def build_payload(review: dict, session, args) -> tuple[dict, list[str]]:
    """tc4.build_payload with the lead name applied here (shared builder only
    accepts 1-2 words). The lead name is checked against the shared name rule."""
    first, last = parse_lead_guest(args.lead_guest) if args.lead_guest else ("", "")
    payload, failures = tc4.build_payload(review, session, argparse.Namespace(**{**vars(args), "lead_guest": ""}))
    if first:
        lead = payload["roomTravellerInfo"][0]["travellerInfo"][0]
        lead["fN"], lead["lN"] = first, last
        # Same rule the shared validator applies to fN/lN (parse_lead_guest checked it).
        if not (uat._NAME_RE.match(lead["fN"]) and uat._NAME_RE.match(lead["lN"])):
            failures = [*failures, "lead traveller name: fails traveller-name rule"]
    return payload, failures


def export(recorder: tc4.Recorder, out_dir: Path) -> Path:
    """Write the 15 files under out_dir/'Test Case 10' and a ZIP next to it."""
    recorder.derive_cancellation()
    missing = [s for s, _, _ in FILES if s not in recorder.pairs]
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if "confirm" in recorder.pairs:
        raise SystemExit("Refusing export: Test Case 10 must not include a confirm-hold call.")
    if not review_is_refundable(recorder.pairs["review"][1]):
        raise SystemExit("Refusing export: Review option is not refundable (cancel-flow test needs a refundable rate).")
    book_req = recorder.pairs["hold"][0]
    if not (isinstance(book_req, dict) and book_req.get("paymentInfos")):
        raise SystemExit("Refusing export: Book request has no paymentInfos (not an instant booking).")
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
        destination=ns.destination, days_ahead=ns.days_ahead, nights=TC10_NIGHTS, adults=2,
        rooms=copy.deepcopy(TC10_ROOMS), hotel_id=ns.hotel_id, search_id="", option_id="",
        require_hold=False, max_hold_candidates=1, max_instant_candidates=ns.max_instant_candidates,
        execute_uat_book=ns.execute_uat_book, confirm=ns.confirm, confirm_hold=False,
        cancel_after=False, contact_email=ns.contact_email, contact_phone=ns.contact_phone,
        pan=ns.pan, passport="", lead_guest=ns.lead_guest, poll_attempts=36,
        cancel_poll_attempts=ns.cancel_poll_attempts,
    )


async def run_book_and_cancel(args: argparse.Namespace) -> None:
    config, session, _option, review = await _fresh_refundable_instant_review(args)
    reqs = uat.book_requirements(review)
    print("BOOK REQUIREMENTS (from Review):", json.dumps(reqs, indent=1))
    execute = bool(args.execute_uat_book)
    if not reqs["booking_id_present"]:
        raise SystemExit("Review returned no bookingId; Book cannot be built.")
    if not review_is_refundable(review):
        raise SystemExit("Refusing: Test Case 10 needs a refundable option for the cancel flow. Book NOT called.")
    if reqs["passport_required"]:
        raise SystemExit("Review requires passport; Test Case 10 expects no passport. Book NOT called.")
    if reqs["gst_info_needed"]:
        raise SystemExit("Review needs gstInfo; not supported. Book NOT called.")
    if reqs["pan_required"] and execute and not args.pan:
        raise SystemExit("Review says PAN is required: pass --pan.")
    payload, failures = build_payload(review, session, args)
    print("BOOK REQUEST (INSTANT, keys/types only):", json.dumps(uat.shape(payload), indent=1))
    print("BOOK IDENTITY (compare across attempts):", json.dumps(uat.booking_identity_summary(
        payload, hid=str(review.get("tjHotelId") or review.get("hotelId") or ""),
        check_in=session.check_in, check_out=session.check_out), indent=1))
    print("paymentInfos amount (Review totalPrice):", payload["paymentInfos"][0]["amount"])
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
        raise SystemExit(f"Final status not CANCELLED (status={final}); nothing exported. "
                         "Re-run later with a larger --cancel-poll-attempts is not possible for the same booking; "
                         "check it in TripJack.")
    print("NOTE: UAT only; no production booking record was saved.")


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
    print("TEST CASE 10 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc10")
    p.add_argument("--destination", default="Mumbai")
    p.add_argument("--hotel-id", default="")
    p.add_argument("--days-ahead", type=int, default=30)
    p.add_argument("--execute-uat-book", action="store_true")
    p.add_argument("--confirm", default="")
    p.add_argument("--contact-email", default="")
    p.add_argument("--contact-phone", default="")
    p.add_argument("--pan", default="")
    p.add_argument("--lead-guest", default="")
    p.add_argument("--max-instant-candidates", type=int, default=30)
    p.add_argument("--cancel-poll-attempts", type=int, default=36, help="5s polls waiting for CANCELLED")
    p.add_argument("--out-dir", default="certification")
    asyncio.run(run(p.parse_args(argv)))


if __name__ == "__main__":
    main()
