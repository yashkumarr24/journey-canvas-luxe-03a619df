"""TripJack Hotel v3 certification — Test Case 1 capture/export (UAT ONLY).

Matches Aryan's Test Case 1 sample:
  * 1 room, 1 adult, 1 night
  * flow: search -> detail -> review -> HOLD -> booking-details (ON_HOLD)
  * NO confirm-hold step (the sample has no Confirm Hold files)

12 files in "Test Case 1/":
  TJ test Hotel Search / hotelDetail-search / Hotel review /
  Hotel cancellation policy / Hotel Hold / hotel booking detail
  (each "Request.json" and "Response.json").

Reuses hotel_cert_tc3's capture (JSON bodies only, never headers; credential
keys stripped) and hotel_listing_uat.run_book with every safety gate kept.
Files are written only when the final Booking Details status is ON_HOLD.

Run on the VPS from backend/ (creates a REAL UAT hold):

    python -m app.diagnostics.hotel_cert_tc1 --destination Mumbai \\
        --execute-uat-hold --confirm CREATE-UAT-HOLD \\
        --contact-email <email> --contact-phone <10 digits> --pan <PAN> \\
        --lead-guest "First Last" [--out-dir certification]

Without --execute-uat-hold it is a dry run (no Book, nothing exported).
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
from app.diagnostics import hotel_listing_uat as uat

CASE_FOLDER = "Test Case 1"
ZIP_NAME = "Test_Case_1.zip"
REQUIRED_STATUS = "ON_HOLD"

TC1_ROOMS: list[dict[str, Any]] = [{"adults": 1, "childAges": []}]
TC1_NIGHTS = 1

STEPS: tuple[tuple[str, str], ...] = (
    ("search", "TJ test Hotel Search"),
    ("detail", "TJ test hotelDetail-search"),
    ("review", "TJ test Hotel review"),
    ("cancellation", "TJ test Hotel cancellation policy"),
    ("hold", "TJ test Hotel Hold"),
    ("booking_detail", "TJ test hotel booking detail"),
)
FILENAMES: tuple[str, ...] = tuple(f"{stem} {kind}.json" for _, stem in STEPS for kind in ("Request", "Response"))


def export(recorder: tc3.Recorder, out_dir: Path) -> Path:
    """Write the 12 files under out_dir/'Test Case 1' and a ZIP next to it."""
    recorder.derive_cancellation()
    missing = [s for s, _ in STEPS if s not in recorder.pairs]
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if "confirm" in recorder.pairs:
        raise SystemExit("Refusing export: Test Case 1 must not include a confirm-hold call.")
    if recorder.final_status() != REQUIRED_STATUS:
        raise SystemExit(f"Refusing export: booking not ON_HOLD (status={recorder.final_status()}).")
    folder = out_dir / CASE_FOLDER
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    for step, stem in STEPS:
        req, resp = recorder.pairs[step]
        for kind, body in (("Request", req), ("Response", resp)):
            (folder / f"{stem} {kind}.json").write_text(json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8")
    zip_path = out_dir / ZIP_NAME
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILENAMES:
            z.write(folder / name, f"{CASE_FOLDER}/{name}")
    return zip_path


def build_args(ns: argparse.Namespace) -> argparse.Namespace:
    """Arguments for uat.run_book: Test Case 1 fixed, hold only, never confirm/cancel."""
    return argparse.Namespace(
        destination=ns.destination, days_ahead=ns.days_ahead, nights=TC1_NIGHTS, adults=1,
        rooms=copy.deepcopy(TC1_ROOMS), hotel_id=ns.hotel_id, search_id="", option_id="",
        require_hold=True, max_hold_candidates=ns.max_hold_candidates,
        execute_uat_hold=ns.execute_uat_hold, confirm=ns.confirm, confirm_hold=False,
        cancel_after=False, contact_email=ns.contact_email, contact_phone=ns.contact_phone,
        pan=ns.pan, passport=ns.passport, lead_guest=ns.lead_guest, poll_attempts=36,
    )


async def run(ns: argparse.Namespace) -> Optional[Path]:
    args = build_args(ns)
    recorder = tc3.Recorder()
    undo = tc3.install_capture(recorder)
    try:
        await uat.run_book(args)
    finally:
        undo()
    if not args.execute_uat_hold:
        print("DRY RUN: nothing exported.")
        return None
    zip_path = export(recorder, Path(ns.out_dir))
    print("TEST CASE 1 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc1")
    p.add_argument("--destination", default="Mumbai")
    p.add_argument("--hotel-id", default="")
    p.add_argument("--days-ahead", type=int, default=30)
    p.add_argument("--max-hold-candidates", type=int, default=5)
    p.add_argument("--execute-uat-hold", action="store_true")
    p.add_argument("--confirm", default="")
    p.add_argument("--contact-email", default="")
    p.add_argument("--contact-phone", default="")
    p.add_argument("--pan", default="")
    p.add_argument("--passport", default="")
    p.add_argument("--lead-guest", default="")
    p.add_argument("--out-dir", default="certification")
    asyncio.run(run(p.parse_args(argv)))


if __name__ == "__main__":
    main()
