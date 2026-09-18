/**
 * Mock operations provider (PHASE 11) — TEST MODE ONLY.
 *
 * Implements the same contracts the FastAPI operations endpoints will serve, on
 * top of the local ops store. Nothing here talks to TripJack, Razorpay or a
 * payment gateway, and nothing here executes a cancellation or a refund: those
 * are recorded as REQUESTS with a workflow status.
 *
 * Security rules mirrored from the real design:
 *  - a customer read is always filtered by the caller's user id,
 *  - a guest read requires booking reference AND the contact email stored with
 *    the booking, and returns a reduced record,
 *  - internal notes are never returned by a customer-facing function,
 *  - internal support replies are stripped from customer views.
 */

import type {
  AdminBookingDetail,
  AdminBookingListItem,
  AdminSupportRequest,
  BookingDetail,
  BookingDocument,
  BookingListItem,
  BookingListQuery,
  CancellationRequest,
  CancellationRequestInput,
  GuestBookingLookupInput,
  InternalNote,
  Paged,
  PaymentStatus,
  SupportRequest,
  SupportRequestInput,
  SupportStatus,
} from "@/types/operations";
import type { BookingStatus, BookingSummary, HotelBookingSummary } from "@/types/booking";
import { notify } from "@/lib/ops/notifications";
import {
  opsId,
  readOpsStore,
  timelineEvent,
  updateOpsStore,
  type OpsStore,
  type StoredBooking,
} from "@/lib/ops/ops-store";

export const OPS_BOOKING_NOT_FOUND = "OPS_BOOKING_NOT_FOUND";
export const OPS_LOOKUP_FAILED = "OPS_LOOKUP_FAILED";
export const OPS_NOT_ALLOWED = "OPS_NOT_ALLOWED";

export class OpsMockError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OpsMockError";
  }
}

const latency = () => new Promise((resolve) => setTimeout(resolve, 180));

export interface CustomerContext {
  userId: string | null;
}

/* ------------------------------------------------------------------ */
/* Recording bookings produced by the existing mock checkout            */
/* ------------------------------------------------------------------ */

function paymentStatusFor(status: BookingStatus): PaymentStatus {
  switch (status) {
    case "confirmed":
      return "paid";
    case "booking_processing":
      return "paid";
    case "payment_processing":
      return "pending";
    case "payment_failed":
      return "failed";
    case "failed":
      // Money was captured but the provider booking did not complete.
      return "refund_pending";
    case "cancelled":
      return "refund_pending";
    default:
      return "not_started";
  }
}

function flightSummaryLine(booking: BookingSummary): { destination: string; summary: string; travelDate: string | null } {
  const outbound = booking.itineraries[0];
  const first = outbound?.segments[0];
  const last = outbound?.segments[outbound.segments.length - 1];
  const destination = last?.destination.city || last?.destination.code || "—";
  const route = first && last ? `${first.origin.code} → ${last.destination.code}` : "Flight";
  const airline = first ? [first.airline.name || first.airline.code, first.flightNumber].filter(Boolean).join(" ") : "";
  return {
    destination,
    summary: [route, airline].filter(Boolean).join(" · "),
    travelDate: first?.departureAt ?? null,
  };
}

function hotelSummaryLine(booking: HotelBookingSummary): { destination: string; summary: string; travelDate: string | null } {
  const city = booking.hotel.location?.city || booking.hotel.location?.address || "—";
  const nights = booking.stay.nights;
  return {
    destination: city,
    summary: [booking.hotel.name, `${nights} night${nights === 1 ? "" : "s"}`, booking.room.roomName]
      .filter(Boolean)
      .join(" · "),
    travelDate: booking.stay.checkIn,
  };
}

