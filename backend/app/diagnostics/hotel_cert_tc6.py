"""TripJack Hotel v3 certification — Test Case 6 capture/export (UAT ONLY).

Matches Aryan's Test Case 6 sample:
  * 3 rooms: R1 2A + 2C (2, 3), R2 3A + 1C (2), R3 2A + 1C (2); 1 night, INR, nationality 106
  * flow: search -> detail -> review (onholdAllowed=true) -> HOLD Book (no
    paymentInfos) -> booking-details ON_HOLD -> cancel-booking/{id}
    -> booking-details until exactly CANCELLED
  * cancellation policy files derived from the Review (hid, optionId, reviewHash)

15 files in "Test Case 6/": Case 4/5 layout with "TJ test Hotel Hold" in place
of "TJ test Hotel Book"; Cancel Request is the plain cancel URL; after-cancel
booking details is Response-only.

Reuses Case 3/4/5 recorder, capture, payload and polling. None is changed.

    python -m app.diagnostics.hotel_cert_tc6 --destination Mumbai \\
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

from app.diagnostics import hotel_cert_tc3 as tc3
from app.diagnostics import hotel_cert_tc4 as tc4
from app.diagnostics import hotel_cert_tc5 as tc5
from app.diagnostics import hotel_listing_uat as uat

CASE_FOLDER = "Test Case 6"
ZIP_NAME = "Test_Case_6.zip"
BOOK_CONFIRM_PHRASE = "CREATE-UAT-BOOK"
ON_HOLD = "ON_HOLD"
CANCELLED = "CANCELLED"
STOP_STATUSES = {ON_HOLD, "SUCCESS", "PAYMENT_SUCCESS", "FAILED", "ABORTED", "CANCELLED"}

TC6_ROOMS: list[dict[str, Any]] = [
    {"adults": 2, "childAges": [2, 3]},
    {"adults": 3, "childAges": [2]},
    {"adults": 2, "childAges": [2]},
]
TC6_NIGHTS = 1

FILES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("search", "TJ test Hotel Search", ("Request", "Response")),
    ("detail", "TJ test hotelDetail-search", ("Request", "Response")),
    ("review", "TJ test Hotel review", ("Request", "Response")),
    ("cancellation", "TJ test Hotel cancellation policy", ("Request", "Response")),
    ("hold", "TJ test Hotel Hold", ("Request", "Response")),
    ("booking_detail", "TJ test hotel booking detail", ("Request", "Response")),
    ("cancel", "TJ Test Hotel Cancel", ("Request", "Response")),
    ("after_cancel", "TJ test hotel detail after cancel", ("Response",)),
)
FILENAMES: tuple[str, ...] = tuple(f"{stem} {k}.json" for _, stem, kinds in FILES for k in kinds)
Recorder = tc4.Recorder


async def _fresh_hold_review(args: argparse.Namespace):
    """search -> detail -> review; first successful Review with onholdAllowed
    explicitly true wins. Read-only: Book never runs here."""
    settings, config = uat._config()
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
    limit = max(1, int(getattr(args, "max_candidates", 30) or 30))
    tried = 0
    for hid in hotel_ids:
        if tried >= limit:
            break
        status, detail, _ = await uat._raw_post(config, uat.build_uat_pricing_payload(
            listing_correlation_id=session.provider_search_id, hid=hid, check_in=session.check_in,
            check_out=session.check_out, rooms=uat._rooms_from_session(session), currency=session.currency,
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
            safe = uat.hold_candidate_summary(review, option)
            if uat.review_hold_allowed(review) is not True:
                print(f"CANDIDATE {tried}: HOLD NOT AVAILABLE FOR SELECTED OPTION; trying next.")
                continue
            print("HOLD-ELIGIBLE OPTION FOUND (onholdAllowed=true):", json.dumps(safe, default=str))
            return config, session, option, review
    raise SystemExit(f"NO HOLD-ELIGIBLE OPTION: reviewed {tried} option(s) (limit {limit}). Book NOT called. "
                     "Re-run with a higher --max-candidates to widen the sweep.")


def build_payload(review: dict, session, args) -> tuple[dict, list[str]]:
    """Case 5 payload (lead name, PAN on adults, child ages) minus paymentInfos:
    the sample's Hold Book carries none."""
    payload, failures = tc5.build_payload(review, session, args)
    payload = {k: v for k, v in payload.items() if k != "paymentInfos"}
    return payload, failures


def export(recorder: tc4.Recorder, out_dir: Path) -> Path:
    """Write the 15 files under out_dir/'Test Case 6' and a ZIP next to it."""
    recorder.derive_cancellation()
    missing = [s for s, _, _ in FILES if s not in recorder.pairs]
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if "confirm" in recorder.pairs:
        raise SystemExit("Refusing export: Test Case 6 must not include a confirm-hold call.")
    review = recorder.pairs["review"][1]
    if not (isinstance(review, dict) and (review.get("status") or {}).get("success") is True):
        raise SystemExit("Refusing export: Review did not succeed.")
    if uat.review_hold_allowed(review) is not True:
        raise SystemExit("Refusing export: Review did not return onholdAllowed=true.")
    book_req = recorder.pairs["hold"][0]
    if not isinstance(book_req, dict) or "paymentInfos" in book_req:
        raise SystemExit("Refusing export: Hold request carries paymentInfos (not a hold booking).")
    if recorder.final_status() != ON_HOLD:
        raise SystemExit(f"Refusing export: booking not ON_HOLD before cancel (status={recorder.final_status()}).")
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
        destination=ns.destination, days_ahead=ns.days_ahead, nights=TC6_NIGHTS, adults=2,
        rooms=copy.deepcopy(TC6_ROOMS), hotel_id=ns.hotel_id, search_id="", option_id="",
        require_hold=True, max_hold_candidates=1, max_candidates=ns.max_candidates,
        execute_uat_book=ns.execute_uat_book, confirm=ns.confirm, confirm_hold=False,
        cancel_after=False, contact_email=ns.contact_email, contact_phone=ns.contact_phone,
        pan=ns.pan, passport="", lead_guest=ns.lead_guest, poll_attempts=36,
        cancel_poll_attempts=ns.cancel_poll_attempts,
    )


