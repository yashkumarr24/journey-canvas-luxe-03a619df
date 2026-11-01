/**
 * Fare-rule fetch contract for the Flight Review page:
 *  - POST /api/v1/flights/fare-rule with exactly { searchId, fareId }
 *  - the request fires once per selected flight (query config, not UI)
 *  - selection refs survive a round-trip through sessionStorage
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_BOOKING_API_URL", "https://api.example.test");

import { bookingApi } from "@/lib/booking-api";
import { readFareRefs, rememberFareRefs } from "@/lib/review-session";

const fetchMock = vi.fn();

/** Minimal in-memory sessionStorage — tests run in Node, no DOM. */
function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

let sessionStorageStub: Storage;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorageStub = createStorage();
  vi.stubGlobal("window", { sessionStorage: sessionStorageStub });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("bookingApi.flightFareRules", () => {
  it("POSTs the selected flight's searchId and fareId to /api/v1/flights/fare-rule", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { cancellation: ["Non-refundable"] } }),
    );

    const rules = await bookingApi.flightFareRules({ searchId: "search-123", fareId: "fare-456" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/v1/flights/fare-rule");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ searchId: "search-123", fareId: "fare-456" });
    expect(rules).toEqual({ cancellation: ["Non-refundable"] });
  });

  it("surfaces backend failures as booking errors", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, code: "FARE_RULE_UNAVAILABLE", message: "Rules unavailable" }, 500),
    );
    await expect(
      bookingApi.flightFareRules({ searchId: "s", fareId: "f" }),
    ).rejects.toMatchObject({ kind: "server", message: "Rules unavailable" });
  });
});

describe("fare refs session storage", () => {
  it("round-trips the selected searchId + fareId keyed by review token", () => {
    rememberFareRefs("review-token-1", { searchId: "search-123", fareId: "fare-456" });
    expect(readFareRefs("review-token-1")).toEqual({ searchId: "search-123", fareId: "fare-456" });
  });

  it("keeps refs isolated per review token and rejects empty values", () => {
    rememberFareRefs("token-a", { searchId: "s-a", fareId: "f-a" });
    rememberFareRefs("token-b", { searchId: "s-b", fareId: "f-b" });
    rememberFareRefs("token-c", { searchId: "", fareId: "f-c" });
    expect(readFareRefs("token-a")).toEqual({ searchId: "s-a", fareId: "f-a" });
    expect(readFareRefs("token-b")).toEqual({ searchId: "s-b", fareId: "f-b" });
    expect(readFareRefs("token-c")).toBeNull();
    expect(readFareRefs("unknown")).toBeNull();
  });

  it("returns null for corrupt entries instead of throwing", () => {
    window.sessionStorage.setItem("fnf.fareRefs.broken", "{not json");
    window.sessionStorage.setItem("fnf.fareRefs.partial", JSON.stringify({ searchId: "s" }));
    expect(readFareRefs("broken")).toBeNull();
    expect(readFareRefs("partial")).toBeNull();
  });
});
