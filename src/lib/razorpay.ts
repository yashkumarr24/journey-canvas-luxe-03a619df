/**
 * Razorpay Checkout integration structure.
 *
 * The browser only ever sees a PUBLISHABLE key id and an order id, both handed
 * to it by our own FastAPI backend at the moment of checkout. No key secret,
 * no signature computation and no verification happens here: the handler
 * response is forwarded to the backend, which verifies the signature
 * server-side before a booking is confirmed.
 */

import type { PaymentOrder } from "@/types/booking";

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayHandlerResponse {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

function razorpayGlobal(): RazorpayConstructor | undefined {
  return (globalThis as { Razorpay?: RazorpayConstructor }).Razorpay;
}

/** Loads the Checkout script once. Resolves false when it cannot be loaded. */
export function loadRazorpayScript(): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  if (razorpayGlobal()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(Boolean(razorpayGlobal())), { once: true });
    script.addEventListener("error", () => resolve(false), { once: true });
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

export interface RazorpayCallbacks {
  /** Provider acknowledged the payment; the backend still has to verify it. */
  onAuthorised: (result: { paymentId: string; orderId: string; signature?: string }) => void;
  /** Provider reported a failure (declined card, expired UPI mandate, …). */
  onFailed: (message?: string) => void;
  /** Customer closed the sheet without paying. */
  onDismissed: () => void;
}

/**
 * Opens the Razorpay sheet for a server-created order.
 * Returns false when the script or the key id is unavailable, so the caller can
 * fall back to the test adapter.
 */
export async function openRazorpayCheckout(
  order: PaymentOrder,
  callbacks: RazorpayCallbacks,
): Promise<boolean> {
  if (order.provider !== "razorpay" || !order.keyId) return false;
  const ready = await loadRazorpayScript();
  const Razorpay = razorpayGlobal();
  if (!ready || !Razorpay) return false;

  let settled = false;
  const instance = new Razorpay({
    key: order.keyId,
    order_id: order.orderId,
    // Razorpay quotes in the smallest currency unit.
    amount: Math.round(order.amount.amount * 100),
    currency: order.amount.currency,
    name: "Fly n Feel Holidays",
    description: `Flight booking ${order.bookingReference}`,
    prefill: {
      name: order.prefill?.name ?? "",
      email: order.prefill?.email ?? "",
      contact: order.prefill?.phone ?? "",
    },
    notes: { bookingReference: order.bookingReference },
    theme: { color: "#d62828" },
    handler: (response: RazorpayHandlerResponse) => {
      settled = true;
      callbacks.onAuthorised({
        paymentId: response.razorpay_payment_id ?? "",
        orderId: response.razorpay_order_id ?? order.orderId,
        signature: response.razorpay_signature,
      });
    },
    modal: {
      ondismiss: () => {
        if (!settled) callbacks.onDismissed();
      },
    },
  });

  instance.on("payment.failed", (payload: unknown) => {
    settled = true;
    const description = (payload as { error?: { description?: string } } | undefined)?.error?.description;
    callbacks.onFailed(description);
  });

  instance.open();
  return true;
}
