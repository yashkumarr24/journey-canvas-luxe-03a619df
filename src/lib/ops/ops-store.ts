/**
 * Local operations store (TEST MODE ONLY).
 *
 * It stands in for the FastAPI operations endpoints so the Phase 11 customer
 * and admin workflows can be walked end to end before the backend and provider
 * credentials exist. It is a stand-in for a server, not a second booking system:
 *
 *  - bookings are written here only when the existing mock checkout produced
 *    one, using the SAME `BookingSummary` / `HotelBookingSummary` the booking
 *    flow already returned,
 *  - amounts are copied from those server-shaped summaries and never computed,
 *  - no payment, cancellation or refund is ever executed — only requested,
 *  - it is bypassed entirely once `VITE_BOOKING_API_URL` is configured.
 *
 * Persistence is localStorage so admin and customer screens in the same browser
 * see the same records, the way they would through a shared database.
 */

import type {
  BookingProduct,
  BookingTimelineEvent,
  BookingTimelineType,
  CancellationRequest,
  InternalNote,
  NotificationEvent,
  PaymentStatus,
  SupportRequest,
} from "@/types/operations";
import type { BookingStatus, BookingSummary, HotelBookingSummary, Money } from "@/types/booking";

const STORE_KEY = "ffh.ops.store.v1";
const CHANNEL = "ffh-ops";

export interface StoredBooking {
  bookingReference: string;
  product: BookingProduct;
  /** Supabase user id when the booking was made while signed in, else null. */
  ownerUserId: string | null;
  contactEmail: string;
  contactPhone?: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  bookedAt: string;
  travelDate?: string | null;
  destination: string;
  summary: string;
  totalAmount: Money;
  flight?: BookingSummary;
  hotel?: HotelBookingSummary;
  timeline: BookingTimelineEvent[];
  cancellation?: CancellationRequest;
  isTestMode: boolean;
  /** Marks rows created by the admin sample-data control. */
  synthetic?: boolean;
}

export interface OpsStore {
  bookings: Record<string, StoredBooking>;
  support: SupportRequest[];
  /** Support request id -> requester identity (admin view only). */
  supportOwners: Record<string, { userId: string | null; contactEmail: string }>;
  notes: InternalNote[];
  notifications: NotificationEvent[];
}

const EMPTY: OpsStore = {
  bookings: {},
  support: [],
  supportOwners: {},
  notes: [],
  notifications: [],
};

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readOpsStore(): OpsStore {
  const raw = storage()?.getItem(STORE_KEY);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<OpsStore>;
    return {
      bookings: parsed.bookings ?? {},
      support: parsed.support ?? [],
      supportOwners: parsed.supportOwners ?? {},
      notes: parsed.notes ?? [],
      notifications: parsed.notifications ?? [],
    };
  } catch {
    return EMPTY;
  }
}

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function broadcast(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* a bad subscriber must not break the workflow */
    }
  });
  try {
    channel ??= typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    channel?.postMessage("changed");
  } catch {
    /* ignore */
  }
}

export function writeOpsStore(next: OpsStore): void {
  try {
    // Bound growth so a long test session cannot fill storage.
    const trimmed: OpsStore = {
      ...next,
      support: next.support.slice(-200),
      notes: next.notes.slice(-500),
      notifications: next.notifications.slice(-300),
    };
    storage()?.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    /* Non-fatal: the current page view still works. */
  }
  broadcast();
}

export function updateOpsStore(mutate: (store: OpsStore) => OpsStore): OpsStore {
  const next = mutate(readOpsStore());
  writeOpsStore(next);
  return next;
}

/** Subscribe to any change, including changes made in another tab. */
export function subscribeOpsStore(listener: () => void): () => void {
  listeners.add(listener);
  let bc: BroadcastChannel | null = null;
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORE_KEY) listener();
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = () => listener();
    }
    window.addEventListener("storage", onStorage);
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(listener);
    try {
      bc?.close();
      window.removeEventListener("storage", onStorage);
    } catch {
      /* ignore */
    }
  };
}

export function resetOpsStore(): void {
  writeOpsStore(EMPTY);
}

/* ------------------------------------------------------------------ */
/* Helpers shared by the mock adapter                                  */
/* ------------------------------------------------------------------ */

export function opsId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

const TIMELINE_LABELS: Record<BookingTimelineType, string> = {
  booking_created: "Booking created",
  review_completed: "Review completed",
  checkout_started: "Checkout started",
  payment_started: "Payment started",
  payment_confirmed: "Payment confirmed",
  payment_failed: "Payment failed",
  booking_confirmed: "Booking confirmed",
  provider_booking_failed: "Provider booking failed",
  document_generated: "Ticket / voucher generated",
  cancellation_requested: "Cancellation requested",
  cancellation_updated: "Cancellation status updated",
  refund_required: "Refund required",
  refund_updated: "Refund status updated",
  support_request_created: "Support request created",
  note_added: "Internal note added",
};

export function timelineLabel(type: BookingTimelineType): string {
  return TIMELINE_LABELS[type];
}

export function timelineEvent(
  type: BookingTimelineType,
  options: { at?: string; actor?: BookingTimelineEvent["actor"]; detail?: string } = {},
): BookingTimelineEvent {
  return {
    id: opsId("evt"),
    type,
    label: TIMELINE_LABELS[type],
    at: options.at ?? new Date().toISOString(),
    actor: options.actor ?? "system",
    detail: options.detail,
  };
}