function baseTimeline(status: BookingStatus, at: string, product: "flight" | "hotel") {
  const events = [
    timelineEvent("booking_created", { at, actor: "customer" }),
    timelineEvent("review_completed", { at, actor: "customer" }),
    timelineEvent("checkout_started", { at, actor: "customer" }),
    timelineEvent("payment_started", { at, actor: "customer" }),
  ];
  if (status === "payment_failed") {
    events.push(timelineEvent("payment_failed", { at, detail: "Test payment declined." }));
    return events;
  }
  if (status === "awaiting_payment" || status === "payment_processing") {
    return events.slice(0, status === "awaiting_payment" ? 3 : 4);
  }
  events.push(timelineEvent("payment_confirmed", { at, detail: "Test payment (no real money moved)." }));
  if (status === "confirmed") {
    events.push(timelineEvent("booking_confirmed", { at }));
    events.push(
      timelineEvent("document_generated", {
        at,
        detail: product === "flight" ? "E-ticket pending provider issue." : "Voucher pending provider issue.",
      }),
    );
  }
  if (status === "failed") {
    events.push(timelineEvent("provider_booking_failed", { at, detail: "Provider could not confirm." }));
    events.push(timelineEvent("refund_required", { at }));
    events.push(timelineEvent("refund_updated", { at, detail: "Refund pending." }));
  }
  if (status === "booking_processing") {
    events.push(timelineEvent("booking_confirmed", { at, detail: "Awaiting provider confirmation." }));
  }
  return events;
}

function upsert(store: OpsStore, record: StoredBooking): OpsStore {
  const existing = store.bookings[record.bookingReference];
  return {
    ...store,
    bookings: {
      ...store.bookings,
      [record.bookingReference]: existing
        ? { ...existing, ...record, timeline: record.timeline.length ? record.timeline : existing.timeline, cancellation: existing.cancellation }
        : record,
    },
  };
}

function notifyForStatus(reference: string, status: BookingStatus, product: string) {
  if (status === "confirmed") {
    notify({
      type: "booking_confirmed",
      title: `${product} booking confirmed`,
      body: `Booking ${reference} is confirmed.`,
      bookingReference: reference,
    });
    notify({
      type: "payment_successful",
      title: "Payment successful",
      body: `Test payment recorded for ${reference}.`,
      bookingReference: reference,
    });
  } else if (status === "payment_failed") {
    notify({
      type: "payment_failed",
      title: "Payment failed",
      body: `Payment for ${reference} did not go through.`,
      bookingReference: reference,
    });
  } else if (status === "failed") {
    notify({
      type: "booking_failed",
      title: `${product} booking failed`,
      body: `${reference} could not be confirmed by the provider. Refund pending.`,
      bookingReference: reference,
    });
  } else {
    notify({
      type: "booking_created",
      title: `${product} booking created`,
      body: `Booking ${reference} created.`,
      bookingReference: reference,
    });
  }
}

/** Mirror a mock flight booking into the operations store. */
export function recordFlightBooking(booking: BookingSummary, ctx: CustomerContext): void {
  try {
    const line = flightSummaryLine(booking);
    const at = new Date().toISOString();
    updateOpsStore((store) =>
      upsert(store, {
        bookingReference: booking.bookingReference,
        product: "flight",
        ownerUserId: ctx.userId,
        contactEmail: booking.contact.email,
        contactPhone: booking.contact.phone,
        status: booking.status,
        paymentStatus: paymentStatusFor(booking.status),
        bookedAt: store.bookings[booking.bookingReference]?.bookedAt ?? at,
        travelDate: line.travelDate,
        destination: line.destination,
        summary: line.summary,
        totalAmount: booking.totalPayable,
        flight: booking,
        timeline: baseTimeline(booking.status, at, "flight"),
        isTestMode: booking.isTestMode !== false,
      }),
    );
    notifyForStatus(booking.bookingReference, booking.status, "Flight");
  } catch {
    /* recording must never break the booking flow */
  }
}

/** Mirror a mock hotel booking into the operations store. */
export function recordHotelBooking(booking: HotelBookingSummary, ctx: CustomerContext): void {
  try {
    const line = hotelSummaryLine(booking);
    const at = new Date().toISOString();
    updateOpsStore((store) =>
      upsert(store, {
        bookingReference: booking.bookingReference,
        product: "hotel",
        ownerUserId: ctx.userId,
        contactEmail: booking.contact.email,
        contactPhone: booking.contact.phone,
        status: booking.status,
        paymentStatus: paymentStatusFor(booking.status),
        bookedAt: store.bookings[booking.bookingReference]?.bookedAt ?? at,
        travelDate: line.travelDate,
        destination: line.destination,
        summary: line.summary,
        totalAmount: booking.totalPayable,
        hotel: booking,
        timeline: baseTimeline(booking.status, at, "hotel"),
        isTestMode: booking.isTestMode !== false,
      }),
    );
    notifyForStatus(booking.bookingReference, booking.status, "Hotel");
  } catch {
    /* recording must never break the booking flow */
  }
}