async def run_hold_and_cancel(args: argparse.Namespace) -> None:
    config, session, _option, review = await _fresh_hold_review(args)
    reqs = uat.book_requirements(review)
    print("BOOK REQUIREMENTS (from Review):", json.dumps(reqs, indent=1))
    execute = bool(args.execute_uat_book)
    if not reqs["booking_id_present"]:
        raise SystemExit("Review returned no bookingId; Hold cannot be built.")
    if uat.review_hold_allowed(review) is not True:
        raise SystemExit("Refusing: Test Case 6 needs Review onholdAllowed=true. Hold NOT called.")
    if reqs["passport_required"]:
        raise SystemExit("Review requires passport; Test Case 6 expects no passport. Hold NOT called.")
    if reqs["gst_info_needed"]:
        raise SystemExit("Review needs gstInfo; not supported. Hold NOT called.")
    if reqs["pan_required"] and execute and not args.pan:
        raise SystemExit("Review says PAN is required: pass --pan.")
    payload, failures = build_payload(review, session, args)
    assert "paymentInfos" not in payload
    print("HOLD REQUEST (no paymentInfos, keys/types only):", json.dumps(uat.shape(payload), indent=1))
    print("BOOK IDENTITY (compare across attempts):", json.dumps(uat.booking_identity_summary(
        payload, hid=str(review.get("tjHotelId") or review.get("hotelId") or ""),
        check_in=session.check_in, check_out=session.check_out), indent=1))
    print("PRE-FLIGHT VALIDATION:", "OK" if not failures else "FAILED")
    for f in failures:
        print("  -", f)
    if not execute:
        print(f"DRY RUN: Hold and Cancel NOT called. Re-run with --execute-uat-book --confirm {BOOK_CONFIRM_PHRASE}.")
        return
    if args.confirm != BOOK_CONFIRM_PHRASE:
        raise SystemExit(f"Refusing: --confirm {BOOK_CONFIRM_PHRASE} is required.")
    if not (args.contact_email and args.contact_phone):
        raise SystemExit("Refusing: --contact-email and --contact-phone are required.")
    if failures:
        raise SystemExit(f"Refusing: {len(failures)} pre-flight failure(s); Hold NOT called.")
    print("WARNING: creating a REAL TripJack UAT HOLD booking.")
    status, body, elapsed = await uat._booker_post(config, uat.HOTEL_BOOK_PATH, payload)
    print("HOLD HTTP status:", status, "elapsed_s:", elapsed)
    print("HOLD SUMMARY:", json.dumps(uat.book_summary(body), indent=1))
    if not uat.book_created(status, body):
        if uat.is_duplicate_booking(body):
            print("DUPLICATE BOOKING (errCode 2502): change --lead-guest or dates and retry.")
        raise SystemExit("Hold rejected by TripJack; stopped. Cancel NOT called.")
    booking_id = body["bookingId"]
    held = await tc4._poll(config, booking_id, args.poll_attempts, lambda s: s in STOP_STATUSES)
    if held != ON_HOLD:
        raise SystemExit(f"Booking not ON_HOLD (status={held}); Cancel NOT called.")
    print("CANCELLING the UAT hold (cancel-booking/{bookingId}).")
    st, cb, _ = await uat._booker_post(config, f"{uat.HOTEL_CANCEL_BOOKING_PATH}/{booking_id}", None)
    print("CANCEL HTTP status:", st, "summary:", json.dumps(uat.book_summary(cb)))
    final = await tc4._poll(config, booking_id, args.cancel_poll_attempts, lambda s: s == CANCELLED)
    print("POST-CANCEL order_status:", final)
    if final != CANCELLED:
        raise SystemExit(f"Final status not CANCELLED (status={final}); nothing exported. Check it in TripJack.")
    print("NOTE: UAT only; no production booking record was saved.")


async def run(ns: argparse.Namespace) -> Optional[Path]:
    args = build_args(ns)
    recorder = tc4.Recorder()
    undo = tc3.install_capture(recorder)
    try:
        await run_hold_and_cancel(args)
    finally:
        undo()
    if not args.execute_uat_book:
        print("DRY RUN: nothing exported.")
        return None
    zip_path = export(recorder, Path(ns.out_dir))
    print("TEST CASE 6 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc6")
    p.add_argument("--destination", default="Mumbai")
    p.add_argument("--hotel-id", default="")
    p.add_argument("--days-ahead", type=int, default=30)
    p.add_argument("--execute-uat-book", action="store_true")
    p.add_argument("--confirm", default="")
    p.add_argument("--contact-email", default="")
    p.add_argument("--contact-phone", default="")
    p.add_argument("--pan", default="")
    p.add_argument("--lead-guest", default="")
    p.add_argument("--max-candidates", type=int, default=30, help="max options to review")
    p.add_argument("--cancel-poll-attempts", type=int, default=36, help="5s polls waiting for CANCELLED")
    p.add_argument("--out-dir", default="certification")
    asyncio.run(run(p.parse_args(argv)))


if __name__ == "__main__":
    main()
