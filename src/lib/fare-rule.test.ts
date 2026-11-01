/**
 * Fare-rule fetch contract for the Flight Review page:
 *  - POST /api/v1/flights/fare-rule with exactly { searchId, fareId }
 *  - selection refs survive a round-trip through sessionStorage
 *
 * booking-api reads VITE_BOOKING_API_URL at module load; run with it set,
 * e.g. VITE_BOOKING_API_URL=https://booking.example.test (no real I/O),
 * matching the existing booking-api tests.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { bookingApi, bookingApiBaseUrl } = await import("./booking-api");
const { readFareRefs, rememberFareRefs } = await import("./review-session");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Minimal in-memory sessionStorage — tests run in Node, no DOM. */
function createStorage() {
  const map = new Map<string, string>();
  return {
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

function stubSessionStorage() {
  const storage = createStorage();
  (globalThis as { window?: unknown }).window = { sessionStorage: storage };
  return storage;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("flightFareRules POSTs the selected searchId and fareId to /api/v1/flights/fare-rule", async () => {
  const calls: [string, RequestInit][] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(input), init as RequestInit]);
    return jsonResponse({ success: true, data: { cancellation: ["Non-refundable"] } });
  }) as typeof fetch;

  const rules = await bookingApi.flightFareRules({ searchId: "search-123", fareId: "fare-456" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `${bookingApiBaseUrl}/api/v1/flights/fare-rule`);
  assert.equal(calls[0][1].method, "POST");
  assert.deepEqual(JSON.parse(calls[0][1].body as string), {
    searchId: "search-123",
    fareId: "fare-456",
  });
  assert.deepEqual(rules, { cancellation: ["Non-refundable"] });
});

/** Captured live shape: response.fareRules[0].fareRule["DEL-BOM"].tfr */
const CAPTURED_FARE_RULE_RESPONSE = {
  fareRules: [
    {
      fareRule: {
        "DEL-BOM": {
          tfr: {
            CANCELLATION: ["Cancellation fee of INR 3500 applies", "Non-refundable within 24h"],
            DATECHANGE: ["Date change fee of INR 2500 per passenger"],
            NO_SHOW: ["No-show forfeits the base fare"],
            SEAT_CHARGEABLE: ["Seat selection is chargeable on this fare"],
          },
        },
      },
    },
  ],
};

test("flightFareRules normalizes the raw fareRules[0].fareRule[route].tfr shape", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ success: true, data: CAPTURED_FARE_RULE_RESPONSE })) as typeof fetch;

  const rules = await bookingApi.flightFareRules({ searchId: "s", fareId: "f" });

  assert.deepEqual(rules, {
    cancellation: ["Cancellation fee of INR 3500 applies", "Non-refundable within 24h"],
    dateChange: ["Date change fee of INR 2500 per passenger"],
    noShow: ["No-show forfeits the base fare"],
    seatCharges: ["Seat selection is chargeable on this fare"],
  });
});

test("flightFareRules resolves the route key dynamically and merges multi-leg routes", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      success: true,
      data: {
        fareRules: [
          {
            fareRule: {
              "BOM-GOI": { tfr: { CANCELLATION: ["Leg 1 cancellation"] } },
              "GOI-DEL": { tfr: { CANCELLATION: ["Leg 2 cancellation"] } },
            },
          },
        ],
      },
    })) as typeof fetch;

  const rules = await bookingApi.flightFareRules({ searchId: "s", fareId: "f" });

  assert.deepEqual(rules, { cancellation: ["Leg 1 cancellation", "Leg 2 cancellation"] });
});

test("flightFareRules unwraps the production response.fareRules route before rendering", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ response: CAPTURED_FARE_RULE_RESPONSE })) as typeof fetch;
  const rules = await bookingApi.flightFareRules({ searchId: "selected-search", fareId: "selected-fare" });
  assert.deepEqual(rules, {
    cancellation: CAPTURED_FARE_RULE_RESPONSE.fareRules[0].fareRule["DEL-BOM"].tfr.CANCELLATION,
    dateChange: CAPTURED_FARE_RULE_RESPONSE.fareRules[0].fareRule["DEL-BOM"].tfr.DATECHANGE,
    noShow: CAPTURED_FARE_RULE_RESPONSE.fareRules[0].fareRule["DEL-BOM"].tfr.NO_SHOW,
    seatCharges: CAPTURED_FARE_RULE_RESPONSE.fareRules[0].fareRule["DEL-BOM"].tfr.SEAT_CHARGEABLE,
  });
});

test("flightFareRules retains policyInfo objects and later fare-rule entries", async () => {
  globalThis.fetch = (async () => jsonResponse({ success: true, data: { response: {
    fareRules: [
      { fareRule: { "BOM-GOI": { tfr: { CANCELLATION: { policyInfo: "Cancellation policy supplied by airline" } } } } },
      { fareRule: { "GOI-DEL": { tfr: { SEAT_CHARGEABLE: { policyInfo: "Seat policy supplied by airline" } } } } },
    ],
  } } })) as typeof fetch;
  assert.deepEqual(await bookingApi.flightFareRules({ searchId: "s", fareId: "f" }), {
    cancellation: ["Cancellation policy supplied by airline"],
    seatCharges: ["Seat policy supplied by airline"],
  });
});

test("flightFareRules returns empty topics when tfr is missing so no fallback hides valid data", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      success: true,
      data: { fareRules: [{ fareRule: { "DEL-BOM": {} } }] },
    })) as typeof fetch;

  const rules = await bookingApi.flightFareRules({ searchId: "s", fareId: "f" });

  assert.deepEqual(rules, {});
});

test("flightFareRules surfaces backend failures as booking errors", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(
      { success: false, code: "FARE_RULE_UNAVAILABLE", message: "Rules unavailable" },
      500,
    )) as typeof fetch;

  await assert.rejects(
    bookingApi.flightFareRules({ searchId: "s", fareId: "f" }),
    (error: unknown) => {
      const err = error as { kind?: string; message?: string };
      assert.equal(err.kind, "server");
      assert.equal(err.message, "Rules unavailable");
      return true;
    },
  );
});

test("fare refs round-trip the selected searchId + fareId keyed by review token", () => {
  stubSessionStorage();
  rememberFareRefs("review-token-1", { searchId: "search-123", fareId: "fare-456" });
  assert.deepEqual(readFareRefs("review-token-1"), { searchId: "search-123", fareId: "fare-456" });
});

test("fare refs are isolated per review token and empty values are rejected", () => {
  stubSessionStorage();
  rememberFareRefs("token-a", { searchId: "s-a", fareId: "f-a" });
  rememberFareRefs("token-b", { searchId: "s-b", fareId: "f-b" });
  rememberFareRefs("token-c", { searchId: "", fareId: "f-c" });
  assert.deepEqual(readFareRefs("token-a"), { searchId: "s-a", fareId: "f-a" });
  assert.deepEqual(readFareRefs("token-b"), { searchId: "s-b", fareId: "f-b" });
  assert.equal(readFareRefs("token-c"), null);
  assert.equal(readFareRefs("unknown"), null);
});

test("fare refs return null for corrupt entries instead of throwing", () => {
  const storage = stubSessionStorage();
  storage.setItem("fnf.fareRefs.broken", "{not json");
  storage.setItem("fnf.fareRefs.partial", JSON.stringify({ searchId: "s" }));
  assert.equal(readFareRefs("broken"), null);
  assert.equal(readFareRefs("partial"), null);
});