/* ------------------------------------------------------------------ */
/* Projections                                                         */
/* ------------------------------------------------------------------ */

function toListItem(record: StoredBooking): BookingListItem {
  return {
    bookingReference: record.bookingReference,
    product: record.product,
    status: record.status,
    paymentStatus: record.paymentStatus,
    bookedAt: record.bookedAt,
    travelDate: record.travelDate ?? null,
    destination: record.destination,
    summary: record.summary,
    totalAmount: record.totalAmount,
    cancellationStatus: record.cancellation?.status ?? "none",
    refundStatus: record.cancellation?.refundStatus ?? (record.paymentStatus === "refund_pending" ? "pending" : "none"),
    isTestMode: record.isTestMode,
  };
}

function documentsFor(record: StoredBooking): BookingDocument[] {
  const confirmed = record.status === "confirmed";
  const docs: BookingDocument[] = [];
  if (record.product === "flight") {
    docs.push({
      kind: "eticket",
      label: "E-ticket",
      url: record.flight?.ticketUrl ?? null,
      status: confirmed ? "pending" : "not_applicable",
      note: confirmed
        ? "The airline e-ticket is issued by the provider. It will appear here once ticketing is live."
        : "Available only after the booking is confirmed.",
    });
  } else {
    docs.push({
      kind: "voucher",
      label: "Hotel voucher",
      url: record.hotel?.voucherUrl ?? null,
      status: confirmed ? "pending" : "not_applicable",
      note: confirmed
        ? "The hotel voucher is issued by the provider. It will appear here once booking goes live."
        : "Available only after the booking is confirmed.",
    });
  }
  docs.push({
    kind: "invoice",
    label: "Invoice",
    url: (record.product === "flight" ? record.flight?.invoiceUrl : record.hotel?.invoiceUrl) ?? null,
    status: confirmed ? "pending" : "not_applicable",
    note: confirmed
      ? "Generated by our billing service after a real payment is captured."
      : "Issued only for a paid booking.",
  });
  return docs;
}

function bucketOf(record: StoredBooking): Exclude<BookingListQuery["bucket"], "all" | undefined> {
  if (record.status === "cancelled" || record.cancellation?.status === "approved") return "cancelled";
  if (record.status === "failed" || record.status === "payment_failed") return "failed";
  if (record.status === "awaiting_payment" || record.status === "payment_processing" || record.status === "booking_processing")
    return "pending";
  const travel = record.travelDate ? Date.parse(record.travelDate) : NaN;
  if (!Number.isNaN(travel) && travel < Date.now()) return "completed";
  return "upcoming";
}

function customerSupportView(request: SupportRequest): SupportRequest {
  return { ...request, messages: request.messages.filter((message) => !message.internal) };
}

function sortRecords(records: StoredBooking[], sort: BookingListQuery["sort"]): StoredBooking[] {
  const copy = records.slice();
  if (sort === "oldest") return copy.sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
  if (sort === "travel_date")
    return copy.sort((a, b) => (a.travelDate ?? "9999").localeCompare(b.travelDate ?? "9999"));
  return copy.sort((a, b) => b.bookedAt.localeCompare(a.bookedAt));
}

