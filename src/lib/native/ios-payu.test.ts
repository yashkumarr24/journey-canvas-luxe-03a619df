import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginIosPayment,
  clearIosPaymentRecoveryForStatus,
  IOS_PAYU_STATUS_DELAYS_MS,
  isIosPayment,
  iosPaymentAvailable,
  isValidIosPaymentReference,
  rememberIosPayment,
  runIosPaymentStatusChecks,
  takeIosPaymentRecovery,
  validateIosHandoffUrl,
} from "./ios-payu";
import type { BookingStatus } from "@/types/booking";

class Store {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(n: number) {
    return [...this.values.keys()][n] ?? null;
  }
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, v);
  }
  removeItem(k: string) {
    this.values.delete(k);
  }
  clear() {
    this.values.clear();
  }
}

test("iOS handoff defaults OFF and Android/web are not iOS", () => {
  assert.equal(iosPaymentAvailable(), false);
  assert.equal(isIosPayment(), false);
  assert.equal(isIosPayment({ isNativePlatform: () => true, getPlatform: () => "android" }), false);
  assert.equal(isIosPayment({ isNativePlatform: () => true, getPlatform: () => "ios" }), true);
});

test("existing and planned Hotel references recover status without private data", () => {
  for (const ref of ["FNFHABC123", "FF-AB12CD34"]) {
    const store = new Store();
    rememberIosPayment(ref, store, 1000);
    assert.deepEqual(JSON.parse(store.getItem("fnf.iosPaymentRecovery") ?? "{}"), {
      ref,
      expiresAt: 1000 + 48 * 60 * 60 * 1000,
    });
    assert.equal(takeIosPaymentRecovery(store, 1001), `/hotels/confirmation?ref=${ref}`);
    assert.equal(takeIosPaymentRecovery(store, 1002), `/hotels/confirmation?ref=${ref}`);
  }
});

test("malformed references and personal or access data are rejected", () => {
  for (const ref of [
    "FNFHabc123",
    "FNFHABC12",
    "FNFHABC1234",
    "FF-AB12CD3",
    "FF-AB12CD345",
    "FF_AB12CD34",
    "guest@example.test",
    "FNFHABC123?access=secret",
    " FNFHABC123",
    "",
  ]) {
    assert.equal(isValidIosPaymentReference(ref), false);
    assert.throws(() => rememberIosPayment(ref, new Store()));
  }
});

test("expired recovery never restarts payment", () => {
  const store = new Store();
  rememberIosPayment("FNFHABC123", store, 1000);
  assert.equal(takeIosPaymentRecovery(store, 1000 + 48 * 60 * 60 * 1000), null);
  assert.equal(store.length, 0);
});

test("handoff only accepts own HTTPS site and fragment-only capability", () => {
  const token = "a".repeat(43);
  const url = `https://staging.example.test/api/public/payu-handoff#token=${token}`;
  assert.equal(validateIosHandoffUrl(url, "https://staging.example.test"), url);
  for (const bad of [
    url.replace("staging.example.test", "evil.test"),
    url.replace("#token", "?token"),
    url.replace("https:", "http:"),
  ]) {
    assert.throws(() => validateIosHandoffUrl(bad, "https://staging.example.test"));
  }
});

test("disabled iOS controller never requests an order or opens Safari", async () => {
  let requests = 0,
    opens = 0;
  const store = new Store();
  await assert.rejects(
    beginIosPayment({
      enabled: false,
      ref: "FNFHABC123",
      store,
      request: async () => {
        requests++;
        throw new Error("must not run");
      },
      open: async () => {
        opens++;
      },
    }),
  );
  assert.equal(requests, 0);
  assert.equal(opens, 0);
  assert.equal(store.length, 0);
});

test("failed token request retains recovery and never retries or falls back", async () => {
  let requests = 0,
    opens = 0;
  const store = new Store();
  await assert.rejects(
    beginIosPayment({
      enabled: true,
      ref: "FNFHABC123",
      store,
      request: async () => {
        requests++;
        throw new Error("expired or refused");
      },
      open: async () => {
        opens++;
      },
    }),
  );
  assert.equal(requests, 1);
  assert.equal(opens, 0);
  assert.equal(takeIosPaymentRecovery(store), "/hotels/confirmation?ref=FNFHABC123");
  assert.equal(requests, 1);
});

