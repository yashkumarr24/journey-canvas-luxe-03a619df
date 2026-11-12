/**
 * Local continuity for the hotel journey.
 *
 * Mirrors `review-session.ts` / `checkout-session.ts` for flights:
 *
 *  - the guest token that authorises a review token or a booking reference
 *    (issued by the server, never in a URL). The review token stays in
 *    sessionStorage; the booking pass is kept in localStorage for 48 hours,
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

/** How long the booking access pass survives app closure (iOS may end the WebView). */
export const HOTEL_BOOKING_PASS_TTL_MS = 48 * 60 * 60 * 1000;

function persistentStorage(): Storage | null {
  // Only the server-issued booking pass lives here so it survives app closure.
  // Guest names/contact (the snapshot) stay in sessionStorage.
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface StoredBookingPass {
  token: string;
  expiresAt: number;
}

function parsePass(raw: string | null): StoredBookingPass | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredBookingPass>;
    if (typeof value.token !== "string" || !value.token) return null;
    if (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) return null;
    return { token: value.token, expiresAt: value.expiresAt };
  } catch {
    return null;
  }
}

/** Remove every expired or unreadable hotel booking pass. Never throws. */
export function purgeExpiredHotelBookingPasses(now: number = Date.now()): void {
  const store = persistentStorage();
  if (!store) return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(BOOKING_GUEST_PREFIX)) continue;
      const pass = parsePass(store.getItem(key));
      if (!pass || pass.expiresAt <= now) stale.push(key);
    }
    stale.forEach((key) => store.removeItem(key));
  } catch {
    // Storage failures must never break the booking flow.
  }
}

export function rememberHotelBookingGuestToken(
  reference: string,
  guestToken?: string | null,
  now: number = Date.now(),
): void {
  if (!guestToken) return;
  purgeExpiredHotelBookingPasses(now);
  const pass: StoredBookingPass = { token: guestToken, expiresAt: now + HOTEL_BOOKING_PASS_TTL_MS };
  try {
    const store = persistentStorage();
    if (!store) throw new Error("no persistent storage");
    store.setItem(BOOKING_GUEST_PREFIX + reference, JSON.stringify(pass));
    storage()?.removeItem(BOOKING_GUEST_PREFIX + reference);
  } catch {
    // Quota or private-mode failure: keep the tab-only copy, as before.
    try {
      storage()?.setItem(BOOKING_GUEST_PREFIX + reference, guestToken);
    } catch {
      /* ignore */
    }
  }
}

/**
 * The server-issued pass for this booking, or null when missing or expired.
 * The pass only lets the server decide; it never authorises anything itself.
 */
export function readHotelBookingGuestToken(reference: string, now: number = Date.now()): string | null {
  const key = BOOKING_GUEST_PREFIX + reference;
  const store = persistentStorage();
  try {
    const raw = store?.getItem(key) ?? null;
    const pass = parsePass(raw);
    if (pass && pass.expiresAt > now) return pass.token;
    if (raw != null) store?.removeItem(key);
  } catch {
    /* fall through to the tab-only copy */
  }
  // Tab-only copies written before this change stay readable in this tab.
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function forgetHotelBookingGuestToken(reference: string): void {
  try {
    persistentStorage()?.removeItem(BOOKING_GUEST_PREFIX + reference);
    storage()?.removeItem(BOOKING_GUEST_PREFIX + reference);
  } catch {
    /* ignore */
  }
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
