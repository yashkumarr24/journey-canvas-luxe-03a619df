/**
 * Status pills for the operations screens.
 *
 * Wording is deliberately careful: a refund state describes a WORKFLOW step
 * ("refund pending"), never a completed money movement, because no payment
 * provider is connected yet.
 */

import type {
  CancellationStatus,
  PaymentStatus,
  RefundStatus,
  SupportStatus,
} from "@/types/operations";
import type { BookingStatus } from "@/types/booking";

type Tone = "neutral" | "positive" | "warning" | "negative" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-foreground/15 bg-foreground/5 text-foreground/70",
  positive: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-700",
  negative: "border-red-600/30 bg-red-600/10 text-red-700",
  info: "border-sky-600/30 bg-sky-600/10 text-sky-700",
};

function Pill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium tracking-wide ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

const BOOKING: Record<BookingStatus, { label: string; tone: Tone }> = {
  awaiting_payment: { label: "Awaiting payment", tone: "warning" },
  payment_processing: { label: "Payment processing", tone: "info" },
  payment_failed: { label: "Payment failed", tone: "negative" },
  booking_processing: { label: "Confirming with provider", tone: "info" },
  confirmed: { label: "Confirmed", tone: "positive" },
  failed: { label: "Booking failed", tone: "negative" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

const PAYMENT: Record<PaymentStatus, { label: string; tone: Tone }> = {
  not_started: { label: "Not paid", tone: "neutral" },
  pending: { label: "Payment pending", tone: "warning" },
  paid: { label: "Paid", tone: "positive" },
  failed: { label: "Payment failed", tone: "negative" },
  refund_pending: { label: "Refund pending", tone: "warning" },
  refunded: { label: "Refund completed", tone: "positive" },
};

const CANCELLATION: Record<CancellationStatus, { label: string; tone: Tone }> = {
  none: { label: "—", tone: "neutral" },
  requested: { label: "Cancellation requested", tone: "warning" },
  pending: { label: "Cancellation pending", tone: "warning" },
  approved: { label: "Cancellation approved", tone: "positive" },
  rejected: { label: "Cancellation rejected", tone: "negative" },
};

const REFUND: Record<RefundStatus, { label: string; tone: Tone }> = {
  none: { label: "No refund", tone: "neutral" },
  not_applicable: { label: "Refund not applicable", tone: "neutral" },
  pending: { label: "Refund pending", tone: "warning" },
  completed: { label: "Refund completed", tone: "positive" },
};

const SUPPORT: Record<SupportStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  waiting_customer: { label: "Waiting for customer", tone: "warning" },
  resolved: { label: "Resolved", tone: "positive" },
  closed: { label: "Closed", tone: "neutral" },
};

export const bookingStatusLabel = (status: BookingStatus) => BOOKING[status].label;
export const supportStatusLabel = (status: SupportStatus) => SUPPORT[status].label;

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Pill {...BOOKING[status]} />;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Pill {...PAYMENT[status]} />;
}

export function CancellationBadge({ status }: { status: CancellationStatus }) {
  if (status === "none") return null;
  return <Pill {...CANCELLATION[status]} />;
}

export function RefundBadge({ status }: { status: RefundStatus }) {
  if (status === "none") return null;
  return <Pill {...REFUND[status]} />;
}

export function SupportStatusBadge({ status }: { status: SupportStatus }) {
  return <Pill {...SUPPORT[status]} />;
}

export function TestModePill() {
  return <Pill label="Test record" tone="info" />;
}
