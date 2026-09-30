"""UAT hotel hold-confirm diagnostic.

Confirms an existing ON_HOLD **UAT** hotel booking by its internal booking
reference (e.g. FNFH1A2B3C), then polls Booking Details until the booking is
CONFIRMED, FAILED, or the poll times out. It reuses the production lifecycle
(`hotel_booking.confirm_loaded_hold` + `poll_until_terminal`) so state
transitions, compare-and-set guards and audit events are identical.

Safety:
- Refuses when APP_ENV is production, and when the booker host is a
  production TripJack host (the service's provider factory also refuses).
- DRY RUN by default: prints the booking's safe status and makes no call.
  A real confirm needs --execute --confirm CONFIRM-UAT-HOLD.
- Output never includes TripJack booking/option/hotel ids, guest names,
  PAN, passport, email, phone, API keys or raw provider payloads.

Usage (from backend/):
    python -m app.diagnostics.hotel_hold_confirm --reference FNFH1A2B3C
    python -m app.diagnostics.hotel_hold_confirm --reference FNFH1A2B3C \\
        --execute --confirm CONFIRM-UAT-HOLD [--max-seconds 180]
"""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any, Awaitable, Callable, Optional

from app.core.config import Settings, get_settings
from app.integrations.tripjack.config import build_hotel_booker_config
from app.services import hotel_booking as svc

CONFIRM_PHRASE = "CONFIRM-UAT-HOLD"
OUTCOME_CONFIRMED = "CONFIRMED"
OUTCOME_FAILED = "FAILED"
OUTCOME_TIMEOUT = "TIMEOUT"
OUTCOME_STILL_ON_HOLD = "STILL_ON_HOLD"


def safe_view(b: svc.HotelBooking) -> dict[str, Any]:
    """Operator-safe facts only. No provider ids, guests, contact or payloads."""
    return {
        "booking_reference": b.booking_reference,
        "status": b.status,
        "mode": b.mode,
        "hold_deadline": b.hold_deadline,
        "total_amount": b.total_amount,
        "currency": b.currency,
        "hotel_confirmation_number_present": bool(b.hotel_confirmation_number),
        "provider_booking_id_present": bool(b.provider_booking_id),
        "status_message": b.status_message,
    }


def outcome(b: svc.HotelBooking) -> str:
    if b.status == svc.CONFIRMED:
        return OUTCOME_CONFIRMED
    if b.status in svc.TERMINAL:
        return OUTCOME_FAILED
    if b.status == svc.ON_HOLD:
        return OUTCOME_STILL_ON_HOLD
    return OUTCOME_TIMEOUT


def guard_uat(settings: Settings) -> None:
    if settings.is_production:
        raise SystemExit("Refusing: APP_ENV is production. This diagnostic is UAT only.")
    cfg = build_hotel_booker_config(settings)
    if cfg.targets_production:
        raise SystemExit("Refusing: hotel booker host is a PRODUCTION TripJack host. UAT only.")


async def run(
    *, reference: str, execute: bool, confirm: str, max_seconds: float,
    settings: Optional[Settings] = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> str:
    settings = settings or get_settings()
    guard_uat(settings)
    store = svc.BookingStore(settings)
    b = await store.get(reference.strip().upper())
    if b is None:
        raise SystemExit("Booking reference not found.")
    print("BOOKING (before):", json.dumps(safe_view(b)))
    if b.status != svc.ON_HOLD:
        raise SystemExit(f"Refusing: booking is {b.status}, not ON_HOLD. Confirm NOT called.")
    if not b.provider_booking_id:
        raise SystemExit("Refusing: booking has no provider booking. Confirm NOT called.")
    if not execute:
        print("DRY RUN: Confirm NOT called. Re-run with --execute --confirm "
              f"{CONFIRM_PHRASE} to confirm this UAT hold (debits the UAT wallet, no real payment).")
        return "DRY_RUN"
    if confirm != CONFIRM_PHRASE:
        raise SystemExit(f"Refusing: --confirm {CONFIRM_PHRASE} is required. Confirm NOT called.")

    print("WARNING: confirming a REAL TripJack UAT hold booking.")
    try:
        b = await svc.confirm_loaded_hold(settings=settings, store=store, b=b, payment_verified=False)
    except svc.HotelHoldExpiredError:
        raise SystemExit("Refusing: hold deadline has passed or is unknown. Confirm NOT called.")
    except svc.HotelBookingDuplicateError:
        raise SystemExit("Refusing: a confirm is already in progress or done.")
    print("AFTER CONFIRM REQUEST:", json.dumps(safe_view(b)))
    if b.status == svc.CONFIRMING:
        provider = svc.provider_factory(settings)
        b = await svc.poll_until_terminal(store, provider, b, max_seconds=max_seconds, sleep=sleep)
    result = outcome(b)
    print("BOOKING (after):", json.dumps(safe_view(b)))
    print("OUTCOME:", result)
    return result


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="Confirm an ON_HOLD UAT hotel booking (UAT only).")
    ap.add_argument("--reference", required=True, help="internal booking reference, e.g. FNFH1A2B3C")
    ap.add_argument("--execute", action="store_true", help="actually send Confirm Book to TripJack UAT")
    ap.add_argument("--confirm", default="", help=f"must be {CONFIRM_PHRASE} with --execute")
    ap.add_argument("--max-seconds", type=float, default=svc.POLL_MAX,
                    help="max seconds to poll Booking Details after confirm")
    a = ap.parse_args(argv)
    asyncio.run(run(reference=a.reference, execute=a.execute, confirm=a.confirm, max_seconds=a.max_seconds))


if __name__ == "__main__":
    main()
