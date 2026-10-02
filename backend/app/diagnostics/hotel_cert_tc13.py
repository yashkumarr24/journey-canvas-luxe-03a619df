"""TripJack Hotel v3 certification — Test Case 13 capture/export (UAT ONLY).

Matches Aryan's Test Case 13 sample:
  * 1 room: 2 adults + 1 child (age 8); 1 night, INR, nationality 106
  * flow: search -> detail -> review (refundable option) -> INSTANT Book
    (paymentInfos.amount = latest Review totalPrice) -> booking-details SUCCESS
    -> cancel-booking/{id} (no body) -> booking-details until exactly CANCELLED
  * cancellation policy files derived from the Review (hid, optionId, reviewHash)

The sample ZIP holds 15 files (after-cancel details is Response-only) with the
same names as Case 10. Like the sample, onholdAllowed=true is NOT a gate; the
option must be refundable. The flow is Case 10's, reused unchanged; only the
occupancy and the output folder/ZIP differ.

    python -m app.diagnostics.hotel_cert_tc13 --destination Mumbai \\
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
from app.diagnostics import hotel_cert_tc10 as tc10

CASE_FOLDER = "Test Case 13"
ZIP_NAME = "Test_Case_13.zip"
BOOK_CONFIRM_PHRASE = tc10.BOOK_CONFIRM_PHRASE
CANCELLED = tc10.CANCELLED
BOOKED_STATUSES = tc10.BOOKED_STATUSES

TC13_ROOMS: list[dict[str, Any]] = [{"adults": 2, "childAges": [8]}]
TC13_NIGHTS = 1

FILES = tc4.FILES
FILENAMES: tuple[str, ...] = tc4.FILENAMES
review_is_refundable = tc10.review_is_refundable


def review_price_changed(review: Any) -> bool:
    """Sample Review has priceChanged=false; anything truthy blocks export."""
    if not isinstance(review, dict):
        return True
    v = review.get("priceChanged")
    if v is None and isinstance(review.get("option"), dict):
        v = review["option"].get("priceChanged")
    return v is True or str(v).strip().lower() == "true"


def export(recorder: tc4.Recorder, out_dir: Path) -> Path:
    """Write the 15 files under out_dir/'Test Case 13' and a ZIP next to it."""
    recorder.derive_cancellation()
    missing = [s for s, _, _ in FILES if s not in recorder.pairs]
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if "confirm" in recorder.pairs:
        raise SystemExit("Refusing export: Test Case 13 must not include a confirm-hold call.")
    if not review_is_refundable(recorder.pairs["review"][1]):
        raise SystemExit("Refusing export: Review option is not refundable.")
    if review_price_changed(recorder.pairs["review"][1]):
        raise SystemExit("Refusing export: Review reported priceChanged=true.")
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
    args = tc10.build_args(ns)
    args.rooms = copy.deepcopy(TC13_ROOMS)
    args.nights = TC13_NIGHTS
    return args


async def run(ns: argparse.Namespace) -> Optional[Path]:
    args = build_args(ns)
    recorder = tc4.Recorder()
    undo = tc3.install_capture(recorder)
    try:
        await tc10.run_book_and_cancel(args)
    finally:
        undo()
    if not args.execute_uat_book:
        print("DRY RUN: nothing exported.")
        return None
    zip_path = export(recorder, Path(ns.out_dir))
    print("TEST CASE 11 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc13")
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
