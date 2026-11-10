import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFlightTransactionsAvailable, FLIGHTS_UNDER_MAINTENANCE } from "./flight-maintenance";

test("Flight transactions are disabled during maintenance", () => {
  assert.equal(FLIGHTS_UNDER_MAINTENANCE, true);
  assert.throws(assertFlightTransactionsAvailable, /under maintenance/);
});