/**
 * Local continuity for the checkout step.
 *
 * Two things are kept per browser tab:
 *
 *  - the guest token that authorises a booking reference (issued by the server;
 *    never placed in a URL),
 *  - a read-only SNAPSHOT of what the customer already saw on the review page
 *    (itinerary, fare, travellers, contact).
 *
 * The snapshot is presentation-only. It is never sent back as an amount and is
 * never trusted for payment: the payable total always comes from the server
 * (or, until the backend endpoint exists, from the mock adapter which derives
 * it from this same snapshot).
 */

import type {
  ContactInput,
  FlightItinerary,
  PassengerCounts,
  PriceChange,
  ReviewFare,
  TravellerInput,
} from "@/types/booking";

const GUEST_PREFIX = "fnf.bookingGuest.";
const SNAPSHOT_PREFIX = "fnf.bookingSnapshot.";

export interface CheckoutSnapshot {
  bookingReference: string;
  itineraries: FlightItinerary[];
  fare: ReviewFare;
  passengers: PassengerCounts;
  travellers: TravellerInput[];
  contact: ContactInput;
  priceChange?: PriceChange;
  expiresAt?: string;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberBookingGuestToken(reference: string, guestToken?: string | null): void {
  if (!guestToken) return;
  storage()?.setItem(GUEST_PREFIX + reference, guestToken);
}

export function readBookingGuestToken(reference: string): string | null {
  return storage()?.getItem(GUEST_PREFIX + reference) ?? null;
}

export function saveCheckoutSnapshot(snapshot: CheckoutSnapshot): void {
  try {
    storage()?.setItem(SNAPSHOT_PREFIX + snapshot.bookingReference, JSON.stringify(snapshot));
  } catch {
    // Quota or private-mode failures must never break the booking flow.
  }
}

export function readCheckoutSnapshot(reference: string): CheckoutSnapshot | null {
  const raw = storage()?.getItem(SNAPSHOT_PREFIX + reference);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CheckoutSnapshot;
  } catch {
    return null;
  }
}

export function forgetCheckoutSnapshot(reference: string): void {
  storage()?.removeItem(SNAPSHOT_PREFIX + reference);
}
