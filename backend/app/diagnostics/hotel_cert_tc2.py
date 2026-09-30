"""TripJack Hotel v3 certification — Test Case 2 capture/export (UAT ONLY).

Matches Aryan's Test Case 2 sample:
  * 1 room: 4 adults + 2 children (ages 2, 3), 1 night, INR, nationality 106
  * flow: search -> detail -> review (onholdAllowed=false) -> INSTANT Book
    (paymentInfos = latest Review totalPrice) -> booking-details
  * PAN on every adult (Review panRequired); no passport
  * cancellation policy files derived from the Review reply (v3 has no endpoint)

12 files in "Test Case 2/" (the sample ZIP holds 12, not 13):
  TJ test Hotel Search / hotelDetail-search / Hotel review /
  Hotel cancellation policy / Hotel Book / hotel booking detail
  (each "Request.json" and "Response.json").

Reuses hotel_cert_tc3's capture (JSON bodies only, never headers; credential
keys stripped) and hotel_listing_uat's search/detail/review/payload helpers.
hotel_listing_uat.run_book (HOLD only) is NOT changed; this module sends the
instant Book itself, behind its own gates:
  * TripJack booking base URL must be the UAT host (checked by _booker_post)
  * --execute-uat-book --confirm CREATE-UAT-BOOK
  * Review must explicitly say onholdAllowed=false
  * pre-flight validation must pass

Run on the VPS from backend/ (creates a REAL UAT booking, debits UAT wallet):

    python -m app.diagnostics.hotel_cert_tc2 --destination Mumbai \\
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
from app.diagnostics import hotel_listing_uat as uat

CASE_FOLDER = "Test Case 2"
ZIP_NAME = "Test_Case_2.zip"
BOOK_CONFIRM_PHRASE = "CREATE-UAT-BOOK"
EXPORT_STATUSES = {"SUCCESS", "PAYMENT_SUCCESS"}  # sample's final status is PAYMENT_SUCCESS
FAIL_STATUSES = {"FAILED", "ABORTED", "CANCELLED"}

TC2_ROOMS: list[dict[str, Any]] = [{"adults": 4, "childAges": [2, 3]}]
TC2_NIGHTS = 1

# "book" is recorded by tc3's capture under the "hold" key (same TripJack path).
STEPS: tuple[tuple[str, str], ...] = (
    ("search", "TJ test Hotel Search"),
    ("detail", "TJ test hotelDetail-search"),
    ("review", "TJ test Hotel review"),
    ("cancellation", "TJ test Hotel cancellation policy"),
    ("hold", "TJ test Hotel Book"),
    ("booking_detail", "TJ test hotel booking detail"),
)
FILENAMES: tuple[str, ...] = tuple(f"{stem} {kind}.json" for _, stem in STEPS for kind in ("Request", "Response"))


def review_hold_explicitly_false(review: Any) -> bool:
    if not isinstance(review, dict) or "onholdAllowed" not in review:
        return False
    v = review["onholdAllowed"]
    return v is False or (isinstance(v, str) and v.strip().lower() == "false")


def review_total(review: Any) -> Optional[float]:
    opt = review.get("option") if isinstance(review, dict) else None
    price = (opt or {}).get("pricing") if isinstance(opt, dict) else None
    total = (price or {}).get("totalPrice") if isinstance(price, dict) else None
    try:
        total = float(total)
    except (TypeError, ValueError):
        return None
    return total if total > 0 else None


def build_instant_payload(hold_payload: dict[str, Any], amount: float) -> dict[str, Any]:
    """HOLD body + paymentInfos (sample layout: after "type")."""
    payload = dict(hold_payload)
    payload["paymentInfos"] = [{"amount": amount}]
    return payload


def export(recorder: tc3.Recorder, out_dir: Path) -> Path:
    """Write the 12 files under out_dir/'Test Case 2' and a ZIP next to it."""
    recorder.derive_cancellation()
    missing = [s for s, _ in STEPS if s not in recorder.pairs]
    if missing:
        raise SystemExit(f"Refusing export: steps not captured: {', '.join(missing)}")
    if "confirm" in recorder.pairs:
        raise SystemExit("Refusing export: Test Case 2 must not include a confirm-hold call.")
    book_req = recorder.pairs["hold"][0]
    if not (isinstance(book_req, dict) and book_req.get("paymentInfos")):
        raise SystemExit("Refusing export: Book request has no paymentInfos (not an instant booking).")
    if recorder.final_status() not in EXPORT_STATUSES:
        raise SystemExit(f"Refusing export: booking not successful (status={recorder.final_status()}).")
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
    """Arguments for the uat search/review helpers: Test Case 2 fixed."""
    return argparse.Namespace(
        destination=ns.destination, days_ahead=ns.days_ahead, nights=TC2_NIGHTS, adults=4,
        rooms=copy.deepcopy(TC2_ROOMS), hotel_id=ns.hotel_id, search_id="", option_id="",
        require_hold=False, max_hold_candidates=1,
        max_instant_candidates=ns.max_instant_candidates,
        execute_uat_book=ns.execute_uat_book, confirm=ns.confirm, confirm_hold=False,
        cancel_after=False, contact_email=ns.contact_email, contact_phone=ns.contact_phone,
        pan=ns.pan, passport="", lead_guest=ns.lead_guest, poll_attempts=36,
    )


async def _fresh_instant_review(args: argparse.Namespace):
    """search -> detail -> review, iterating hotels/options until one Review
    explicitly says onholdAllowed=false (instant-eligible). Read-only: Book
    never runs here. Returns (config, session, option, review)."""
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
    # Wider sweep before giving up: default 30 reviewed options (configurable).
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
            ok = status < 400 and rs.get("status_success") is not False and isinstance(review, dict)
            if not ok:
                print(f"CANDIDATE {tried}: review failed; skipping.")
                continue
            safe = uat.hold_candidate_summary(review, option)
            print(f"CANDIDATE {tried}:", json.dumps(safe, default=str))
            if review_hold_explicitly_false(review):
                print("INSTANT-ELIGIBLE OPTION FOUND (onholdAllowed=false):", json.dumps(safe, default=str))
                return config, session, option, review
            print("HOLD-ELIGIBLE OPTION: not usable for Test Case 2; trying next.")
        if tried >= limit:
            break
    raise SystemExit(f"NO INSTANT-ELIGIBLE OPTION: reviewed {tried} option(s) (limit {limit}); "
                     "none returned onholdAllowed=false. Book NOT called. "
                     "Re-run with a higher --max-instant-candidates to widen the sweep.")


async def run_instant_book(args: argparse.Namespace) -> None:
    config, session, _option, review = await _fresh_instant_review(args)
    reqs = uat.book_requirements(review)
    print("BOOK REQUIREMENTS (from Review):", json.dumps(reqs, indent=1))
    execute = bool(args.execute_uat_book)
    if not reqs["booking_id_present"]:
        raise SystemExit("Review returned no bookingId; Book cannot be built.")
    if not review_hold_explicitly_false(review):
        raise SystemExit("Refusing: Test Case 2 needs Review onholdAllowed=false; this option differs. Book NOT called.")
    if reqs["passport_required"]:
        raise SystemExit("Review requires passport; Test Case 2 expects no passport. Book NOT called.")
    if reqs["gst_info_needed"]:
        raise SystemExit("Review needs gstInfo; not supported. Book NOT called.")
    if reqs["pan_required"] and execute and not args.pan:
        raise SystemExit("Review says PAN is required: pass --pan.")
    amount = review_total(review)
    if amount is None:
        raise SystemExit("Review has no positive option.pricing.totalPrice; Book NOT called.")
    rooms = uat._rooms_from_session(session)
    pan_values = [v.strip() for v in args.pan.split(",") if v.strip()] if args.pan else []
    if len(pan_values) > 1:
        raise SystemExit("--pan: pass one PAN (applied to every adult, as in the sample).")
    hold_payload = uat.build_uat_book_payload(
        booking_id=str(review["bookingId"]), rooms=rooms,
        email=args.contact_email or "uat@example.invalid", phone=args.contact_phone or "9000000000",
        pan=pan_values[0] if pan_values else "", lead_guest=(args.lead_guest or "").strip(),
    )
    # Sample: PAN on adults only, children carry age.
    ages = [a for r in rooms for a in (r.get("childAges") or [])]
    ci = 0
    for block in hold_payload["roomTravellerInfo"]:
        for gi, t in enumerate(block["travellerInfo"]):
            if gi == 0:
                t["isLeadGuest"] = True
            if t["pt"] == "CHILD":
                t.pop("pan", None)
                t["age"] = ages[ci]
                ci += 1
    failures = [f for f in uat.validate_book_payload(hold_payload, rooms, pan_required=False,
                                                     passport_required=False)]
    if reqs["pan_required"]:
        for t in (t for b in hold_payload["roomTravellerInfo"] for t in b["travellerInfo"] if t["pt"] == "ADULT"):
            if not (isinstance(t.get("pan"), str) and uat._PAN_RE.match(t["pan"])):
                failures.append("adult.pan: required by Review and must match AAAAA9999A")
                break
    payload = build_instant_payload(hold_payload, amount)
    print("BOOK REQUEST (INSTANT, keys/types only):", json.dumps(uat.shape(payload), indent=1))
    print("BOOK IDENTITY (compare across attempts):", json.dumps(uat.booking_identity_summary(
        payload, hid=str(review.get("tjHotelId") or review.get("hotelId") or ""),
        check_in=session.check_in, check_out=session.check_out), indent=1))
    print("paymentInfos amount (Review totalPrice):", amount)
    print("PRE-FLIGHT VALIDATION:", "OK" if not failures else "FAILED")
    for f in failures:
        print("  -", f)
    if not execute:
        print(f"DRY RUN: Book NOT called. Re-run with --execute-uat-book --confirm {BOOK_CONFIRM_PHRASE} "
              "--contact-email ... --contact-phone ... --pan ... to place a UAT INSTANT booking.")
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
    last: dict[str, Any] = {}
    for attempt in range(max(1, args.poll_attempts)):
        await asyncio.sleep(5.0)
        st, det, _ = await uat._booker_post(config, uat.HOTEL_BOOKING_DETAILS_PATH, {"bookingId": booking_id})
        last = uat.booking_details_summary(det)
        print(f"BOOKING DETAILS poll {attempt + 1}: HTTP {st} order_status={last.get('order_status')}")
        if last.get("order_status") in {"SUCCESS"} | FAIL_STATUSES:
            break
    print("BOOKING DETAILS SUMMARY:", json.dumps(last, indent=1))
    print("NOTE: UAT only; no production booking record was saved.")


async def run(ns: argparse.Namespace) -> Optional[Path]:
    args = build_args(ns)
    recorder = tc3.Recorder()
    undo = tc3.install_capture(recorder)
    try:
        await run_instant_book(args)
    finally:
        undo()
    if not args.execute_uat_book:
        print("DRY RUN: nothing exported.")
        return None
    zip_path = export(recorder, Path(ns.out_dir))
    print("TEST CASE 2 EXPORTED:", zip_path, f"({len(FILENAMES)} files)")
    return zip_path


def main(argv: Optional[list[str]] = None) -> None:
    p = argparse.ArgumentParser(prog="hotel_cert_tc2")
    p.add_argument("--destination", default="Mumbai")
    p.add_argument("--hotel-id", default="")
    p.add_argument("--days-ahead", type=int, default=30)
    p.add_argument("--execute-uat-book", action="store_true")
    p.add_argument("--confirm", default="")
    p.add_argument("--contact-email", default="")
    p.add_argument("--contact-phone", default="")
    p.add_argument("--pan", default="")
    p.add_argument("--lead-guest", default="")
    p.add_argument("--max-instant-candidates", type=int, default=30,
                   help="max options to review before giving up (higher = wider sweep)")
    p.add_argument("--out-dir", default="certification")
    asyncio.run(run(p.parse_args(argv)))


if __name__ == "__main__":
    main()