function applyQuery(records: StoredBooking[], query: BookingListQuery): StoredBooking[] {
  const term = (query.search ?? "").trim().toLowerCase();
  return records.filter((record) => {
    if (query.bucket && query.bucket !== "all" && bucketOf(record) !== query.bucket) return false;
    if (query.product && query.product !== "all" && record.product !== query.product) return false;
    if (query.status && query.status !== "all" && record.status !== query.status) return false;
    if (query.paymentStatus && query.paymentStatus !== "all" && record.paymentStatus !== query.paymentStatus)
      return false;
    if (query.fromDate && record.bookedAt.slice(0, 10) < query.fromDate) return false;
    if (query.toDate && record.bookedAt.slice(0, 10) > query.toDate) return false;
    if (term) {
      const haystack = [record.bookingReference, record.destination, record.summary, record.contactEmail]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
}

function page<T>(items: T[], query: BookingListQuery): Paged<T> {
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 10;
  const slice = items.slice(offset, offset + limit);
  return { items: slice, total: items.length, hasMore: offset + slice.length < items.length };
}

/* ------------------------------------------------------------------ */
/* Customer API                                                        */
/* ------------------------------------------------------------------ */

function ownedRecords(store: OpsStore, ctx: CustomerContext): StoredBooking[] {
  if (!ctx.userId) return [];
  return Object.values(store.bookings).filter((record) => record.ownerUserId === ctx.userId);
}

function toDetail(record: StoredBooking, support: SupportRequest[]): BookingDetail {
  return {
    ...toListItem(record),
    contact: { email: record.contactEmail, phone: record.contactPhone },
    flight: record.flight,
    hotel: record.hotel,
    timeline: [...record.timeline].sort((a, b) => a.at.localeCompare(b.at)),
    documents: documentsFor(record),
    cancellation: record.cancellation,
    supportRequests: support.map(customerSupportView),
  };
}

export const mockOpsProvider = {
  async listBookings(query: BookingListQuery, ctx: CustomerContext): Promise<Paged<BookingListItem>> {
    await latency();
    const store = readOpsStore();
    const filtered = applyQuery(ownedRecords(store, ctx), query);
    return page(sortRecords(filtered, query.sort).map(toListItem), query);
  },

  async getBooking(reference: string, ctx: CustomerContext): Promise<BookingDetail> {
    await latency();
    const store = readOpsStore();
    const record = store.bookings[reference];
    if (!record || record.ownerUserId !== ctx.userId) {
      throw new OpsMockError(OPS_BOOKING_NOT_FOUND, "We couldn't find that booking on your account.");
    }
    const support = store.support.filter((item) => item.bookingReference === reference);
    return toDetail(record, support);
  },

  /**
   * Guest retrieval. Knowing a reference is NOT enough: the contact email stored
   * with the booking must match too, and the record returned omits dates of
   * birth and any document number beyond what the provider already masked.
   */
  async lookupGuestBooking(input: GuestBookingLookupInput): Promise<BookingDetail> {
    await latency();
    const store = readOpsStore();
    const record = store.bookings[input.bookingReference.trim().toUpperCase()];
    const email = input.contactEmail.trim().toLowerCase();
    if (!record || record.contactEmail.trim().toLowerCase() !== email) {
      throw new OpsMockError(
        OPS_LOOKUP_FAILED,
        "That booking reference and email don't match a booking. Check your confirmation and try again.",
      );
    }
    const detail = toDetail(record, []);
    if (detail.flight) {
      detail.flight = {
        ...detail.flight,
        travellers: detail.flight.travellers.map(({ dateOfBirth: _dob, passportNumber: _p, ...rest }) => rest),
      };
    }
    if (detail.hotel) {
      detail.hotel = {
        ...detail.hotel,
        guests: detail.hotel.guests.map(({ panNumber: _pan, ...rest }) => rest),
      };
    }
    return detail;
  },

  async requestCancellation(
    input: CancellationRequestInput,
    ctx: CustomerContext,
  ): Promise<CancellationRequest> {
    await latency();
    const store = readOpsStore();
    const record = store.bookings[input.bookingReference];
    if (!record || record.ownerUserId !== ctx.userId) {
      throw new OpsMockError(OPS_BOOKING_NOT_FOUND, "We couldn't find that booking on your account.");
    }
    if (record.cancellation && record.cancellation.status !== "rejected") {
      return record.cancellation;
    }
    const now = new Date().toISOString();
    const request: CancellationRequest = {
      id: opsId("cxl"),
      bookingReference: record.bookingReference,
      reason: input.reason,
      comment: input.comment,
      status: "requested",
      refundStatus: record.paymentStatus === "paid" ? "pending" : "not_applicable",
      createdAt: now,
      updatedAt: now,
    };
    updateOpsStore((current) => ({
      ...current,
      bookings: {
        ...current.bookings,
        [record.bookingReference]: {
          ...current.bookings[record.bookingReference],
          cancellation: request,
          timeline: [
            ...current.bookings[record.bookingReference].timeline,
            timelineEvent("cancellation_requested", { actor: "customer", detail: "Awaiting review by our team." }),
          ],
        },
      },
    }));
    notify({
      type: "cancellation_requested",
      title: "Cancellation requested",
      body: `A cancellation was requested for ${record.bookingReference}. Our team will review it.`,
      bookingReference: record.bookingReference,
    });
    notify({
      type: "cancellation_requested",
      title: "New cancellation request",
      body: `${record.bookingReference} — reason: ${input.reason}.`,
      bookingReference: record.bookingReference,
      audience: "admin",
    });
    return request;
  },

  async listSupport(ctx: CustomerContext): Promise<SupportRequest[]> {
    await latency();
    const store = readOpsStore();
    return store.support
      .filter((request) => store.supportOwners[request.id]?.userId === ctx.userId && ctx.userId)
      .map(customerSupportView)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async createSupportRequest(input: SupportRequestInput, ctx: CustomerContext & { email: string }): Promise<SupportRequest> {
    await latency();
    const now = new Date().toISOString();
    const id = opsId("sup");
    const request: SupportRequest = {
      id,
      reference: `SR-${id.slice(-6).toUpperCase()}`,
      bookingReference: input.bookingReference ?? null,
      category: input.category,
      subject: input.subject,
      status: "open",
      createdAt: now,
      updatedAt: now,
      messages: [{ id: opsId("msg"), author: "customer", body: input.message, createdAt: now }],
    };
    updateOpsStore((store) => ({
      ...store,
      support: [...store.support, request],
      supportOwners: { ...store.supportOwners, [id]: { userId: ctx.userId, contactEmail: ctx.email } },
      bookings: input.bookingReference && store.bookings[input.bookingReference]
        ? {
            ...store.bookings,
            [input.bookingReference]: {
              ...store.bookings[input.bookingReference],
              timeline: [
                ...store.bookings[input.bookingReference].timeline,
                timelineEvent("support_request_created", { actor: "customer", detail: request.reference }),
              ],
            },
          }
        : store.bookings,
    }));
    notify({
      type: "support_request_created",
      title: "Support request received",
      body: `${request.reference} — ${request.subject}`,
      supportRequestId: id,
      bookingReference: request.bookingReference,
    });
    notify({
      type: "support_request_created",
      title: "New support request",
      body: `${request.reference} (${request.category})`,
      supportRequestId: id,
      audience: "admin",
    });
    return request;
  },

  async addSupportMessage(id: string, body: string, ctx: CustomerContext): Promise<SupportRequest> {
    await latency();
    const store = readOpsStore();
    const owner = store.supportOwners[id];
    if (!owner || !ctx.userId || owner.userId !== ctx.userId) {
      throw new OpsMockError(OPS_NOT_ALLOWED, "That support request isn't on your account.");
    }
    const now = new Date().toISOString();
    let updated: SupportRequest | undefined;
    updateOpsStore((current) => ({
      ...current,
      support: current.support.map((request) => {
        if (request.id !== id) return request;
        updated = {
          ...request,
          status: request.status === "waiting_customer" ? "in_progress" : request.status,
          updatedAt: now,
          messages: [...request.messages, { id: opsId("msg"), author: "customer", body, createdAt: now }],
        };
        return updated;
      }),
    }));
    notify({
      type: "support_request_updated",
      title: "Support request updated",
      body: "The customer replied.",
      supportRequestId: id,
      audience: "admin",
    });
    if (!updated) throw new OpsMockError(OPS_NOT_ALLOWED, "That support request no longer exists.");
    return customerSupportView(updated);
  },

  /* ---------------------------------------------------------------- */
  /* Admin API (level checks are applied by the caller AND server)     */
  /* ---------------------------------------------------------------- */

  async adminListBookings(query: BookingListQuery): Promise<Paged<AdminBookingListItem>> {
    await latency();
    const store = readOpsStore();
    const filtered = sortRecords(applyQuery(Object.values(store.bookings), query), query.sort);
    const rows: AdminBookingListItem[] = filtered.map((record) => ({
      ...toListItem(record),
      contactEmail: record.contactEmail,
      customerType: record.ownerUserId ? "account" : "guest",
      openSupportRequests: store.support.filter(
        (request) =>
          request.bookingReference === record.bookingReference &&
          request.status !== "resolved" &&
          request.status !== "closed",
      ).length,
      internalNoteCount: store.notes.filter((note) => note.bookingReference === record.bookingReference).length,
    }));
    return page(rows, query);
  },

  async adminGetBooking(reference: string): Promise<AdminBookingDetail> {
    await latency();
    const store = readOpsStore();
    const record = store.bookings[reference];
    if (!record) throw new OpsMockError(OPS_BOOKING_NOT_FOUND, "No booking with that reference.");
    const support = store.support.filter((item) => item.bookingReference === reference);
    const base = toDetail(record, support);
    return {
      ...base,
      // Admin sees the full case, including internal replies.
      supportRequests: support,
      contactEmail: record.contactEmail,
      customerType: record.ownerUserId ? "account" : "guest",
      providerReferences:
        record.product === "flight"
          ? [
              { label: "Airline PNR", value: record.flight?.pnr ?? null },
              { label: "Airline booking reference", value: record.flight?.airlineBookingReference ?? null },
              { label: "Provider booking id", value: null },
            ]
          : [
              { label: "Hotel confirmation number", value: record.hotel?.hotelConfirmationNumber ?? null },
              { label: "Provider booking id", value: record.hotel?.hotelBookingId ?? null },
            ],
      notes: store.notes
        .filter((note) => note.bookingReference === reference)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  },

  async adminAddNote(
    reference: string,
    body: string,
    author: { name: string; role: string },
  ): Promise<InternalNote> {
    await latency();
    const note: InternalNote = {
      id: opsId("note"),
      bookingReference: reference,
      body,
      authorName: author.name,
      authorRole: author.role,
      createdAt: new Date().toISOString(),
    };
    updateOpsStore((store) => ({
      ...store,
      notes: [...store.notes, note],
      bookings: store.bookings[reference]
        ? {
            ...store.bookings,
            [reference]: {
              ...store.bookings[reference],
              timeline: [
                ...store.bookings[reference].timeline,
                timelineEvent("note_added", { actor: "admin", detail: `By ${author.name}` }),
              ],
            },
          }
        : store.bookings,
    }));
    return note;
  },

  async adminUpdateCancellation(
    reference: string,
    next: { status: CancellationRequest["status"]; refundStatus: CancellationRequest["refundStatus"]; note?: string },
    admin: { name: string },
  ): Promise<CancellationRequest> {
    await latency();
    const store = readOpsStore();
    const record = store.bookings[reference];
    if (!record?.cancellation) throw new OpsMockError(OPS_BOOKING_NOT_FOUND, "No cancellation request on this booking.");
    const updated: CancellationRequest = {
      ...record.cancellation,
      status: next.status,
      refundStatus: next.refundStatus,
      decidedBy: admin.name,
      decisionNote: next.note,
      updatedAt: new Date().toISOString(),
    };
    updateOpsStore((current) => ({
      ...current,
      bookings: {
        ...current.bookings,
        [reference]: {
          ...current.bookings[reference],
          // An approved cancellation moves the booking, but never the money:
          // no refund is executed until a payment provider is connected.
          status: next.status === "approved" ? "cancelled" : current.bookings[reference].status,
          paymentStatus:
            next.refundStatus === "completed"
              ? "refunded"
              : next.refundStatus === "pending"
                ? "refund_pending"
                : current.bookings[reference].paymentStatus,
          cancellation: updated,
          timeline: [
            ...current.bookings[reference].timeline,
            timelineEvent("cancellation_updated", { actor: "admin", detail: `${next.status} by ${admin.name}` }),
            timelineEvent("refund_updated", { actor: "admin", detail: `Refund ${next.refundStatus}` }),
          ],
        },
      },
    }));
    notify({
      type: "cancellation_status_changed",
      title: "Cancellation update",
      body: `${reference}: cancellation ${next.status}.`,
      bookingReference: reference,
    });
    notify({
      type: "refund_status_changed",
      title: "Refund update",
      body: `${reference}: refund ${next.refundStatus}.`,
      bookingReference: reference,
    });
    return updated;
  },

  async adminListSupport(filters: { status?: SupportStatus | "all"; category?: string; search?: string } = {}): Promise<
    AdminSupportRequest[]
  > {
    await latency();
    const store = readOpsStore();
    const term = (filters.search ?? "").trim().toLowerCase();
    return store.support
      .map<AdminSupportRequest>((request) => ({
        ...request,
        contactEmail: store.supportOwners[request.id]?.contactEmail ?? "—",
        customerType: store.supportOwners[request.id]?.userId ? "account" : "guest",
      }))
      .filter((request) => {
        if (filters.status && filters.status !== "all" && request.status !== filters.status) return false;
        if (filters.category && filters.category !== "all" && request.category !== filters.category) return false;
        if (term) {
          const haystack = [request.reference, request.subject, request.bookingReference ?? "", request.contactEmail]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async adminUpdateSupport(
    id: string,
    patch: { status?: SupportStatus; reply?: string; internal?: boolean },
    admin: { name: string },
  ): Promise<AdminSupportRequest> {
    await latency();
    const now = new Date().toISOString();
    let updated: SupportRequest | undefined;
    updateOpsStore((store) => ({
      ...store,
      support: store.support.map((request) => {
        if (request.id !== id) return request;
        updated = {
          ...request,
          status: patch.status ?? request.status,
          updatedAt: now,
          messages: patch.reply
            ? [
                ...request.messages,
                {
                  id: opsId("msg"),
                  author: "agent",
                  authorName: admin.name,
                  body: patch.reply,
                  createdAt: now,
                  internal: patch.internal,
                },
              ]
            : request.messages,
        };
        return updated;
      }),
    }));
    if (!updated) throw new OpsMockError(OPS_NOT_ALLOWED, "That support request no longer exists.");
    notify({
      type: "support_request_updated",
      title: "Support request updated",
      body: `${updated.reference} is now ${updated.status.replace("_", " ")}.`,
      supportRequestId: id,
    });
    const store = readOpsStore();
    return {
      ...updated,
      contactEmail: store.supportOwners[id]?.contactEmail ?? "—",
      customerType: store.supportOwners[id]?.userId ? "account" : "guest",
    };
  },

  async adminOperationsMetrics(): Promise<{
    totalBookings: number;
    todayBookings: number;
    pendingBookings: number;
    failedBookings: number;
    paymentPending: number;
    cancellationRequests: number;
    openSupport: number;
    flightBookings: number;
    hotelBookings: number;
  }> {
    await latency();
    const store = readOpsStore();
    const records = Object.values(store.bookings);
    const today = new Date().toISOString().slice(0, 10);
    return {
      totalBookings: records.length,
      todayBookings: records.filter((record) => record.bookedAt.slice(0, 10) === today).length,
      pendingBookings: records.filter((record) => bucketOf(record) === "pending").length,
      failedBookings: records.filter((record) => bucketOf(record) === "failed").length,
      paymentPending: records.filter(
        (record) => record.paymentStatus === "pending" || record.paymentStatus === "not_started",
      ).length,
      cancellationRequests: records.filter(
        (record) => record.cancellation && (record.cancellation.status === "requested" || record.cancellation.status === "pending"),
      ).length,
      openSupport: store.support.filter((request) => request.status !== "resolved" && request.status !== "closed").length,
      flightBookings: records.filter((record) => record.product === "flight").length,
      hotelBookings: records.filter((record) => record.product === "hotel").length,
    };
  },
};
