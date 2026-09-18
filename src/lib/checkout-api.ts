/**
 * Checkout API boundary.
 *
 * Every checkout screen calls THIS module, never `fetch` and never a provider
 * SDK for anything except opening the payment sheet. It forwards to
 * `booking-api.ts` (FastAPI) whenever a backend URL is configured, and falls
 * back to the local test adapter only while those endpoints do not exist.
 *
 * Replacing the mock later means deleting the `useTestCheckout` branch — the
 * call signatures already match the intended FastAPI contract.
 */

import { BookingApiError, bookingApi, isBookingApiConfigured, toBookingError } from "@/lib/booking-api";
import { testCheckoutAdapter } from "@/lib/checkout-mock";
import type {
  BookingSummary,
  PaymentConfirmRequest,
  PaymentFailureRequest,
  PaymentOrder,
  PaymentOrderRequest,
  PaymentResult,
} from "@/types/booking";

/** True while the payment endpoints are simulated locally. */
export const useTestCheckout =
  !isBookingApiConfigured || import.meta.env.VITE_BOOKING_TEST_CHECKOUT === "true";

/** Normalises adapter failures into the same error shape the API client uses. */
function asBookingError(error: unknown): BookingApiError {
  if (error instanceof Error && error.message === "BOOKING_NOT_FOUND") {
    return new BookingApiError({
      kind: "not_found",
      code: "BOOKING_NOT_FOUND",
      message:
        "We couldn't find this booking in your current session. Please start a new search to pick your flight again.",
    });
  }
  return toBookingError(error);
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw asBookingError(error);
  }
}

export const checkoutApi = {
  getBooking(bookingReference: string, guestToken?: string | null, signal?: AbortSignal) {
    return guard<BookingSummary>(() =>
      useTestCheckout
        ? testCheckoutAdapter.getBooking(bookingReference)
        : bookingApi.getBooking(bookingReference, guestToken, { signal }),
    );
  },

  createOrder(payload: PaymentOrderRequest) {
    return guard<PaymentOrder>(() =>
      useTestCheckout ? testCheckoutAdapter.createOrder(payload) : bookingApi.createPaymentOrder(payload),
    );
  },

  confirmPayment(payload: PaymentConfirmRequest) {
    return guard<PaymentResult>(() =>
      useTestCheckout ? testCheckoutAdapter.confirm(payload) : bookingApi.confirmPayment(payload),
    );
  },

  reportFailure(payload: PaymentFailureRequest) {
    return guard<BookingSummary>(() =>
      useTestCheckout ? testCheckoutAdapter.reportFailure(payload) : bookingApi.reportPaymentFailure(payload),
    );
  },
};
