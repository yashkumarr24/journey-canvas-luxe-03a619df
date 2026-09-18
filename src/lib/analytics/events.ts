/**
 * Analytics event taxonomy — the single source of truth.
 *
 * Only meaningful business events live here. No mouse moves, no scroll spam,
 * no keystrokes. Every event is safe to store: names are fixed constants and
 * properties are sanitised (see `sanitizeProps`) before they leave the browser.
 *
 * NEVER add an event or property that could carry a password, OTP, card
 * number, CVV, API key, full email address or phone number.
 */

export const ANALYTICS_EVENTS = {
  /* ---- general ------------------------------------------------------- */
  sessionStarted: "session_started",
  sessionEnded: "session_ended",
  pageViewed: "page_viewed",
  sessionHeartbeat: "session_heartbeat",

  /* ---- flights ------------------------------------------------------- */
  flightSearch: "flight_search",
  flightResultsViewed: "flight_results_viewed",
  flightFilterUsed: "flight_filter_used",
  flightSelected: "flight_selected",
  flightReviewStarted: "flight_review_started",
  travellerDetailsStarted: "flight_traveller_details_started",
  travellerDetailsCompleted: "flight_traveller_details_completed",
  flightCheckoutStarted: "flight_checkout_started",
  flightPaymentStarted: "flight_payment_started",
  flightPaymentSuccess: "flight_payment_success",
  flightPaymentFailed: "flight_payment_failed",
  flightBookingCompleted: "flight_booking_completed",
  flightBookingFailed: "flight_booking_failed",

  /* ---- hotels -------------------------------------------------------- */
  hotelSearch: "hotel_search",
  hotelResultsViewed: "hotel_results_viewed",
  hotelFilterUsed: "hotel_filter_used",
  hotelViewed: "hotel_viewed",
  hotelRoomSelected: "hotel_room_selected",
  hotelReviewStarted: "hotel_review_started",
  hotelGuestDetailsStarted: "hotel_guest_details_started",
  hotelGuestDetailsCompleted: "hotel_guest_details_completed",
  hotelCheckoutStarted: "hotel_checkout_started",
  hotelPaymentStarted: "hotel_payment_started",
  hotelPaymentSuccess: "hotel_payment_success",
  hotelPaymentFailed: "hotel_payment_failed",
  hotelBookingCompleted: "hotel_booking_completed",
  hotelBookingFailed: "hotel_booking_failed",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export type AnalyticsPropValue = string | number | boolean | null;
export type AnalyticsProps = Record<string, AnalyticsPropValue>;

export interface AnalyticsEventInput {
  name: AnalyticsEventName;
  /** Normalised page key, e.g. "flight_checkout". Defaults to current page. */
  page?: string;
  props?: AnalyticsProps;
}

export interface AnalyticsEvent {
  id: string;
  sessionId: string;
  userId: string | null;
  name: AnalyticsEventName;
  page: string;
  props: AnalyticsProps;
  occurredAt: string;
}

export type DeviceCategory = "desktop" | "tablet" | "mobile";

export interface AnalyticsSessionInfo {
  sessionId: string;
  userId: string | null;
  startedAt: string;
  lastActivityAt: string;
  currentPage: string;
  device: DeviceCategory;
  browser: string;
  platform: string;
  status: "active" | "idle" | "ended";
  /** Only set for mock/demo sessions created by the test seeder. */
  synthetic?: boolean;
}

/* -------------------------------------------------------------------- */
/* Funnels                                                              */
/* -------------------------------------------------------------------- */

export interface FunnelStep {
  key: string;
  label: string;
  events: AnalyticsEventName[];
}

export const FLIGHT_FUNNEL: FunnelStep[] = [
  { key: "search", label: "Search", events: [ANALYTICS_EVENTS.flightSearch] },
  { key: "results", label: "Results", events: [ANALYTICS_EVENTS.flightResultsViewed] },
  { key: "selection", label: "Selection", events: [ANALYTICS_EVENTS.flightSelected] },
  { key: "review", label: "Review", events: [ANALYTICS_EVENTS.flightReviewStarted] },
  {
    key: "travellers",
    label: "Traveller details",
    events: [ANALYTICS_EVENTS.travellerDetailsCompleted],
  },
  { key: "checkout", label: "Checkout", events: [ANALYTICS_EVENTS.flightCheckoutStarted] },
  { key: "payment", label: "Payment", events: [ANALYTICS_EVENTS.flightPaymentStarted] },
  { key: "booking", label: "Booking", events: [ANALYTICS_EVENTS.flightBookingCompleted] },
];

export const HOTEL_FUNNEL: FunnelStep[] = [
  { key: "search", label: "Search", events: [ANALYTICS_EVENTS.hotelSearch] },
  { key: "results", label: "Results", events: [ANALYTICS_EVENTS.hotelResultsViewed] },
  {
    key: "selection",
    label: "Hotel / room selection",
    events: [ANALYTICS_EVENTS.hotelRoomSelected],
  },
  { key: "review", label: "Review", events: [ANALYTICS_EVENTS.hotelReviewStarted] },
  {
    key: "guests",
    label: "Guest details",
    events: [ANALYTICS_EVENTS.hotelGuestDetailsCompleted],
  },
  { key: "checkout", label: "Checkout", events: [ANALYTICS_EVENTS.hotelCheckoutStarted] },
  { key: "payment", label: "Payment", events: [ANALYTICS_EVENTS.hotelPaymentStarted] },
  { key: "booking", label: "Booking", events: [ANALYTICS_EVENTS.hotelBookingCompleted] },
];

const FLIGHT_EVENTS = new Set<string>(
  Object.values(ANALYTICS_EVENTS).filter((name) => name.startsWith("flight_")),
);
const HOTEL_EVENTS = new Set<string>(
  Object.values(ANALYTICS_EVENTS).filter((name) => name.startsWith("hotel_")),
);

export function eventVertical(name: string): "flight" | "hotel" | "general" {
  if (FLIGHT_EVENTS.has(name)) return "flight";
  if (HOTEL_EVENTS.has(name)) return "hotel";
  return "general";
}

/** Human label for dashboards. */
export function eventLabel(name: string): string {
  return name
    .replace(/^flight_/, "Flight ")
    .replace(/^hotel_/, "Hotel ")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/* -------------------------------------------------------------------- */
/* Page keys                                                            */
/* -------------------------------------------------------------------- */

/** Route path -> stable page key. Unknown paths collapse to "other". */
export function pageKeyFromPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  const map: Record<string, string> = {
    "/": "home",
    "/flights": "flights",
    "/flights/review": "flight_review",
    "/flights/checkout": "flight_checkout",
    "/flights/confirmation": "flight_confirmation",
    "/hotels": "hotels",
    "/hotels/detail": "hotel_details",
    "/hotels/review": "hotel_review",
    "/hotels/checkout": "hotel_checkout",
    "/hotels/confirmation": "hotel_confirmation",
    "/about": "about",
    "/contact": "contact",
    "/domestic": "domestic",
    "/international": "international",
  };
  if (map[path]) return map[path];
  if (path.startsWith("/account")) return "account";
  if (path.startsWith("/auth")) return "auth";
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/blog")) return "blog";
  if (path.startsWith("/destinations")) return "destination";
  return "other";
}

export function pageLabel(pageKey: string): string {
  const labels: Record<string, string> = {
    home: "Home",
    flights: "Flight search",
    flight_results: "Flight results",
    flight_review: "Flight review",
    flight_checkout: "Flight checkout",
    flight_confirmation: "Flight confirmation",
    hotels: "Hotel search",
    hotel_details: "Hotel details",
    hotel_review: "Hotel review",
    hotel_checkout: "Hotel checkout",
    hotel_confirmation: "Hotel confirmation",
    account: "Account",
    auth: "Sign in",
    admin: "Admin",
    blog: "Blog",
    destination: "Destination",
    about: "About",
    contact: "Contact",
    domestic: "Domestic",
    international: "International",
    other: "Other",
  };
  return labels[pageKey] ?? pageKey;
}

/* -------------------------------------------------------------------- */
/* Sanitisation                                                          */
/* -------------------------------------------------------------------- */

/** Property keys that must never be stored, whatever a caller passes. */
const BLOCKED_KEY = /pass|pwd|otp|cvv|card|secret|apikey|api_key|token|auth|email|phone|mobile|pan|passport|dob|address|name$/i;

const MAX_KEYS = 20;
const MAX_STRING = 120;

/**
 * Drops forbidden keys, caps size and coerces values to primitives. Applied to
 * every event before it is queued, so a mistake at a call site cannot leak PII.
 */
export function sanitizeProps(props?: AnalyticsProps): AnalyticsProps {
  if (!props) return {};
  const out: AnalyticsProps = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(props)) {
    if (count >= MAX_KEYS) break;
    const key = rawKey.slice(0, 40);
    if (BLOCKED_KEY.test(key)) continue;
    if (rawValue === null || rawValue === undefined) {
      out[key] = null;
    } else if (typeof rawValue === "number") {
      out[key] = Number.isFinite(rawValue) ? rawValue : null;
    } else if (typeof rawValue === "boolean") {
      out[key] = rawValue;
    } else if (typeof rawValue === "string") {
      out[key] = rawValue.slice(0, MAX_STRING);
    } else {
      continue;
    }
    count += 1;
  }
  return out;
}
