import type { BookingStatus } from "@/types/booking";

/**
 * Status-accurate copy for the hotel confirmation page.
 *
 * The backend booking status is the only source of truth: "confirmed" wording
 * is produced for the `confirmed` status alone, and "on hold" wording for
 * `on_hold` alone. Unpaid, failed, cancelled and in-progress statuses must
 * never imply the room is booked.
 */

export interface ConfirmationHeaderCopy {
  /** Plain part of the page title. */
  title: string;
  /** Italic accent part of the page title. */
  accent: string;
  subtitle: string;
}

export const NEUTRAL_CONFIRMATION_HEADER: ConfirmationHeaderCopy = {
  title: "Your hotel",
  accent: "booking.",
  subtitle: "Your booking details and status are shown below.",
};

export function confirmationHeaderCopy(status: BookingStatus): ConfirmationHeaderCopy {
  switch (status) {
    case "confirmed":
      return {
        title: "Your stay,",
        accent: "confirmed.",
        subtitle: "Keep your booking reference handy — it's all the hotel needs at check-in.",
      };
    case "on_hold":
      return {
        title: "Your room,",
        accent: "on hold.",
        subtitle: "The hotel is holding this room until the deadline shown below.",
      };
    case "payment_processing":
    case "booking_processing":
    case "confirming":
      return {
        title: "Confirming",
        accent: "your stay.",
        subtitle: "We're finishing this booking — this page updates on its own.",
      };
    case "awaiting_payment":
      return {
        title: "Payment",
        accent: "pending.",
        subtitle: "Complete payment to secure your stay — nothing is final until payment completes.",
      };
    case "payment_failed":
      return {
        title: "Payment",
        accent: "didn't go through.",
        subtitle: "No payment was taken. You can try the payment again.",
      };
    case "cancellation_pending":
      return {
        title: "Cancelling",
        accent: "your booking.",
        subtitle: "The hotel is processing the cancellation.",
      };
    case "cancelled":
      return {
        title: "Booking",
        accent: "cancelled.",
        subtitle: "This booking is no longer active.",
      };
    case "failed":
    case "expired":
      return {
        title: "Booking",
        accent: "not completed.",
        subtitle: "The hotel could not confirm this room.",
      };
    default:
      return NEUTRAL_CONFIRMATION_HEADER;
  }
}

export interface UnpaidBookingCopy {
  title: string;
  body: string;
}

/**
 * Copy for unpaid states. Deliberately avoids any "held" wording: a room is
 * only held for a real `on_hold` status, never for `awaiting_payment` or
 * `payment_failed`.
 */
export function unpaidBookingCopy(status: BookingStatus): UnpaidBookingCopy | null {
  switch (status) {
    case "awaiting_payment":
      return {
        title: "This booking isn't paid yet",
        body: "Payment hasn't been completed, so the room is not booked yet. Complete payment to confirm your stay.",
      };
    case "payment_failed":
      return {
        title: "Your payment didn't go through",
        body: "No payment was completed and the room is not booked. You can try the payment again.",
      };
    default:
      return null;
  }
}
