/**
 * Test adapter for the checkout step.
 *
 * It exists for ONE reason: the FastAPI payment endpoints do not exist yet, so
 * without it the customer journey cannot be walked end to end. It is a drop-in
 * stand-in for the backend, not a fake business rule set:
 *
 *  - it never invents a price — the total comes from the review snapshot the
 *    server produced earlier in the flow,
 *  - it never talks to a payment provider,
 *  - it marks every summary it returns with `isTestMode: true`, so the UI can
 *    say so out loud,
 *  - it is only reachable when `VITE_BOOKING_API_URL` is unset (or test mode is
 *    explicitly forced), and it is bypassed entirely once the real endpoints
 *    are live.
 *
 * State lives in sessionStorage so a page reload behaves like a real
 * server-stored booking.
 */

import { readCheckoutSnapshot } from "@/lib/checkout-session";
import type {
  BookingSummary,
  FareBreakdownLine,
  Money,
  PaymentConfirmRequest,
  PaymentFailureRequest,
  PaymentOrder,
  PaymentOrderRequest,
  PaymentResult,
  TravellerSummaryItem,
} from "@/types/booking";

const STORE_KEY = "fnf.testBookings";
/** Simulated backend/provider latency, so loading states are exercised. */
const LATENCY_MS = 900;

type Store = Record<string, BookingSummary>;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStore(): Store {
  const raw = storage()?.getItem(STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    storage()?.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Non-fatal: the journey still works for the current page view.
  }
}

function put(summary: BookingSummary): BookingSummary {
  const store = readStore();
  store[summary.bookingReference] = summary;
  writeStore(store);
  return summary;
}

