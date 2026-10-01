"""TripJack Hotel v3 certification — Test Case 9 capture/export (UAT ONLY).

Matches Aryan's Test Case 9 sample:
  * 1 room, 1 adult, 1 night, INR, nationality 106
  * flow: search -> detail -> review -> cancellation policy (from the Review's
    option.cancellation; v3 has no standalone endpoint)
  * NO Book / Hold / Cancel / Booking Details calls — read-only
  * sample files: 7 JSON (cancellation policy is Response-only) + the
    "UI EVIDENCE — README.md" note

Gates: UAT host only (_config refuses production), no booking path is ever
called, export only with --export after a successful Review.

Run on the VPS from backend/:

    python -m app.diagnostics.hotel_cert_tc9 --destination Mumbai [--export --out-dir certification]
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

CASE_FOLDER = "Test Case 9"
ZIP_NAME = "Test_Case_9.zip"
TC9_ROOMS: list[dict[str, Any]] = [{"adults": 1, "childAges": []}]
TC9_NIGHTS = 1
README_NAME = "UI EVIDENCE \u2014 README.md"

FILES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("search", "TJ test Hotel Search", ("Request", "Response")),
    ("detail", "TJ test hotelDetail-search", ("Request", "Response")),
    ("review", "TJ test Hotel review", ("Request", "Response")),
    ("cancellation", "TJ test Hotel cancellation policy", ("Response",)),
)
JSON_FILENAMES: tuple[str, ...] = tuple(f"{stem} {k}.json" for _, stem, kinds in FILES for k in kinds)
FILENAMES: tuple[str, ...] = JSON_FILENAMES + (README_NAME,)
FORBIDDEN_STEPS = ("hold", "confirm", "booking_detail", "cancel", "after_cancel")
Recorder = tc3.Recorder


def readme_text(cancellation_response: dict) -> str:
    policy = cancellation_response.get("cancellationPolicy") or {}
    penalties = policy.get("penalties") if isinstance(policy, dict) else None
    return (
        "# TC 9 \u2014 Cancellation policy displayed in our app\n\n"
        "The cancellation policy returned by Tripjack's /hms/v3/hotel/review\n"
        "endpoint (see `TJ test Hotel review Response.json` -> `option.cancellation`)\n"
        "is rendered on our hotel Review page (/hotels/review):\n\n"
        "  - Block: 'Cancellation policy' (refundable / non-refundable + per-window rules)\n\n"
        "Sample policy values from this live run:\n\n"
        f"  refundable      = {policy.get('isRefundable') if isinstance(policy, dict) else None}\n"
        f"  policy entries  = {len(penalties) if isinstance(penalties, list) else 0}\n"
        f"  hotel id (hid)  = {cancellation_response.get('hid')}\n"
        f"  option id       = {cancellation_response.get('optionId')}\n"
    )


def export(recorder: tc3.Recorder, out_dir: Path) -> Path:
    recorder.derive_cancellation()
    missing = [s for s, _, _ in FILES if s not in recorder.pairs]
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if any(s in recorder.pairs for s in FORBIDDEN_STEPS):
        raise SystemExit("Refusing export: Test Case 9 must not include Book/Hold/Cancel/Booking Details.")
    review = recorder.pairs["review"][1]
    if not (isinstance(review, dict) and (review.get("status") or {}).get("success") is True):
        raise SystemExit("Refusing export: Review did not succeed.")
    cancel_resp = recorder.pairs["cancellation"][1]
    if not cancel_resp.get("cancellationPolicy"):
        raise SystemExit("Refusing export: Review returned no cancellation policy.")
    folder = out_dir / CASE_FOLDER
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    for step, stem, kinds in FILES:
        req, resp = recorder.pairs[step]
        for kind in kinds:
            body = req if kind == "Request" else resp
            (folder / f"{stem} {kind}.json").write_text(
                json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8")
    (folder / README_NAME).write_text(readme_text(cancel_resp), encoding="utf-8")
    zip_path = out_dir / ZIP_NAME
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILENAMES:
            z.write(folder / name, f"{CASE_FOLDER}/{name}")
    return zip_path


def build_args(ns: argparse.Namespace) -> argparse.Namespace:
    return argparse.Namespace(
        destination=ns.destination, days_ahead=ns.days_ahead, nights=TC9_NIGHTS, adults=1,
        rooms=copy.deepcopy(TC9_ROOMS), hotel_id=ns.hotel_id, search_id="", option_id="",
        max_candidates=ns.max_candidates,
    )


async def run(ns: argparse.Namespace) -> Optional[Path]:
    args = build_args(ns)
    recorder = Recorder()
    undo = tc3.install_capture(recorder)
    try:
        _config, _session, _option, review = await tc4._fresh_review(args)
    finally:
        undo()
    recorder.derive_cancellation()
    policy = recorder.pairs.get("cancellation", (None, {}))[1].get("cancellationPolicy") or {}
    penalties = policy.get("penalties") if isinstance(policy, dict) else None
    print("CANCELLATION POLICY (from Review): refundable =",
          policy.get("isRefundable") if isinstance(policy, dict) else None,
          "| windows =", len(penalties) if isinstance(penalties, list) else 0)
    if not ns.export:
        print("DRY RUN: nothing exported. Re-run with --export to write the Test Case 9 files.")
        return None
    zip_path = export(recorder, Path(ns.out_dir))
    print("TEST CASE 9 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc9")
    p.add_argument("--destination", default="Mumbai")
    p.add_argument("--hotel-id", default="")
    p.add_argument("--days-ahead", type=int, default=30)
    p.add_argument("--max-candidates", type=int, default=30)
    p.add_argument("--export", action="store_true")
    p.add_argument("--out-dir", default="certification")
    asyncio.run(run(p.parse_args(argv)))


if __name__ == "__main__":
    main()
