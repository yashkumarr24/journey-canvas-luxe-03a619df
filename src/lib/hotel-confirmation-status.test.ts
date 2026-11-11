import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmationHeaderCopy, unpaidBookingCopy } from "./hotel-confirmation-status";
import type { BookingStatus } from "@/types/booking";

const ALL_STATUSES: BookingStatus[] = [
  "awaiting_payment",
  "payment_processing",
  "payment_failed",
  "booking_processing",
  "confirmed",
  "on_hold",
  "confirming",
  "cancellation_pending",
  "failed",
  "cancelled",
  "expired",
];

function headerText(status: BookingStatus): string {
  const copy = confirmationHeaderCopy(status);
  return `${copy.title} ${copy.accent} ${copy.subtitle}`.toLowerCase();
}

test("only the confirmed status produces confirmed wording", () => {
  for (const status of ALL_STATUSES) {
    const text = headerText(status);
    if (status === "confirmed") {
      assert.match(text, /confirmed/);
    } else {
      assert.doesNotMatch(text, /confirmed|stay is booked|your stay is booked/);
    }
  }
});

test("only the on_hold status produces hold wording", () => {
  for (const status of ALL_STATUSES) {
    const text = headerText(status);
    if (status === "on_hold") {
      assert.match(text, /on hold/);
    } else {
      assert.doesNotMatch(text, /on hold|held/);
    }
  }
});

test("cancelled and failed statuses say the booking is not completed", () => {
  assert.match(headerText("cancelled"), /cancelled/);
  assert.match(headerText("failed"), /not completed/);
  assert.match(headerText("expired"), /not completed/);
});

test("pending payment statuses never imply the room is booked or held", () => {
  for (const status of ["awaiting_payment", "payment_failed", "payment_processing"] as const) {
    const text = headerText(status);
    assert.doesNotMatch(text, /booked|held|on hold/);
  }
});

test("unpaid copy exists only for unpaid statuses and never mentions a hold", () => {
  const awaiting = unpaidBookingCopy("awaiting_payment");
  const failedPayment = unpaidBookingCopy("payment_failed");
  assert.ok(awaiting);
  assert.ok(failedPayment);
  for (const copy of [awaiting, failedPayment]) {
    const text = `${copy.title} ${copy.body}`.toLowerCase();
    assert.doesNotMatch(text, /held|on hold|confirmed/);
  }
  assert.match(awaiting.body, /not booked yet/);
  assert.match(failedPayment.body, /not booked/);

  for (const status of ALL_STATUSES) {
    if (status !== "awaiting_payment" && status !== "payment_failed") {
      assert.equal(unpaidBookingCopy(status), null);
    }
  }
});
