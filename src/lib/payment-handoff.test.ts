import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePaymentHandoff, simulatedCheckoutAllowed } from "./payment-handoff";
import type { PaymentOrder } from "@/types/booking";

const payu = {
  provider: "payu",
  action: "https://test.payu.in/_payment",
  fields: { hash: "h", txnid: "T" },
} as unknown as PaymentOrder;
const other = { provider: "razorpay" } as unknown as PaymentOrder;

test("posts signed PayU orders to PayU", () => {
    assert.equal(resolvePaymentHandoff(payu, { dev: false }), "payu");
  });

test("never falls back to a simulated sheet on a deployed site", () => {
    assert.equal(resolvePaymentHandoff(other, { dev: false }), "unavailable");
  });

test("rejects PayU orders pointing at an unknown host", () => {
    const bad = { ...payu, action: "https://evil.example/_payment" } as PaymentOrder;
    assert.equal(resolvePaymentHandoff(bad, { dev: false }), "unavailable");
  });

test("allows simulation only in local development", () => {
    assert.equal(resolvePaymentHandoff(other, { dev: true }), "simulated");
    assert.equal(simulatedCheckoutAllowed(false, true), false);
  });

