"""PayU background worker: payment reconciliation, fulfilment jobs, refund status.

Run from a systemd timer / cron every minute on the VPS:

    python -m app.jobs.payments_worker --once

Does nothing unless PAYMENTS_ENABLED and the PayU gates pass; fulfilment also
requires PAYMENT_FULFILMENT_ENABLED and isolated TripJack hosts. Prints only
counts, never identifiers, hashes or payloads.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter

from app.core.config import get_settings
from app.repositories.payments import PaymentsRepo
from app.services import payment_fulfilment as fulfil
from app.services import payments as svc


async def tick() -> dict[str, dict[str, int]]:
    settings = get_settings()
    if not svc.payments_allowed(settings):
        return {"skipped": {"payments_disabled": 1}}
    repo, client = PaymentsRepo(settings), svc.build_client(settings)
    payments = Counter(o.status for o in await svc.reconcile(repo, client))
    jobs = Counter(await fulfil.run_once(repo, settings, hotel=fulfil.LiveHotelPort(settings)))
    refunds = Counter(await svc.reconcile_refunds(repo, client))
    return {"payments": dict(payments), "jobs": dict(jobs), "refunds": dict(refunds)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="run one pass and exit")
    args = parser.parse_args()
    if not args.once:
        parser.error("only --once is supported; schedule it with a systemd timer")
    print(asyncio.run(tick()))


if __name__ == "__main__":
    main()
