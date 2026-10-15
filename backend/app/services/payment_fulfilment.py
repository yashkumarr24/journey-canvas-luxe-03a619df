"""Durable fulfilment of verified PayU payments.

ISOLATED TEST PACKAGE: the hotel/flight booking modules are protected and
unchanged, so the live port (UninstalledHotelPort) is unavailable and run_once
never claims a job, whatever PAYMENT_FULFILMENT_ENABLED says. The booking logic
below is kept and unit-tested with fakes for a later, reviewed merge.

A job row is created by the database in the same transaction as the capture
(payu_capture, migration 0024). Workers claim jobs with FOR UPDATE SKIP LOCKED
and a lock expiry, so a crashed worker's job is picked up again.

Never rebook after a timeout or crash:
- Hotel: before any Book call the booking must still be DRAFT. If it has left
  DRAFT (a Book request was or may have been sent) the job only ever reads
  TripJack Booking Details and maps the result; it never calls Book again.
- Flight: TripJack flight booking/ticketing after payment is not implemented in
  this codebase yet, so flight jobs go to manual_review for the travel desk.

Job outcomes:
  succeeded        provider confirmed the booking (no refund)
  failed_confirmed provider confirms NO booking exists (refund eligible)
  uncertain        outcome unknown; rechecked via Booking Details, never rebooked
  manual_review    needs staff (no automatic refund either way)
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Optional, Protocol

from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import get_logger, log_extra
from app.services import payments as pay

logger = get_logger(__name__)

LOCK_SECONDS = 600
MAX_UNCERTAIN_ATTEMPTS = 40  # ~ every run for a few hours, then staff


class JobRepo(Protocol):
    async def claim_jobs(self, limit: int, lock_seconds: int) -> list: ...
    async def update_job(self, job_id: str, values: dict) -> None: ...
    async def payment_by_id(self, payment_id: str) -> Optional[dict]: ...


class HotelPort(Protocol):
    available: bool  # False -> the worker never claims a job
    async def get(self, reference: str) -> Optional[Any]: ...
    async def book(self, reference: str, idempotency_key: str) -> Any: ...
    async def refresh(self, reference: str) -> Optional[Any]: ...


# Hotel lifecycle -> job outcome
_HOTEL_OUTCOME = {
    "CONFIRMED": "succeeded",
    "FAILED": "failed_confirmed",
    "CANCELLED": "failed_confirmed",
    "BOOKING_IN_PROGRESS": "uncertain",
    "CONFIRMING": "uncertain",
    "REVIEWED": "uncertain",       # crashed between claim and send: nothing provable yet
    "ON_HOLD": "manual_review",    # paid but only held: staff confirm, never auto
}


def _hotel_outcome(status: Optional[str]) -> str:
    return _HOTEL_OUTCOME.get(status or "", "manual_review")


async def _run_hotel(job: dict, hotel: HotelPort) -> tuple[str, Optional[str]]:
    ref = job["subject_ref"]
    b = await hotel.get(ref)
    if b is None:
        return "manual_review", "hotel_booking_missing"
    if b.status != "DRAFT":
        # A Book call was (or may have been) sent earlier: read-only reconcile.
        fresh = await hotel.refresh(ref) or b
        return _hotel_outcome(fresh.status), f"details:{fresh.status}"
    try:
        b = await hotel.book(ref, f"payu:{job['payment_id']}")
    except AppError as exc:
        after = await hotel.get(ref)
        if after is not None and after.status == "DRAFT":
            # Refused before any Book request was sent (price change, sold out,
            # missing GST/PAN): provider holds no booking.
            return "failed_confirmed", exc.code
        return "uncertain", exc.code
    return _hotel_outcome(b.status), f"book:{b.status}"


async def run_once(repo: JobRepo, settings: Settings, *, hotel: HotelPort, limit: int = 10) -> list[str]:
    if not pay.fulfilment_allowed(settings):
        logger.info("payment_fulfilment_disabled")
        return []
    if not getattr(hotel, "available", False):
        # This package keeps the protected hotel module unchanged, so there is
        # no paid-booking entry point. Jobs stay queued (never claimed).
        logger.info("payment_fulfilment_not_installed")
        return []
    results = []
    for job in await repo.claim_jobs(limit, LOCK_SECONDS):
        status, code = "manual_review", None
        try:
            if job["subject_type"] == "hotel":
                status, code = await _run_hotel(job, hotel)
            else:
                status, code = "manual_review", "flight_fulfilment_not_implemented"
        except Exception:  # noqa: BLE001 - never lose the job; recheck later, never rebook
            status, code = "uncertain", "worker_error"
        if status == "uncertain" and int(job.get("attempts") or 0) >= MAX_UNCERTAIN_ATTEMPTS:
            status = "manual_review"
        await repo.update_job(job["id"], {"status": status, "last_code": (code or "")[:80] or None,
                                          "locked_until": None})
        logger.info("payment_fulfilment_job", extra=log_extra(subject=job["subject_type"], status=status))
        results.append(status)
    return results


def refund_eligibility(repo: Any) -> pay.RefundEligibility:
    """Refund only when it is provable that no provider booking exists.

    - job failed_confirmed: the provider confirmed there is no booking; or
    - hotel job withdrawn (or withdrawable now): the job was never claimed, so
      no TripJack call was ever made; withdrawing it atomically (DB function
      payu_withdraw_job, requires hotel booking still DRAFT) stops any later
      worker from booking. Booking status is never edited to permit a refund.
    Flights: never (flight payments are disabled).
    No TripJack call is made here.
    """
    async def eligible(payment: dict, subject: dict) -> bool:
        job = await repo.job_for_payment(payment["id"])
        if job and job.get("status") in ("failed_confirmed", "withdrawn"):
            return True
        if subject["kind"] != "hotel" or not job:
            return False
        return await repo.withdraw_job(payment["id"])
    return eligible


class UninstalledHotelPort:
    """Live port for this package: the protected hotel module has no
    paid-booking function, so this port never calls TripJack."""

    available = False

    def __init__(self, settings: Settings) -> None:
        self._s = settings

    async def get(self, reference: str):
        raise RuntimeError("hotel_fulfilment_not_installed")

    async def book(self, reference: str, idempotency_key: str):
        raise RuntimeError("hotel_fulfilment_not_installed")

    async def refresh(self, reference: str):
        raise RuntimeError("hotel_fulfilment_not_installed")


Runner = Callable[[], Awaitable[Any]]
