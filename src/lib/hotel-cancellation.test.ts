import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPolicyCharge, formatPolicyRule, formatPolicyTime } from "./hotel-cancellation";

test("policy times are shown exactly as TripJack sends them, in IST", () => {
  assert.equal(formatPolicyTime("2026-05-18T23:59:00", "Now"), "18 May 2026, 23:59:00 IST");
});

test("missing window bounds use Now / check-in", () => {
  assert.equal(formatPolicyTime(undefined, "check-in"), "check-in");
});

test("zero amount is free, missing amount is not", () => {
  assert.equal(formatPolicyCharge({ charge: { amount: 0, currency: "INR" } }), "free cancellation (no charge)");
  assert.equal(formatPolicyCharge({}), "charge not specified by the hotel");
});

test("a penalty slab keeps its exact amount", () => {
  const text = formatPolicyRule({ from: "2026-05-19T00:00:00", to: "2026-05-26T00:00:00", charge: { amount: 1234.5, currency: "INR" } });
  assert.match(text, /^19 May 2026, 00:00:00 IST – 26 May 2026, 00:00:00 IST: charge /);
  assert.match(text, /1,234\.5/);
});
