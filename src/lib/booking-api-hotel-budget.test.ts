import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalTimeout;
});

test('hotel search allows 50s delivery headroom without changing the 45s default', async () => {
  // Run with VITE_BOOKING_API_URL=https://booking.example.test (no real I/O).
  const { bookingApi, DEFAULT_TIMEOUT_MS } = await import('./booking-api');
  const timers: number[] = [];
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    timers.push(delay ?? 0);
    return originalTimeout(callback, delay);
  }) as typeof setTimeout;
  globalThis.fetch = (async () => Response.json({ searchId: 'fixture', results: [], partial: true,
    completedBatches: 36, failedBatches: 31, currency: 'INR' })) as typeof fetch;
  const result = await bookingApi.searchHotels({ destination: 'Dubai', checkIn: '2026-12-01',
    checkOut: '2026-12-03', rooms: [{ adults: 2, childAges: [] }] });
  assert.deepEqual(timers, [50_000]);
  assert.equal(DEFAULT_TIMEOUT_MS, 45_000);
  assert.equal(result.partial, true);
  assert.equal(result.completedBatches, 36);
  assert.equal(result.failedBatches, 31);
});