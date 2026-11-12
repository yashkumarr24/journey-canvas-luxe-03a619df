import { test } from "node:test";
import assert from "node:assert/strict";
import { submitPayuForm } from "./payu";
import type { PaymentOrder } from "@/types/booking";

test("website posts the exact server-returned action and signed fields unchanged", () => {
  const previous = globalThis.document;
  const nodes: Array<{ tag: string; method?: string; action?: string; style: Record<string, string>; children: unknown[]; name?: string; value?: string; appendChild: (n: unknown) => void; submit: () => void }> = [];
  let submitted = 0;
  const doc = {
    createElement: (tag: string) => {
      const node = { tag, style: {}, children: [] as unknown[], appendChild(n: unknown) { this.children.push(n); }, submit() { submitted++; } };
      nodes.push(node); return node;
    }, body: { appendChild: () => undefined },
  };
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  try {
    const fields = { hash: "mock-signature", txnid: "MOCKTXN", amount: "42.50" };
    const order = { provider: "payu", action: "https://secure.payu.in/_payment", fields } as unknown as PaymentOrder;
    assert.equal(submitPayuForm(order), true);
    const form = nodes.find(n => n.tag === "form");
    assert.equal(form?.method, "POST");
    assert.equal(form?.action, order.action);
    assert.equal(submitted, 1);
    assert.deepEqual(Object.fromEntries(nodes.filter(n => n.tag === "input").map(n => [n.name, n.value])), fields);
  } finally { Object.defineProperty(globalThis, "document", { value: previous, configurable: true }); }
});