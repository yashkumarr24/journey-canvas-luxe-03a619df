"""Hotel Listing-only, process-wide dispatch guard. No booking calls use this.

TripJack documents 100 IDs and Retry-After, not an account concurrency/QPS
entitlement. These conservative ceilings are configurable downward; validate
account limits on UAT before raising them. Each VPS worker has its own guard.
"""
import asyncio
import time
from weakref import WeakKeyDictionary


class ListingDispatch:
    def __init__(self, concurrency: int, starts_per_second: float):
        self.slots = asyncio.Semaphore(concurrency)
        self.lock = asyncio.Lock()
        self.interval = 1 / starts_per_second
        self.next_start = 0.0
        self.cooldown_until = 0.0

    async def wait_turn(self):
        async with self.lock:
            # Recheck after sleep: another in-flight request can report 429.
            while True:
                delay = max(self.next_start, self.cooldown_until) - time.monotonic()
                if delay <= 0:
                    self.next_start = time.monotonic() + self.interval
                    return
                await asyncio.sleep(delay)

    def throttled(self, retry_after: float):
        self.cooldown_until = max(self.cooldown_until, time.monotonic() + retry_after)


_guards: WeakKeyDictionary = WeakKeyDictionary()


def listing_dispatch(concurrency: int, starts_per_second: float) -> ListingDispatch:
    loop = asyncio.get_running_loop()
    guards = _guards.setdefault(loop, {})
    key = (concurrency, starts_per_second)
    if key not in guards:
        guards[key] = ListingDispatch(concurrency, starts_per_second)
    return guards[key]