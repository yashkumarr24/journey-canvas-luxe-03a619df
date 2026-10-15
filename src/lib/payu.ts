/**
 * PayU Hosted Checkout hand-off.
 *
 * The backend returns the PayU form action and fully signed fields. The
 * browser only auto-posts them — it never computes a hash, never sees the
 * merchant salt and never decides whether a payment succeeded. PayU returns
 * to the backend, which verifies server-to-server and redirects to the
 * confirmation page.
 */

import type { PaymentOrder } from "@/types/booking";

const ALLOWED_ACTIONS = new Set(["https://test.payu.in/_payment", "https://secure.payu.in/_payment"]);

export function canSubmitPayu(order: PaymentOrder): boolean {
  return (
    order.provider === "payu" &&
    typeof order.action === "string" &&
    ALLOWED_ACTIONS.has(order.action) &&
    !!order.fields &&
    typeof order.fields.hash === "string"
  );
}

/** Returns false (no navigation) when the order is not a valid PayU hand-off. */
export function submitPayuForm(order: PaymentOrder): boolean {
  if (typeof document === "undefined" || !canSubmitPayu(order)) return false;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = order.action as string;
  form.style.display = "none";
  for (const [name, value] of Object.entries(order.fields ?? {})) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  return true;
}
