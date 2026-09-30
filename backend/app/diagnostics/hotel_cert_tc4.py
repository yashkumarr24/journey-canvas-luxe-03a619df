"""TripJack Hotel v3 certification — Test Case 4 capture/export (UAT ONLY).

Matches Aryan's Test Case 4 sample:
  * 5 rooms: R1 1A+2C(2,3), R2 2A+1C(2), R3 1A+1C(2), R4 1A, R5 1A
  * 1 night, INR, nationality 106
  * flow: search -> detail -> review -> INSTANT Book (paymentInfos = latest
    Review totalPrice) -> booking-details (SUCCESS) -> cancel-booking/{id}
    -> booking-details after cancel (status exported exactly as returned)
  * the sample's Review had onholdAllowed=true and was still booked instantly,
    so Case 4 needs a successful Review only (hold flag is not a gate here)
  * PAN on every adult; children carry age; no passport
  * cancellation policy files derived from the Review reply (v3 has no endpoint)

15 files in "Test Case 4/" (names exactly as in the sample, including the
capital "Test" in the Cancel files and the Response-only after-cancel file).
The Cancel Request file is the cancel URL as plain text, as in the sample.

Gates: UAT booking host only (checked by _booker_post), dry run by default,
real Book + Cancel only with --execute-uat-book --confirm CREATE-UAT-BOOK.

Run on the VPS from backend/ (REAL UAT booking + cancel, debits UAT wallet):

    python -m app.diagnostics.hotel_cert_tc4 --destination Mumbai \\
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
from app.diagnostics import hotel_listing_uat as uat

CASE_FOLDER = "Test Case 4"
ZIP_NAME = "Test_Case_4.zip"
BOOK_CONFIRM_PHRASE = "CREATE-UAT-BOOK"
BOOKED_STATUSES = {"SUCCESS", "PAYMENT_SUCCESS"}
FAIL_STATUSES = {"FAILED", "ABORTED", "CANCELLED"}

TC4_ROOMS: list[dict[str, Any]] = [
    {"adults": 1, "childAges": [2, 3]},
    {"adults": 2, "childAges": [2]},
    {"adults": 1, "childAges": [2]},
    {"adults": 1, "childAges": []},
    {"adults": 1, "childAges": []},
]
TC4_NIGHTS = 1

# (step, filename stem, kinds written)
FILES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("search", "TJ test Hotel Search", ("Request", "Response")),
    ("detail", "TJ test hotelDetail-search", ("Request", "Response")),
    ("review", "TJ test Hotel review", ("Request", "Response")),
    ("cancellation", "TJ test Hotel cancellation policy", ("Request", "Response")),
    ("hold", "TJ test Hotel Book", ("Request", "Response")),
    ("booking_detail", "TJ test hotel booking detail", ("Request", "Response")),
    ("cancel", "TJ Test Hotel Cancel", ("Request", "Response")),
    ("after_cancel", "TJ test hotel detail after cancel", ("Response",)),
)
FILENAMES: tuple[str, ...] = tuple(f"{stem} {k}.json" for _, stem, kinds in FILES for k in kinds)


def is_cancel_path(path: str) -> bool:
    return uat.HOTEL_CANCEL_BOOKING_PATH in path.strip("/")


class Recorder(tc3.Recorder):
    """tc3 Recorder + cancel step. Booking-details after the cancel call go to
    "after_cancel" (latest wins); before it, to "booking_detail"."""

    def __init__(self) -> None:
        super().__init__()
        self.cancelled = False

    def record(self, path: str, request: Any, response: Any) -> None:
        if is_cancel_path(path):
            url = f"{uat._booker_base().rstrip('/')}/{path.strip('/')}"
            self.pairs["cancel"] = (url, tc3.strip_secrets(response))
            self.cancelled = True
            return
        if self.cancelled and tc3.step_for_path(path) == "booking_detail":
            self.pairs["after_cancel"] = (tc3.strip_secrets(request), tc3.strip_secrets(response))
            return
        super().record(path, request, response)

    @staticmethod
    def _status(pair) -> Optional[str]:
        body = pair[1] if pair else None
        order = body.get("order") if isinstance(body, dict) and isinstance(body.get("order"), dict) else {}
        return order.get("status")

    def after_cancel_status(self) -> Optional[str]:
        return self._status(self.pairs.get("after_cancel"))


def export(recorder: Recorder, out_dir: Path) -> Path:
    """Write the 15 files under out_dir/'Test Case 4' and a ZIP next to it."""
    recorder.derive_cancellation()
    missing = [s for s, _, _ in FILES if s not in recorder.pairs]
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if "confirm" in recorder.pairs:
        raise SystemExit("Refusing export: Test Case 4 must not include a confirm-hold call.")
    book_req = recorder.pairs["hold"][0]
    if not (isinstance(book_req, dict) and book_req.get("paymentInfos")):
        raise SystemExit("Refusing export: Book request has no paymentInfos (not an instant booking).")
    if recorder.final_status() not in BOOKED_STATUSES:
        raise SystemExit(f"Refusing export: booking not successful before cancel (status={recorder.final_status()}).")
    cancel_resp = recorder.pairs["cancel"][1]
    ok = isinstance(cancel_resp, dict) and (cancel_resp.get("status") or {}).get("success") is True
    if not ok:
        raise SystemExit("Refusing export: cancel-booking did not return status.success=true.")
    after = recorder.after_cancel_status()
    if not (isinstance(after, str) and after.upper().startswith("CANCEL")):
        raise SystemExit(f"Refusing export: booking details after cancel show no cancellation (status={after}).")
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
        destination=ns.destination, days_ahead=ns.days_ahead, nights=TC4_NIGHTS, adults=1,
        rooms=copy.deepcopy(TC4_ROOMS), hotel_id=ns.hotel_id, search_id="", option_id="",
        require_hold=False, max_hold_candidates=1, max_candidates=ns.max_candidates,
        execute_uat_book=ns.execute_uat_book, confirm=ns.confirm, confirm_hold=False,
        cancel_after=False, contact_email=ns.contact_email, contact_phone=ns.contact_phone,
        pan=ns.pan, passport="", lead_guest=ns.lead_guest, poll_attempts=36,
    )


async def _fresh_review(args: argparse.Namespace):
    """search -> detail -> review; first successful Review wins. Read-only."""
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
            if status < 400 and rs.get("status_success") is True and isinstance(review, dict):
                print("REVIEW OK:", json.dumps(uat.hold_candidate_summary(review, option), default=str))
                return config, session, option, review
            print(f"CANDIDATE {tried}: review failed; skipping.")
    raise SystemExit(f"NO SUCCESSFUL REVIEW: tried {tried} option(s) (limit {limit}). Book NOT called.")


def build_payload(review: dict, session, args) -> tuple[dict, list[str]]:
    rooms = uat._rooms_from_session(session)
    reqs = uat.book_requirements(review)
    pan_values = [v.strip() for v in args.pan.split(",") if v.strip()] if args.pan else []
    if len(pan_values) > 1:
        raise SystemExit("--pan: pass one PAN (applied to every adult, as in the sample).")
    hold = uat.build_uat_book_payload(
        booking_id=str(review["bookingId"]), rooms=rooms,
        email=args.contact_email or "uat@example.invalid", phone=args.contact_phone or "9000000000",
        pan=pan_values[0] if pan_values else "", lead_guest=(args.lead_guest or "").strip(),
    )
    ages = [a for r in rooms for a in (r.get("childAges") or [])]
    ci = 0
    for block in hold["roomTravellerInfo"]:
        for gi, t in enumerate(block["travellerInfo"]):
            if gi == 0:
                t["isLeadGuest"] = True
            if t["pt"] == "CHILD":
                t.pop("pan", None)
                t["age"] = ages[ci]
                ci += 1
    failures = list(uat.validate_book_payload(hold, rooms, pan_required=False, passport_required=False))
    if reqs["pan_required"]:
        for t in (t for b in hold["roomTravellerInfo"] for t in b["travellerInfo"] if t["pt"] == "ADULT"):
            if not (isinstance(t.get("pan"), str) and uat._PAN_RE.match(t["pan"])):
                failures.append("adult.pan: required by Review and must match AAAAA9999A")
                break
    amount = tc2.review_total(review)
    if amount is None:
        raise SystemExit("Review has no positive option.pricing.totalPrice; Book NOT called.")
    return tc2.build_instant_payload(hold, amount), failures


async def _poll(config, booking_id: str, attempts: int, done) -> Optional[str]:
    status = None
    for attempt in range(max(1, attempts)):
        await asyncio.sleep(5.0)
        st, det, _ = await uat._booker_post(config, uat.HOTEL_BOOKING_DETAILS_PATH, {"bookingId": booking_id})
        status = uat.booking_details_summary(det).get("order_status")
        print(f"BOOKING DETAILS poll {attempt + 1}: HTTP {st} order_status={status}")
        if done(status):
            break
    return status


async def run_book_and_cancel(args: argparse.Namespace) -> None:
    config, session, _option, review = await _fresh_review(args)
    reqs = uat.book_requirements(review)
    print("BOOK REQUIREMENTS (from Review):", json.dumps(reqs, indent=1))
    execute = bool(args.execute_uat_book)
    if not reqs["booking_id_present"]:
        raise SystemExit("Review returned no bookingId; Book cannot be built.")
    if reqs["passport_required"]:
        raise SystemExit("Review requires passport; Test Case 4 expects no passport. Book NOT called.")
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
    booked = await _poll(config, booking_id, args.poll_attempts, lambda s: s in BOOKED_STATUSES | FAIL_STATUSES)
    if booked not in BOOKED_STATUSES:
        raise SystemExit(f"Booking not SUCCESS (status={booked}); Cancel NOT called.")
    print("CANCELLING the UAT booking (cancel-booking/{bookingId}).")
    st, cb, _ = await uat._booker_post(config, f"{uat.HOTEL_CANCEL_BOOKING_PATH}/{booking_id}", None)
    print("CANCEL HTTP status:", st, "summary:", json.dumps(uat.book_summary(cb)))
    final = await _poll(config, booking_id, 6, lambda s: isinstance(s, str) and s.upper().startswith("CANCEL"))
    print("POST-CANCEL order_status:", final)
    print("NOTE: UAT only; no production booking record was saved.")


async def run(ns: argparse.Namespace) -> Optional[Path]:
    args = build_args(ns)
    recorder = Recorder()
    undo = tc3.install_capture(recorder)
    try:
        await run_book_and_cancel(args)
    finally:
        undo()
    if not args.execute_uat_book:
        print("DRY RUN: nothing exported.")
        return None
    zip_path = export(recorder, Path(ns.out_dir))
    print("TEST CASE 4 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc4")
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
