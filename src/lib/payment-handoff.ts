/**
 * Decides what happens after the backend returns a payment order.
 *
 * - A valid, server-signed PayU order -> auto-post to PayU's hosted page.
 * - Local development only -> the simulated test sheet (never on a deployed
 *   site, and the backend never books anything from a simulated payment).
 * - Anything else -> "Payments temporarily unavailable." No fallback provider.
 */

import { canSubmitPayu } from "@/lib/payu";
import type { PaymentOrder } from "@/types/booking";

export const PAYMENTS_UNAVAILABLE_MESSAGE = "Payments temporarily unavailable.";

export type PaymentHandoff = "payu" | "simulated" | "unavailable";

export function resolvePaymentHandoff(order: PaymentOrder, opts: { dev: boolean }): PaymentHandoff {
  if (canSubmitPayu(order)) return "payu";
  if (opts.dev) return "simulated";
  return "unavailable";
}

/** Simulated checkout is a local-development aid only. */
export function simulatedCheckoutAllowed(dev: boolean, requested: boolean): boolean {
  return dev && requested;
}
