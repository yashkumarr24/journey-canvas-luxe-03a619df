import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const local = new MemoryStorage();
const session = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: local, sessionStorage: session };

const mod = await import("./hotel-session");
const HOUR = 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

beforeEach(() => { local.clear(); session.clear(); });

test("booking pass survives closing the app (stored outside the tab) for 48 hours", () => {
  mod.rememberHotelBookingGuestToken("FNF1", "pass-1", T0);
  session.clear(); // app closed
  assert.equal(mod.readHotelBookingGuestToken("FNF1", T0 + 47 * HOUR), "pass-1");
});

test("booking pass expires after 48 hours and is removed", () => {
  mod.rememberHotelBookingGuestToken("FNF1", "pass-1", T0);
  assert.equal(mod.readHotelBookingGuestToken("FNF1", T0 + 48 * HOUR), null);
  assert.equal(local.getItem("fnf.hotelBookingGuest.FNF1"), null);
});

test("expired passes for other bookings are cleaned up automatically", () => {
  mod.rememberHotelBookingGuestToken("OLD", "old", T0);
  mod.rememberHotelBookingGuestToken("NEW", "new", T0 + 49 * HOUR);
  assert.equal(local.getItem("fnf.hotelBookingGuest.OLD"), null);
  assert.equal(mod.readHotelBookingGuestToken("NEW", T0 + 49 * HOUR), "new");
});

test("guest names and contact details stay in short-term storage only", () => {
  mod.saveHotelSnapshot({
    bookingReference: "FNF1",
    contact: { email: "a@example.com", phone: "999" },
    guests: [{ firstName: "A", lastName: "B" }],
  } as never);
  assert.ok(session.getItem("fnf.hotelSnapshot.FNF1"));
  for (let i = 0; i < local.length; i++) assert.ok(!local.key(i)!.startsWith("fnf.hotelSnapshot."));
});

test("corrupt stored pass is treated as missing and removed", () => {
  local.setItem("fnf.hotelBookingGuest.FNF1", "{bad");
  assert.equal(mod.readHotelBookingGuestToken("FNF1", T0), null);
  assert.equal(local.getItem("fnf.hotelBookingGuest.FNF1"), null);
});