function wait(ms = LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function money(amount: number, currency: string): Money {
  return { amount, currency };
}

function maskPassport(value?: string): string | undefined {
  if (!value || value.length < 4) return value ? "••••" : undefined;
  return `${"•".repeat(Math.max(2, value.length - 4))}${value.slice(-4)}`;
}

function buildBreakdown(
  fare: BookingSummary["fare"],
  passengers: BookingSummary["passengers"],
): FareBreakdownLine[] {
  const currency = fare.totalPrice.currency;
  const lines: FareBreakdownLine[] = [];
  const seated = (passengers.adults ?? 0) + (passengers.children ?? 0);

  if (fare.basePrice) {
    lines.push({
      label: "Base fare",
      amount: money(fare.basePrice.amount, currency),
      kind: "base",
      note: seated > 1 ? `${seated} travellers` : undefined,
    });
  }
  if (fare.taxes) {
    lines.push({ label: "Taxes & surcharges", amount: money(fare.taxes.amount, currency), kind: "tax" });
  }
  if (fare.otherCharges) {
    lines.push({ label: "Other charges", amount: money(fare.otherCharges.amount, currency), kind: "fee" });
  }

  // When the server did not split the fare, show the single authoritative total.
  if (lines.length === 0) {
    lines.push({ label: "Flight fare", amount: fare.totalPrice, kind: "base" });
  }
  return lines;
}

function toTravellerSummary(snapshotTravellers: ReturnType<typeof readCheckoutSnapshot>): TravellerSummaryItem[] {
  if (!snapshotTravellers) return [];
  return snapshotTravellers.travellers.map((traveller) => ({
    type: traveller.type,
    title: traveller.title,
    fullName: `${traveller.firstName} ${traveller.lastName}`.trim(),
    dateOfBirth: traveller.dateOfBirth,
    nationality: traveller.nationality,
    passportNumber: maskPassport(traveller.passportNumber),
  }));
}

const TEST_METHODS: BookingSummary["paymentMethods"] = [
  { id: "upi", label: "UPI", description: "Pay from any UPI app", enabled: true },
  { id: "card", label: "Credit or debit card", description: "Visa, Mastercard, RuPay, Amex", enabled: true },
  { id: "netbanking", label: "Net banking", description: "All major Indian banks", enabled: true },
  { id: "wallet", label: "Wallets", description: "Paytm, PhonePe, Amazon Pay", enabled: true },
];

/**
 * A walkthrough booking, reachable ONLY at the reserved reference `TESTDEMO`.
 * It exists so the checkout → payment → confirmation journey can be reviewed
 * before the flight-search backend is running. A real booking reference never
 * resolves to it, so live data can never be confused with this.
 */
const DEMO_REFERENCE = "TESTDEMO";

function demoBooking(): BookingSummary {
  const currency = "INR";
  const fare: BookingSummary["fare"] = {
    totalPrice: money(18_640, currency),
    basePrice: money(15_200, currency),
    taxes: money(3_440, currency),
    refundable: false,
    fareType: "Saver",
    baggageCheckIn: "15 kg",
    baggageCabin: "7 kg",
    seatsAvailable: 4,
  };
  const passengers = { adults: 2, children: 0, infants: 0 };

  return {
    bookingReference: DEMO_REFERENCE,
    status: "awaiting_payment",
    itineraries: [
      {
        direction: "outbound",
        stops: 0,
        durationMinutes: 145,
        segments: [
          {
            id: "demo-1",
            airline: { code: "6E", name: "IndiGo" },
            flightNumber: "6E 2134",
            origin: { code: "AMD", city: "Ahmedabad" },
            destination: { code: "GOI", city: "Goa" },
            departureAt: "2026-11-14T08:20:00+05:30",
            arrivalAt: "2026-11-14T10:45:00+05:30",
            durationMinutes: 145,
          },
        ],
      },
    ],
    fare,
    breakdown: buildBreakdown(fare, passengers),
    totalPayable: fare.totalPrice,
    passengers,
    travellers: [
      { type: "adult", title: "Mr", fullName: "Test Traveller One" },
      { type: "adult", title: "Ms", fullName: "Test Traveller Two" },
    ],
    contact: { email: "test.traveller@example.com", phone: "+919999999999" },
    ticketUrl: null,
    invoiceUrl: null,
    paymentMethods: TEST_METHODS,
    isTestMode: true,
  };
}

/** Rehydrates a booking from the store, or seeds it from the review snapshot. */
function resolve(reference: string): BookingSummary | null {
  const existing = readStore()[reference];
  if (existing) return existing;

  const snapshot = readCheckoutSnapshot(reference);
  if (!snapshot) return reference === DEMO_REFERENCE ? put(demoBooking()) : null;

  return put({
    bookingReference: reference,
    status: "awaiting_payment",
    itineraries: snapshot.itineraries,
    fare: snapshot.fare,
    breakdown: buildBreakdown(snapshot.fare, snapshot.passengers),
    totalPayable: snapshot.fare.totalPrice,
    passengers: snapshot.passengers,
    travellers: toTravellerSummary(snapshot),
    contact: snapshot.contact,
    expiresAt: snapshot.expiresAt,
    priceChange: snapshot.priceChange,
    ticketUrl: null,
    invoiceUrl: null,
    paymentMethods: TEST_METHODS,
    isTestMode: true,
  });
}

function reference(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

export const testCheckoutAdapter = {
  async getBooking(bookingReference: string): Promise<BookingSummary> {
    await wait(400);
    const booking = resolve(bookingReference);
    if (!booking) {
      throw new Error("BOOKING_NOT_FOUND");
    }
    return booking;
  },

  async createOrder(payload: PaymentOrderRequest): Promise<PaymentOrder> {
    await wait();
    const booking = resolve(payload.bookingReference);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    return {
      provider: "test",
      bookingReference: booking.bookingReference,
      orderId: `test_order_${reference("")}`,
      amount: booking.totalPayable,
      prefill: { email: booking.contact.email, phone: booking.contact.phone },
      expiresAt: booking.expiresAt,
    };
  },

  /**
   * Mirrors the real contract: the caller passes a provider payment id and the
   * adapter decides the outcome. A payment id containing "fail" simulates a
   * declined payment so failure UI can be exercised deliberately.
   */
  async confirm(payload: PaymentConfirmRequest): Promise<PaymentResult> {
    await wait(1400);
    const booking = resolve(payload.bookingReference);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");

    if (payload.paymentId.toLowerCase().includes("fail")) {
      const failed = put({
        ...booking,
        status: "payment_failed",
        statusMessage: "The payment was declined. No money has been taken.",
      });
      return { status: "payment_failed", booking: failed, message: failed.statusMessage };
    }

    const confirmed = put({
      ...booking,
      status: "confirmed",
      pnr: reference("PNR"),
      airlineBookingReference: reference("AL"),
      travellers: booking.travellers.map((traveller, index) => ({
        ...traveller,
        ticketNumber: `TKT${Date.now().toString().slice(-8)}${index + 1}`,
      })),
      // Documents are produced by the backend; nothing to link to yet.
      ticketUrl: null,
      invoiceUrl: null,
      statusMessage: undefined,
    });
    return { status: "confirmed", booking: confirmed };
  },

  async reportFailure(payload: PaymentFailureRequest): Promise<BookingSummary> {
    await wait(300);
    const booking = resolve(payload.bookingReference);
    if (!booking) throw new Error("BOOKING_NOT_FOUND");
    return put({
      ...booking,
      status: payload.reason === "cancelled" ? "awaiting_payment" : "payment_failed",
      statusMessage:
        payload.reason === "cancelled"
          ? "You closed the payment window before paying. Your fare is still held."
          : (payload.message ?? "The payment did not go through. No money has been taken."),
    });
  },
};
