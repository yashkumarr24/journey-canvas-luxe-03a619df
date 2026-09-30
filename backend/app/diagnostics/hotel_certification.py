"""TripJack Hotel API v3 certification evidence recorder.

This tool NEVER calls TripJack and NEVER submits anything to TripJack. It only
lists the documented certification scenarios and records evidence that an
operator collected during a controlled UAT run.

Usage (from backend/):
    python -m app.diagnostics.hotel_certification list
    python -m app.diagnostics.hotel_certification record --case HOLD_THEN_CONFIRM_DOMESTIC \\
        --booking-reference FNFH1A2B3C --final-status CONFIRMED \\
        --confirmation-number <as returned by TripJack> --notes "..."
    python -m app.diagnostics.hotel_certification report

Evidence goes to the `hotel_certification_runs` table (migration 0018) when the
database is configured, otherwise to a local JSONL file. Request/response
evidence is stored as field NAMES/TYPES only; PAN, passport, email, phone and
API keys are stripped before anything is written.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

EVIDENCE_FILE = Path(os.environ.get("HOTEL_CERT_EVIDENCE_FILE", "certification_evidence.jsonl"))


@dataclass(frozen=True)
class CertCase:
    code: str
    title: str
    flow: str  # which lifecycle the operator runs
    notes: str = ""


CASES: tuple[CertCase, ...] = (
    CertCase("AUTO_CANCEL_ON_HOLD_DOMESTIC", "Auto cancellation of ON HOLD domestic booking",
             "hold -> leave past TripJack deadline -> details shows CANCELLED"),
    CertCase("INSTANT_DOMESTIC", "Instant domestic booking", "instant"),
    CertCase("HOLD_THEN_CONFIRM_DOMESTIC", "Hold then confirm domestic booking", "hold -> confirm"),
    CertCase("CANCEL_WITHIN_DEADLINE", "Book within cancellation deadline then cancel", "instant -> cancel"),
    CertCase("CANCEL_OUTSIDE_DEADLINE", "Book outside cancellation deadline then cancel", "instant -> cancel",
             "Pick a non-refundable / inside-penalty rate; record the charged penalty."),
    CertCase("CANCEL_ON_HOLD", "Cancel ON HOLD without confirming", "hold -> cancel"),
    CertCase("INSTANT_INTERNATIONAL", "Instant international booking", "instant (international destination)"),
    CertCase("INSTANT_TWO_ROOMS", "Instant booking with 2 rooms", "instant (2 rooms)"),
    CertCase("CANCELLATION_POLICY_DISPLAY", "Cancellation rules/policies displayed",
             "screenshot of review + confirmation cancellation policy"),
    CertCase("SAME_PAN_ALL_ROOMS", "Same PAN across all rooms", "instant (2 rooms, one PAN)"),
    CertCase("SAME_PAN_ALL_GUESTS", "Same PAN across all guests", "instant (one PAN for every guest)"),
    CertCase("PASSPORT_NON_INDIAN", "Passport booking for non-Indian traveller", "instant (passport)",
             "Only where Review reports passportRequired."),
    CertCase("CORPORATE_PAN", "Corporate PAN", "instant (corporate PAN / gstInfo)",
             "Only where applicable to the rate."),
    CertCase("CANCEL_ALL", "Cancel all certification bookings", "cancel every booking above"),
)
CASE_CODES = {c.code for c in CASES}

_SENSITIVE_KEYS = {"pan", "pnum", "pannumber", "passportnumber", "emails", "contacts", "email", "phone",
                   "apikey", "api_key", "reviewhash", "authorization"}


def shape(value: Any) -> Any:
    """Field names/types only. Sensitive keys are reduced to '<redacted>'."""
    if isinstance(value, dict):
        return {k: ("<redacted>" if k.lower().replace("_", "") in _SENSITIVE_KEYS else shape(v))
                for k, v in value.items()}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    return type(value).__name__


def build_record(
    *, case: str, booking_reference: Optional[str] = None, request: Any = None, response: Any = None,
    provider_booking_id: Optional[str] = None, confirmation_number: Optional[str] = None,
    final_status: Optional[str] = None, cancellation_status: Optional[str] = None,
    notes: Optional[str] = None, evidence: Optional[dict] = None,
) -> dict[str, Any]:
    if case not in CASE_CODES:
        raise ValueError("unknown_case")
    return {
        "case_code": case,
        "booking_reference": booking_reference,
        "request_summary": shape(request) if request is not None else {},
        "response_summary": shape(response) if response is not None else {},
        "provider_booking_id": provider_booking_id,
        # Recorded exactly as TripJack returned it. Never generated here.
        "confirmation_number": confirmation_number or None,
        "final_status": final_status,
        "cancellation_status": cancellation_status,
        "notes": notes,
        "evidence": shape(evidence) if evidence else {},
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }


async def save(record: dict[str, Any], settings=None) -> str:
    try:
        from app.core.config import get_settings
        from app.repositories.hotel_bookings import HotelBookingRepository

        repo = HotelBookingRepository(settings or get_settings())
        if repo.enabled:
            await repo.record_certification(record)
            return "database"
    except Exception:  # noqa: BLE001
        pass
    with EVIDENCE_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    return str(EVIDENCE_FILE)


def report(path: Path = EVIDENCE_FILE) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {c.code: [] for c in CASES}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("case_code") in out:
                out[r["case_code"]].append(
                    {k: r.get(k) for k in ("booking_reference", "final_status", "cancellation_status",
                                            "recorded_at")}
                    | {"confirmation_number_present": bool(r.get("confirmation_number"))})
    return out


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(prog="hotel_certification")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    rec = sub.add_parser("record")
    rec.add_argument("--case", required=True, choices=sorted(CASE_CODES))
    rec.add_argument("--booking-reference")
    rec.add_argument("--provider-booking-id")
    rec.add_argument("--confirmation-number")
    rec.add_argument("--final-status")
    rec.add_argument("--cancellation-status")
    rec.add_argument("--notes")
    sub.add_parser("report")
    a = ap.parse_args(argv)
    if a.cmd == "list":
        for c in CASES:
            print(f"{c.code:32} {c.title}  [{c.flow}]" + (f"  — {c.notes}" if c.notes else ""))
    elif a.cmd == "record":
        r = build_record(case=a.case, booking_reference=a.booking_reference,
                         provider_booking_id=a.provider_booking_id,
                         confirmation_number=a.confirmation_number, final_status=a.final_status,
                         cancellation_status=a.cancellation_status, notes=a.notes)
        print("saved to:", asyncio.run(save(r)))
    else:
        for code, rows in report().items():
            print(code, "->", rows or "no evidence yet")


if __name__ == "__main__":
    main()