test("a mismatched backend reference is never stored or opened", async () => {
  let opens = 0;
  const store = new Store();
  await assert.rejects(
    beginIosPayment({
      enabled: true,
      ref: "FF-AB12CD34",
      store,
      request: async () => ({ bookingReference: "FNFHABC123", handoffUrl: "mock" }),
      open: async () => {
        opens++;
      },
    }),
  );
  assert.equal(opens, 0);
  assert.equal(takeIosPaymentRecovery(store), "/hotels/confirmation?ref=FF-AB12CD34");
  assert.notEqual(store.getItem("fnf.iosPaymentRecovery")?.includes("FNFHABC123"), true);
});

test("Safari open failure cannot retry the payment and reopening is status-only", async () => {
  let requests = 0,
    opens = 0;
  const store = new Store();
  await assert.rejects(
    beginIosPayment({
      enabled: true,
      ref: "FNFHABC123",
      store,
      request: async () => {
        requests++;
        return { bookingReference: "FNFHABC123", handoffUrl: "mock" };
      },
      open: async () => {
        opens++;
        throw new Error("Safari unavailable");
      },
    }),
  );
  assert.equal(requests, 1);
  assert.equal(opens, 1);
  for (let i = 0; i < 3; i++)
    assert.equal(takeIosPaymentRecovery(store), "/hotels/confirmation?ref=FNFHABC123");
  assert.equal(requests, 1);
  assert.equal(opens, 1);
});

test("only authoritative terminal backend states clear recovery", () => {
  for (const status of [
    "confirmed",
    "payment_failed",
    "failed",
    "cancelled",
    "expired",
    "on_hold",
  ] as const) {
    const store = new Store();
    rememberIosPayment("FF-AB12CD34", store);
    assert.equal(clearIosPaymentRecoveryForStatus(status, store), true);
    assert.equal(store.length, 0);
  }
  for (const status of [
    "awaiting_payment",
    "payment_processing",
    "booking_processing",
    "confirming",
    "cancellation_pending",
    undefined,
  ] as const) {
    const store = new Store();
    rememberIosPayment("FF-AB12CD34", store);
    assert.equal(clearIosPaymentRecoveryForStatus(status, store), false);
    assert.equal(takeIosPaymentRecovery(store), "/hotels/confirmation?ref=FF-AB12CD34");
  }
});

test("iOS checks use bounded progressive delays without creating payment", async () => {
  const waits: number[] = [];
  let checks = 0;
  const result = await runIosPaymentStatusChecks({
    wait: async (delay) => {
      waits.push(delay);
    },
    check: async () => {
      checks++;
      return "awaiting_payment";
    },
  });
  assert.equal(result, "exhausted");
  assert.equal(checks, IOS_PAYU_STATUS_DELAYS_MS.length);
  assert.deepEqual(waits, [...IOS_PAYU_STATUS_DELAYS_MS]);
  for (let i = 1; i < waits.length; i++) assert.ok((waits[i] ?? 0) > (waits[i - 1] ?? 0));
});

test("confirmed, failed and cancelled answers stop further checks", async () => {
  for (const finalStatus of ["confirmed", "failed", "cancelled"] as const) {
    const statuses: BookingStatus[] = ["payment_processing", finalStatus];
    let checks = 0;
    const result = await runIosPaymentStatusChecks({
      wait: async () => {},
      check: async () => statuses[checks++],
    });
    assert.equal(result, "stopped");
    assert.equal(checks, 2);
  }
});

test("captured payment with hotel fulfilment pending stays pending, not confirmed", async () => {
  let checks = 0;
  const result = await runIosPaymentStatusChecks({
    wait: async () => {},
    check: async () => {
      checks++;
      return checks === 1
        ? "payment_processing"
        : checks === 2
          ? "booking_processing"
          : "confirmed";
    },
  });
  assert.equal(result, "stopped");
  assert.equal(checks, 3);
});

test("network failure or timeout without booking data stops safely and retains recovery", async () => {
  let checks = 0;
  const result = await runIosPaymentStatusChecks({
    wait: async () => {},
    check: async () => {
      checks++;
      return undefined;
    },
  });
  assert.equal(result, "stopped");
  assert.equal(checks, 1);
  await assert.rejects(
    runIosPaymentStatusChecks({
      wait: async () => {},
      check: async () => {
        throw new Error("status read timed out");
      },
    }),
    /timed out/,
  );
  const store = new Store();
  rememberIosPayment("FNFHABC123", store);
  assert.equal(clearIosPaymentRecoveryForStatus(undefined, store), false);
  assert.equal(takeIosPaymentRecovery(store), "/hotels/confirmation?ref=FNFHABC123");
});
