import { test } from "node:test";
import assert from "node:assert/strict";
import { isAccessRejection, sanitizeBookingReference } from "./booking-reference";

test("plain booking references are accepted for prefill", () => {
  assert.equal(sanitizeBookingReference("FNFMOCK123"), "FNFMOCK123");
  assert.equal(sanitizeBookingReference(" FNF-2026-0001 "), "FNF-2026-0001");
});

test("emails, tokens-like or malformed values are never prefilled", () => {
  for (const bad of ["a@b.com", "abc", "<script>", "FNF 123", "x".repeat(41), "", 42, null, undefined]) {
    assert.equal(sanitizeBookingReference(bad), undefined, String(bad));
  }
});

test("only 401, 403 and 404 count as rejected access; 500 never does", () => {
  assert.equal(isAccessRejection(401), true);
  assert.equal(isAccessRejection(403), true);
  assert.equal(isAccessRejection(404), true);
  for (const s of [500, 502, 503, 408, 409, 400, undefined]) assert.equal(isAccessRejection(s), false);
});
