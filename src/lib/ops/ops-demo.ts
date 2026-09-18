/**
 * Sample operational records for testing the admin screens (TEST MODE ONLY).
 *
 * These are clearly synthetic bookings used to exercise list filters, the
 * timeline, notes, cancellation states and support management without walking
 * the whole booking journey several times. They carry no itinerary detail, no
 * traveller documents and no payment data, and they are never created when a
 * real backend is configured.
 */

import { notify } from "@/lib/ops/notifications";
import { opsId, timelineEvent, updateOpsStore, type StoredBooking } from "@/lib/ops/ops-store";
import type { CancellationRequest, SupportRequest } from "@/types/operations";

const INR = (amount: number) => ({ amount, currency: "INR" });

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function sample(overrides: Partial<StoredBooking> & Pick<StoredBooking, "bookingReference" | "product">): StoredBooking {
  return {
    ownerUserId: null,
    contactEmail: "sample.traveller@example.com",
    status: "confirmed",
    paymentStatus: "paid",
    bookedAt: daysFromNow(-2),
    travelDate: daysFromNow(12),
    destination: "Goa",
    summary: "Sample record",
    totalAmount: INR(18_400),
    timeline: [
      timelineEvent("booking_created", { at: daysFromNow(-2), actor: "customer" }),
      timelineEvent("payment_confirmed", { at: daysFromNow(-2), detail: "Sample record — no real payment." }),
      timelineEvent("booking_confirmed", { at: daysFromNow(-2) }),
    ],
    isTestMode: true,
    synthetic: true,
    ...overrides,
  };
}

export function seedSampleOperations(): number {
  const now = new Date().toISOString();
  const cancellation: CancellationRequest = {
    id: opsId("cxl"),
    bookingReference: "SAMPLE-CXL1",
    reason: "date_change",
    comment: "Customer asked to move the trip by a week.",
    status: "requested",
    refundStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const records: StoredBooking[] = [
    sample({
      bookingReference: "SAMPLE-FL01",
      product: "flight",
      summary: "AMD → GOI · IndiGo 6E 2134",
      destination: "Goa",
    }),
    sample({
      bookingReference: "SAMPLE-HT01",
      product: "hotel",
      summary: "Coastal Retreat Candolim · 3 nights · Deluxe Sea View",
      destination: "Candolim",
      totalAmount: INR(27_900),
    }),
    sample({
      bookingReference: "SAMPLE-PEND",
      product: "flight",
      summary: "BOM → DEL · Air India AI 806",
      destination: "Delhi",
      status: "awaiting_payment",
      paymentStatus: "not_started",
      totalAmount: INR(7_250),
      timeline: [timelineEvent("booking_created", { actor: "customer" }), timelineEvent("checkout_started", { actor: "customer" })],
    }),
    sample({
      bookingReference: "SAMPLE-FAIL",
      product: "hotel",
      summary: "Backwater Villa Alleppey · 2 nights · Premium Room",
      destination: "Alleppey",
      status: "failed",
      paymentStatus: "refund_pending",
      totalAmount: INR(15_100),
      timeline: [
        timelineEvent("payment_confirmed", { detail: "Sample record — no real payment." }),
        timelineEvent("provider_booking_failed", { detail: "Provider declined the room." }),
        timelineEvent("refund_required"),
      ],
    }),
    sample({
      bookingReference: "SAMPLE-CXL1",
      product: "flight",
      summary: "DEL → SXR · Vistara UK 611",
      destination: "Srinagar",
      totalAmount: INR(21_600),
      cancellation,
    }),
  ];

  const support: SupportRequest = {
    id: opsId("sup"),
    reference: "SR-SAMPLE",
    bookingReference: "SAMPLE-FAIL",
    category: "refund",
    subject: "Refund status for a failed hotel booking",
    status: "open",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: opsId("msg"),
        author: "customer",
        body: "My hotel booking failed after payment. When will the refund be processed?",
        createdAt: now,
      },
    ],
  };

  updateOpsStore((store) => ({
    ...store,
    bookings: {
      ...store.bookings,
      ...Object.fromEntries(records.map((record) => [record.bookingReference, record])),
    },
    support: [...store.support, support],
    supportOwners: {
      ...store.supportOwners,
      [support.id]: { userId: null, contactEmail: "sample.traveller@example.com" },
    },
  }));

  notify({
    type: "support_request_created",
    title: "Sample support request",
    body: `${support.reference} created with the sample records.`,
    supportRequestId: support.id,
    audience: "admin",
  });

  return records.length;
}

export function clearSampleOperations(): void {
  updateOpsStore((store) => ({
    ...store,
    bookings: Object.fromEntries(
      Object.entries(store.bookings).filter(([, record]) => !record.synthetic),
    ),
    support: store.support.filter((request) => request.reference !== "SR-SAMPLE"),
  }));
}
