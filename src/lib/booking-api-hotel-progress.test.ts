import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalTimeout;
});

test('hotel search progress polls the progress endpoint with offset and default timeout', async () => {
  // Run with VITE_BOOKING_API_URL=https://booking.example.test (no real I/O).
  const { bookingApi, DEFAULT_TIMEOUT_MS, HOTEL_SEARCH_TIMEOUT_MS } = await import('./booking-api');
  const urls: string[] = [];
  const timers: number[] = [];
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    timers.push(delay ?? 0);
    return originalTimeout(callback, delay);
  }) as typeof setTimeout;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json({
      status: 'loading', completedBatches: 5, failedBatches: 0, totalBatches: 67,
      results: [{ id: 'h1', name: 'Sea View' }], nextOffset: 41,
    });
  }) as typeof fetch;

  const result = await bookingApi.hotelSearchProgress('abc123token', 40);

  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://booking.example.test/api/v1/hotels/search/abc123token/progress?offset=40');
  // Progress polls are quick reads: default 45s timeout, not the 90s search budget.
  assert.deepEqual(timers, [DEFAULT_TIMEOUT_MS]);
  assert.notEqual(DEFAULT_TIMEOUT_MS, HOTEL_SEARCH_TIMEOUT_MS);
  assert.equal(result.status, 'loading');
  assert.equal(result.nextOffset, 41);
  assert.equal(result.results.length, 1);
});

test('hotel search progress clamps negative offsets and encodes the search id', async () => {
  const { bookingApi } = await import('./booking-api');
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json({ status: 'complete', completedBatches: 2, failedBatches: 0, totalBatches: 2, results: [], nextOffset: 0 });
  }) as typeof fetch;

  await bookingApi.hotelSearchProgress('id with/slash', -5);

  assert.equal(urls[0], 'https://booking.example.test/api/v1/hotels/search/id%20with%2Fslash/progress?offset=0');
});
