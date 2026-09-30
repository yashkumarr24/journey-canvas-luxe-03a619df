"""TripJack Hotel v3 certification — Test Case 3 capture/export (UAT ONLY).

Runs the existing UAT booking diagnostic (search -> detail -> review ->
hold -> booking-details -> confirm-hold -> booking-details) with the fixed
Test Case 3 room layout, records every TripJack request/response JSON body
exactly as sent/received, and writes the 14 files in the same names/structure
as the Test Case 3 sample:

    Test Case 3/
      TJ test Hotel Search Request.json / Response.json
      TJ test hotelDetail-search Request.json / Response.json
      TJ test Hotel review Request.json / Response.json
      TJ test Hotel cancellation policy Request.json / Response.json
      TJ test Hotel Hold Request.json / Response.json
      TJ test Hotel Confirm Hold Booking Request.json / Response.json
      TJ test hotel booking detail Request.json / Response.json

Only JSON BODIES are captured — never HTTP headers, so the API key cannot be
written. Any key that looks like a credential is removed as a second guard.
Files (and the ZIP) are written ONLY after the run reaches CONFIRMED.

Run on the VPS from backend/ (creates and confirms a REAL UAT booking):

    python -m app.diagnostics.hotel_cert_tc3 --destination Mumbai \\
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

from app.diagnostics import hotel_listing_uat as uat
from app.integrations.tripjack.hotel_wire import HOTEL_LISTING_PATH, HOTEL_PRICING_PATH, HOTEL_REVIEW_PATH

CASE_FOLDER = "Test Case 3"

# Room 1: 2A + 2C(2,3) · Room 2: 3A + 1C(2) · Room 3: 2A + 1C(2)
TC3_ROOMS: list[dict[str, Any]] = [
    {"adults": 2, "childAges": [2, 3]},
    {"adults": 3, "childAges": [2]},
    {"adults": 2, "childAges": [2]},
]

# step -> file stem, in the sample's order.
STEPS: tuple[tuple[str, str], ...] = (
    ("search", "TJ test Hotel Search"),
    ("detail", "TJ test hotelDetail-search"),
    ("review", "TJ test Hotel review"),
    ("cancellation", "TJ test Hotel cancellation policy"),
    ("hold", "TJ test Hotel Hold"),
    ("confirm", "TJ test Hotel Confirm Hold Booking"),
    ("booking_detail", "TJ test hotel booking detail"),
)
FILENAMES: tuple[str, ...] = tuple(f"{stem} {kind}.json" for _, stem in STEPS for kind in ("Request", "Response"))

CANCELLATION_NOTE = ("Tripjack v3 returns the cancellation policy embedded in the Hotel Review response; "
                     "no standalone endpoint exists for v3.")

_SECRET_KEYS = {"apikey", "api_key", "x-api-key", "authorization", "secret", "password", "token", "accesstoken"}


def strip_secrets(value: Any) -> Any:
    """Deep copy with credential-like keys removed. All other fields untouched."""
    if isinstance(value, dict):
        return {k: strip_secrets(v) for k, v in value.items()
                if k.lower().replace("_", "").replace("-", "") not in {s.replace("_", "").replace("-", "") for s in _SECRET_KEYS}}
    if isinstance(value, list):
        return [strip_secrets(v) for v in value]
    return copy.deepcopy(value)


def step_for_path(path: str) -> Optional[str]:
    p = path.strip("/")
    if p.endswith(HOTEL_LISTING_PATH):
        return "search"
    if p.endswith(HOTEL_PRICING_PATH):
        return "detail"
    if p.endswith(HOTEL_REVIEW_PATH):
        return "review"
    if p.endswith(uat.HOTEL_BOOK_PATH):
        return "hold"
    if p.endswith(uat.HOTEL_CONFIRM_BOOK_PATH):
        return "confirm"
    if p.endswith(uat.HOTEL_BOOKING_DETAILS_PATH):
        return "booking_detail"
    return None


class Recorder:
    """Keeps one request/response pair per step.

    search: first page (the listing request that started the search).
    detail/review: the latest call (the one actually used for Book).
    booking_detail: the latest poll (the final post-confirm state).
    """

    FIRST_WINS = {"search"}

    def __init__(self) -> None:
        self.pairs: dict[str, tuple[Any, Any]] = {}

    def record(self, path: str, request: Any, response: Any) -> None:
        step = step_for_path(path)
        if step is None or (step in self.FIRST_WINS and step in self.pairs):
            return
        self.pairs[step] = (strip_secrets(request), strip_secrets(response))

    def derive_cancellation(self) -> None:
        if "review" not in self.pairs:
            return
        req, resp = self.pairs["review"]
        req = req if isinstance(req, dict) else {}
        opt = resp.get("option") if isinstance(resp, dict) and isinstance(resp.get("option"), dict) else {}
        policy = opt.get("cancellation") if "cancellation" in opt else opt.get("cancellationPolicy")
        self.pairs["cancellation"] = (
            {"hid": req.get("hid"), "optionId": req.get("optionId"), "reviewHash": req.get("reviewHash"),
             "_note": CANCELLATION_NOTE},
            {"hid": req.get("hid"), "optionId": req.get("optionId"), "cancellationPolicy": policy},
        )

    def final_status(self) -> Optional[str]:
        pair = self.pairs.get("booking_detail")
        body = pair[1] if pair else None
        order = body.get("order") if isinstance(body, dict) and isinstance(body.get("order"), dict) else {}
        return order.get("status")

    def missing(self) -> list[str]:
        return [s for s, _ in STEPS if s not in self.pairs]


def export(recorder: Recorder, out_dir: Path, *, require_confirmed: bool = True) -> Path:
    """Write the 14 files under out_dir/'Test Case 3' and a ZIP next to it."""
    recorder.derive_cancellation()
    missing = recorder.missing()
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if require_confirmed and recorder.final_status() != "SUCCESS":
        raise SystemExit(f"Refusing export: booking not CONFIRMED (status={recorder.final_status()}).")
    folder = out_dir / CASE_FOLDER
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    for step, stem in STEPS:
        req, resp = recorder.pairs[step]
        for kind, body in (("Request", req), ("Response", resp)):
            (folder / f"{stem} {kind}.json").write_text(json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8")
    zip_path = out_dir / "Test_Case_3.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILENAMES:
            z.write(folder / name, f"{CASE_FOLDER}/{name}")
    return zip_path


def install_capture(recorder: Recorder):
    """Wrap the diagnostic's HTTP helpers and the client's attempt method so
    bodies are recorded. Returns an undo function. Behaviour is unchanged."""
    from app.integrations.tripjack.client import TripJackClient

    orig_raw, orig_booker, orig_attempt = uat._raw_post, uat._booker_post, TripJackClient._attempt

    async def raw_post(config, payload, path=HOTEL_LISTING_PATH):
        st, body, el = await orig_raw(config, payload, path)
        recorder.record(path, payload, body)
        return st, body, el

    async def booker_post(config, path, payload):
        st, body, el = await orig_booker(config, path, payload)
        recorder.record(path, payload, body)
        return st, body, el

    async def attempt(self, url, payload, headers, operation, attempt_no, method="POST", params=None):
        body = await orig_attempt(self, url, payload, headers, operation, attempt_no, method=method, params=params)
        if method == "POST":
            recorder.record(url, dict(payload), body)  # headers are never recorded
        return body

    uat._raw_post, uat._booker_post, TripJackClient._attempt = raw_post, booker_post, attempt

    def undo() -> None:
        uat._raw_post, uat._booker_post, TripJackClient._attempt = orig_raw, orig_booker, orig_attempt
    return undo


def build_args(ns: argparse.Namespace) -> argparse.Namespace:
    """Arguments for uat.run_book with Test Case 3 fixed and every safety gate kept."""
    return argparse.Namespace(
        destination=ns.destination, days_ahead=ns.days_ahead, nights=ns.nights, adults=2,
        rooms=copy.deepcopy(TC3_ROOMS), hotel_id=ns.hotel_id, search_id="", option_id="",
        require_hold=True, max_hold_candidates=ns.max_hold_candidates,
        execute_uat_hold=ns.execute_uat_hold, confirm=ns.confirm, confirm_hold=ns.execute_uat_hold,
        cancel_after=False, contact_email=ns.contact_email, contact_phone=ns.contact_phone,
        pan=ns.pan, passport=ns.passport, lead_guest=ns.lead_guest, poll_attempts=36,
    )


async def run(ns: argparse.Namespace) -> Optional[Path]:
    args = build_args(ns)
    recorder = Recorder()
    undo = install_capture(recorder)
    try:
        await uat.run_book(args)
    finally:
        undo()
    if not args.execute_uat_hold:
        print("DRY RUN: nothing exported.")
        return None
    zip_path = export(recorder, Path(ns.out_dir))
    print("TEST CASE 3 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc3")
    p.add_argument("--destination", default="Mumbai")
    p.add_argument("--hotel-id", default="")
    p.add_argument("--days-ahead", type=int, default=30)
    p.add_argument("--nights", type=int, default=1)
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
