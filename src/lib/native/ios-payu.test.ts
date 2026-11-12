import { test } from "node:test";
import assert from "node:assert/strict";
import { beginIosPayment, isIosPayment, iosPaymentAvailable, rememberIosPayment, takeIosPaymentRecovery, validateIosHandoffUrl } from "./ios-payu";

class Store {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(n: number) { return [...this.values.keys()][n] ?? null; }
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
  removeItem(k: string) { this.values.delete(k); }
  clear() { this.values.clear(); }
}

test("iOS handoff defaults OFF and Android/web are not iOS", () => {
  assert.equal(iosPaymentAvailable(), false);
  assert.equal(isIosPayment(), false);
  assert.equal(isIosPayment({ isNativePlatform: () => true, getPlatform: () => "android" }), false);
  assert.equal(isIosPayment({ isNativePlatform: () => true, getPlatform: () => "ios" }), true);
});

test("Safari dismissal or app reopening only recovers reference to backend status", () => {
  const store = new Store();
  rememberIosPayment("FNFHABC123", store, 1000);
  assert.deepEqual(JSON.parse(store.getItem("fnf.iosPaymentRecovery") ?? "{}"), { ref: "FNFHABC123", expiresAt: 1000 + 48 * 60 * 60 * 1000 });
  assert.equal(takeIosPaymentRecovery(store, 1001), "/hotels/confirmation?ref=FNFHABC123");
  assert.equal(takeIosPaymentRecovery(store, 1002), "/hotels/confirmation?ref=FNFHABC123");
});

test("expired recovery never restarts payment", () => {
  const store = new Store(); rememberIosPayment("FNFHABC123", store, 1000);
  assert.equal(takeIosPaymentRecovery(store, 1000 + 48 * 60 * 60 * 1000), null);
  assert.equal(store.length, 0);
});

test("handoff only accepts own HTTPS site and fragment-only capability", () => {
  const token = "a".repeat(43);
  const url = `https://staging.example.test/api/public/payu-handoff#token=${token}`;
  assert.equal(validateIosHandoffUrl(url, "https://staging.example.test"), url);
  for (const bad of [url.replace("staging.example.test", "evil.test"), url.replace("#token", "?token"), url.replace("https:", "http:")]) {
    assert.throws(() => validateIosHandoffUrl(bad, "https://staging.example.test"));
  }
});

test("disabled iOS controller never requests an order or opens Safari", async () => {
  let requests = 0, opens = 0;
  const store = new Store();
  await assert.rejects(beginIosPayment({ enabled: false, ref: "FNFHABC123", store,
    request: async () => { requests++; throw new Error("must not run"); },
    open: async () => { opens++; },
  }));
  assert.equal(requests, 0); assert.equal(opens, 0); assert.equal(store.length, 0);
});

test("failed token request retains recovery and never retries or falls back", async () => {
  let requests = 0, opens = 0;
  const store = new Store();
  await assert.rejects(beginIosPayment({ enabled: true, ref: "FNFHABC123", store,
    request: async () => { requests++; throw new Error("expired or refused"); },
    open: async () => { opens++; },
  }));
  assert.equal(requests, 1); assert.equal(opens, 0);
  assert.equal(takeIosPaymentRecovery(store), "/hotels/confirmation?ref=FNFHABC123");
  assert.equal(requests, 1);
});

test("Safari open failure cannot retry the payment and reopening is status-only", async () => {
  let requests = 0, opens = 0;
  const store = new Store();
  await assert.rejects(beginIosPayment({ enabled: true, ref: "FNFHABC123", store,
    request: async () => { requests++; return { bookingReference: "FNFHABC123", handoffUrl: "mock" }; },
    open: async () => { opens++; throw new Error("Safari unavailable"); },
  }));
  assert.equal(requests, 1); assert.equal(opens, 1);
  for (let i = 0; i < 3; i++) assert.equal(takeIosPaymentRecovery(store), "/hotels/confirmation?ref=FNFHABC123");
  assert.equal(requests, 1); assert.equal(opens, 1);
});