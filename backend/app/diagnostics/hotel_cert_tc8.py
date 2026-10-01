"""TripJack Hotel v3 certification — Test Case 8 capture/export (UAT ONLY).

Matches Aryan's Test Case 8 sample:
  * 2 rooms: 3 adults each, no children
  * 1 night, INR, nationality 106
  * flow: search -> detail -> review -> INSTANT Book (paymentInfos = latest
    Review totalPrice) -> booking-details (SUCCESS) -> cancellation policy
  * the sample's Review had onholdAllowed=true and was still booked instantly,
    so Case 8 needs a successful Review only (hold flag is not a gate here)
  * PAN on every adult; no passport
  * NO cancel step: the sample has no Cancel files
  * cancellation policy files derived from the Review reply (v3 has no endpoint)

12 files in "Test Case 8/" (names exactly as in the sample).

Gates: UAT booking host only (checked by _booker_post), dry run by default,
real Book only with --execute-uat-book --confirm CREATE-UAT-BOOK.

Run on the VPS from backend/ (REAL UAT booking, debits UAT wallet):

    python -m app.diagnostics.hotel_cert_tc8 --destination Mumbai \\
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

CASE_FOLDER = "Test Case 8"
ZIP_NAME = "Test Case 8.zip"
BOOK_CONFIRM_PHRASE = "CREATE-UAT-BOOK"
BOOKED_STATUSES = {"SUCCESS", "PAYMENT_SUCCESS"}
FAIL_STATUSES = {"FAILED", "ABORTED", "CANCELLED"}

TC8_ROOMS: list[dict[str, Any]] = [
    {"adults": 3, "childAges": []},
    {"adults": 3, "childAges": []},
]
TC8_NIGHTS = 1

# (step, filename stem, kinds written) — exactly the sample's 12 files.
FILES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("search", "TJ test Hotel Search", ("Request", "Response")),
    ("detail", "TJ test hotelDetail-search", ("Request", "Response")),
    ("review", "TJ test Hotel review", ("Request", "Response")),
    ("cancellation", "TJ test Hotel cancellation policy", ("Request", "Response")),
    ("hold", "TJ test Hotel Book", ("Request", "Response")),
    ("booking_detail", "TJ test hotel booking detail", ("Request", "Response")),
)
FILENAMES: tuple[str, ...] = tuple(f"{stem} {k}.json" for _, stem, kinds in FILES for k in kinds)
Recorder = tc3.Recorder


def export(recorder: tc3.Recorder, out_dir: Path) -> Path:
    """Write the 12 files under out_dir/'Test Case 8' and a ZIP next to it."""
    recorder.derive_cancellation()
    missing = [s for s, _, _ in FILES if s not in recorder.pairs]
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if "confirm" in recorder.pairs or "cancel" in recorder.pairs or "after_cancel" in recorder.pairs:
        raise SystemExit("Refusing export: Test Case 8 must not include confirm-hold or cancel calls.")
    review = recorder.pairs["review"][1]
    if not (isinstance(review, dict) and (review.get("status") or {}).get("success") is True):
        raise SystemExit("Refusing export: Review did not succeed.")
    book_req = recorder.pairs["hold"][0]
    if not (isinstance(book_req, dict) and book_req.get("paymentInfos")):
        raise SystemExit("Refusing export: Book request has no paymentInfos (not an instant booking).")
    if recorder.final_status() not in BOOKED_STATUSES:
        raise SystemExit(f"Refusing export: booking not SUCCESS (status={recorder.final_status()}).")
    folder = out_dir / CASE_FOLDER
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    for step, stem, kinds in FILES:
        req, resp = recorder.pairs[step]
        for kind in kinds:
            body = req if kind == "Request" else resp
            (folder / f"{stem} {kind}.json").write_text(
                json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8"
            )
    zip_path = out_dir / ZIP_NAME
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILENAMES:
            z.write(folder / name, f"{CASE_FOLDER}/{name}")
    return zip_path


def build_args(ns: argparse.Namespace) -> argparse.Namespace:
    return argparse.Namespace(
        destination=ns.destination, days_ahead=ns.days_ahead, nights=TC8_NIGHTS, adults=1,
        rooms=copy.deepcopy(TC8_ROOMS), hotel_id=ns.hotel_id, search_id="", option_id="",
        require_hold=False, max_hold_candidates=1, max_candidates=ns.max_candidates,
        execute_uat_book=ns.execute_uat_book, confirm=ns.confirm, confirm_hold=False,
        cancel_after=False, contact_email=ns.contact_email, contact_phone=ns.contact_phone,
        pan=ns.pan, passport="", lead_guest=ns.lead_guest, poll_attempts=36,
    )


def build_payload(review: dict, session, args) -> tuple[dict, list[str]]:
    """tc5.build_payload: 2-3 word lead names are normalized here (the shared
    builder only accepts 1-2 words); the name is never printed."""
    return tc5.build_payload(review, session, args)


async def run_book(args: argparse.Namespace) -> None:
    config, session, _option, review = await tc4._fresh_review(args)
    reqs = uat.book_requirements(review)
    print("BOOK REQUIREMENTS (from Review):", json.dumps(reqs, indent=1))
    execute = bool(args.execute_uat_book)
    if not reqs["booking_id_present"]:
        raise SystemExit("Review returned no bookingId; Book cannot be built.")
    if reqs["passport_required"]:
        raise SystemExit("Review requires passport; Test Case 8 expects no passport. Book NOT called.")
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
        print(f"DRY RUN: Book NOT called. Re-run with --execute-uat-book --confirm {BOOK_CONFIRM_PHRASE}.")
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
        raise SystemExit("Book rejected by TripJack; stopped.")
    booking_id = body["bookingId"]
    booked = await tc4._poll(config, booking_id, args.poll_attempts,
                             lambda s: s in BOOKED_STATUSES | FAIL_STATUSES)
    if booked not in BOOKED_STATUSES:
        raise SystemExit(f"Booking not SUCCESS (status={booked}); nothing exported.")
    print("NOTE: UAT only; no production booking record was saved.")


async def run(ns: argparse.Namespace) -> Optional[Path]:
    args = build_args(ns)
    recorder = Recorder()
    undo = tc3.install_capture(recorder)
    try:
        await run_book(args)
    finally:
        undo()
    if not args.execute_uat_book:
        print("DRY RUN: nothing exported.")
        return None
    zip_path = export(recorder, Path(ns.out_dir))
    print("TEST CASE 8 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc8")
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
    p.add_argument("--out-dir", default="certification")
    asyncio.run(run(p.parse_args(argv)))


if __name__ == "__main__":
    main()
