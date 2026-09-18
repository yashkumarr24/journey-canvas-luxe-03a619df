/**
 * Local continuity for the hotel journey.
 *
 * Mirrors `review-session.ts` / `checkout-session.ts` for flights:
 *
 *  - the guest token that authorises a review token or a booking reference
 *    (issued by the server, kept in sessionStorage, never in a URL),
 *  - a read-only SNAPSHOT of what the customer already saw on the review page.
 *
 * The snapshot is presentation-only. It is never sent back as an amount and is
 * never trusted for payment: the payable total always comes from the server
 * (or, until the backend endpoints exist, from the mock provider which derives
 * it from this same snapshot).
 */

import type {
  FareBreakdownLine,
  HotelContactInput,
  HotelGuestInput,
  HotelRoomOption,
  HotelStay,
  HotelSummary,
  Money,
  PriceChange,
} from "@/types/booking";

const REVIEW_GUEST_PREFIX = "fnf.hotelGuestToken.";
const BOOKING_GUEST_PREFIX = "fnf.hotelBookingGuest.";
const SNAPSHOT_PREFIX = "fnf.hotelSnapshot.";

export interface HotelCheckoutSnapshot {
  bookingReference: string;
  hotel: HotelSummary;
  room: HotelRoomOption;
  stay: HotelStay;
  breakdown: FareBreakdownLine[];
  totalPayable: Money;
  guests: HotelGuestInput[];
  contact: HotelContactInput;
  specialRequests?: string;
  priceChange?: PriceChange;
  expiresAt?: string;
}

function storage(): Storage | null {
  // SSR has no sessionStorage, and Safari private mode can throw on access.
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberHotelGuestToken(reviewToken: string, guestToken?: string | null): void {
  if (!guestToken) return;
  storage()?.setItem(REVIEW_GUEST_PREFIX + reviewToken, guestToken);
}

export function readHotelGuestToken(reviewToken: string): string | null {
  return storage()?.getItem(REVIEW_GUEST_PREFIX + reviewToken) ?? null;
}

export function rememberHotelBookingGuestToken(reference: string, guestToken?: string | null): void {
  if (!guestToken) return;
  storage()?.setItem(BOOKING_GUEST_PREFIX + reference, guestToken);
}

export function readHotelBookingGuestToken(reference: string): string | null {
  return storage()?.getItem(BOOKING_GUEST_PREFIX + reference) ?? null;
}

export function saveHotelSnapshot(snapshot: HotelCheckoutSnapshot): void {
  try {
    storage()?.setItem(SNAPSHOT_PREFIX + snapshot.bookingReference, JSON.stringify(snapshot));
  } catch {
    // Quota or private-mode failures must never break the booking flow.
  }
}

export function readHotelSnapshot(reference: string): HotelCheckoutSnapshot | null {
  const raw = storage()?.getItem(SNAPSHOT_PREFIX + reference);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HotelCheckoutSnapshot;
  } catch {
    return null;
  }
}

export function forgetHotelSnapshot(reference: string): void {
  storage()?.removeItem(SNAPSHOT_PREFIX + reference);
}
