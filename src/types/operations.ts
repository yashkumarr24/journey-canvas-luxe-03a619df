/**
 * Phase 11 — booking operations, support and notification contracts.
 *
 * These types describe what the CUSTOMER and ADMIN operations screens render.
 * They deliberately reuse the Phase 7–9 booking models (`BookingSummary`,
 * `HotelBookingSummary`) instead of copying itinerary/room data into a second
 * shape, so there is exactly one source of truth per booking.
 *
 * Rules that hold everywhere in this file:
 *  - no provider credential, payment secret or raw provider payload appears here,
 *  - amounts are always the server-resolved `Money` values from the booking,
 *  - a cancellation or refund state is a REQUEST/WORKFLOW state. It never claims
 *    that money moved: no payment provider is connected yet.
 */

import type { BookingStatus, BookingSummary, HotelBookingSummary, Money } from "@/types/booking";

export type BookingProduct = "flight" | "hotel";

/** Where the money stands. `not_started` = draft that was never paid. */
export type PaymentStatus =
  | "not_started"
  | "pending"
  | "paid"
  | "failed"
  | "refund_pending"
  | "refunded";

/** Customer-initiated cancellation workflow (mock until providers connect). */
export type CancellationStatus = "none" | "requested" | "pending" | "approved" | "rejected";

/** Refund workflow. `not_applicable` = nothing was ever captured. */
export type RefundStatus = "none" | "not_applicable" | "pending" | "completed";

export type BookingBucket =
  | "all"
  | "upcoming"
  | "completed"
  | "cancelled"
  | "failed"
  | "pending";

export interface BookingListItem {
  bookingReference: string;
  product: BookingProduct;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  /** When the booking record was created. */
  bookedAt: string;
  /** Departure date (flight) or check-in date (hotel), when known. */
  travelDate?: string | null;
  destination: string;
  /** One-line human summary, e.g. "AMD → GOI · IndiGo 6E 2134". */
  summary: string;
  totalAmount: Money;
  cancellationStatus: CancellationStatus;
  refundStatus: RefundStatus;
  /** True when the record came from the local test adapter, not the backend. */
  isTestMode?: boolean;
}

/** Admin list rows carry the minimum operational identity, nothing more. */
export interface AdminBookingListItem extends BookingListItem {
  contactEmail: string;
  customerType: "account" | "guest";
  openSupportRequests: number;
  internalNoteCount: number;
}

export type BookingTimelineType =
  | "booking_created"
  | "review_completed"
  | "checkout_started"
  | "payment_started"
  | "payment_confirmed"
  | "payment_failed"
  | "booking_confirmed"
  | "provider_booking_failed"
  | "document_generated"
  | "cancellation_requested"
  | "cancellation_updated"
  | "refund_required"
  | "refund_updated"
  | "support_request_created"
  | "note_added";

export interface BookingTimelineEvent {
  id: string;
  type: BookingTimelineType;
  label: string;
  at: string;
  actor: "customer" | "system" | "admin";
  /** Safe detail line. Never a secret, card number, OTP or provider payload. */
  detail?: string;
}

export type DocumentKind = "eticket" | "voucher" | "invoice";

export interface BookingDocument {
  kind: DocumentKind;
  label: string;
  /** Absolute URL issued by the backend; null means "not available yet". */
  url: string | null;
  status: "available" | "pending" | "not_applicable";
  note?: string;
}

export type CancellationReason =
  | "change_of_plan"
  | "date_change"
  | "booked_by_mistake"
  | "found_better_option"
  | "medical"
  | "other";

export interface CancellationRequest {
  id: string;
  bookingReference: string;
  reason: CancellationReason;
  comment?: string;
  status: CancellationStatus;
  refundStatus: RefundStatus;
  createdAt: string;
  updatedAt: string;
  /** Display name of the admin who last changed the state. */
  decidedBy?: string;
  decisionNote?: string;
}

export interface CancellationRequestInput {
  bookingReference: string;
  reason: CancellationReason;
  comment?: string;
}

export type SupportCategory =
  | "flight_booking"
  | "hotel_booking"
  | "payment"
  | "cancellation"
  | "refund"
  | "documents"
  | "general";

export type SupportStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";

export interface SupportMessage {
  id: string;
  author: "customer" | "agent";
  authorName?: string;
  body: string;
  createdAt: string;
  /** Internal replies are admin-only and are never sent to a customer view. */
  internal?: boolean;
}

export interface SupportRequest {
  id: string;
  reference: string;
  bookingReference?: string | null;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
  messages: SupportMessage[];
}

/** Admin view adds the operational identity of the requester. */
export interface AdminSupportRequest extends SupportRequest {
  contactEmail: string;
  customerType: "account" | "guest";
}

export interface SupportRequestInput {
  bookingReference?: string | null;
  category: SupportCategory;
  subject: string;
  message: string;
  /** Only used for guest requests; signed-in requests use the session. */
  contactEmail?: string;
}

export interface InternalNote {
  id: string;
  bookingReference: string;
  body: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

export type NotificationType =
  | "booking_created"
  | "booking_pending"
  | "booking_confirmed"
  | "booking_failed"
  | "booking_cancelled"
  | "booking_update"
  | "payment_successful"
  | "payment_failed"
  | "payment_refunded"
  | "cancellation_requested"
  | "cancellation_status_changed"
  | "refund_status_changed"
  | "documents_available"
  | "support_request_created"
  | "support_request_replied"
  | "support_request_updated";

/**
 * A notification is an EVENT record first. PHASE 13 adds a delivery layer on
 * top (see `src/types/notifications.ts`): `channels` lists where the event would
 * be dispatched, and the demo providers record delivery states against it. No
 * real Email/SMS/WhatsApp provider is connected, so `dispatched` only becomes
 * true once every attempted channel reported a demo success.
 */
export interface NotificationEvent {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  bookingReference?: string | null;
  supportRequestId?: string | null;
  audience: "customer" | "admin";
  channels: Array<"in_app" | "email" | "sms" | "whatsapp" | "push">;
  dispatched: boolean;
}

/** Full customer-facing booking record. */
export interface BookingDetail extends BookingListItem {
  contact: { email: string; phone?: string };
  /** Present for flight bookings — the Phase 8 summary, unchanged. */
  flight?: BookingSummary;
  /** Present for hotel bookings — the Phase 9 summary, unchanged. */
  hotel?: HotelBookingSummary;
  timeline: BookingTimelineEvent[];
  documents: BookingDocument[];
  cancellation?: CancellationRequest;
  supportRequests: SupportRequest[];
}

/** Admin booking record: adds operational identity, notes and support cases. */
export interface AdminBookingDetail extends BookingDetail {
  contactEmail: string;
  customerType: "account" | "guest";
  /** Placeholders until the provider integration fills them in. */
  providerReferences: { label: string; value: string | null }[];
  notes: InternalNote[];
}

export interface BookingListQuery {
  bucket?: BookingBucket;
  product?: BookingProduct | "all";
  search?: string;
  sort?: "newest" | "oldest" | "travel_date";
  status?: BookingStatus | "all";
  paymentStatus?: PaymentStatus | "all";
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export interface GuestBookingLookupInput {
  bookingReference: string;
  /** Contact email captured at booking time — verified before anything returns. */
  contactEmail: string;
}
