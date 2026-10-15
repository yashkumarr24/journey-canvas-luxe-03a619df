import { describe, expect, it } from "vitest";
import { resolvePaymentHandoff, simulatedCheckoutAllowed } from "./payment-handoff";
import type { PaymentOrder } from "@/types/booking";

const payu = {
  provider: "payu",
  action: "https://test.payu.in/_payment",
  fields: { hash: "h", txnid: "T" },
} as unknown as PaymentOrder;
const other = { provider: "razorpay" } as unknown as PaymentOrder;

describe("payment handoff", () => {
  it("posts signed PayU orders to PayU", () => {
    expect(resolvePaymentHandoff(payu, { dev: false })).toBe("payu");
  });

  it("never falls back to a simulated sheet on a deployed site", () => {
    expect(resolvePaymentHandoff(other, { dev: false })).toBe("unavailable");
  });

  it("rejects PayU orders pointing at an unknown host", () => {
    const bad = { ...payu, action: "https://evil.example/_payment" } as PaymentOrder;
    expect(resolvePaymentHandoff(bad, { dev: false })).toBe("unavailable");
  });

  it("allows simulation only in local development", () => {
    expect(resolvePaymentHandoff(other, { dev: true })).toBe("simulated");
    expect(simulatedCheckoutAllowed(false, true)).toBe(false);
  });
});
