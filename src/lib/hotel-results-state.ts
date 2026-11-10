/**
 * Browser-only memory for the hotel results journey. Stores search criteria
 * (destination, dates, occupancy — never guest identity) and the visitor's
 * own filter/sort/scroll choices so Back and refresh return to the same view.
 * Prices and results are never stored here; they always come from the server.
 */
import { hotelSearchSchema, type HotelSearchFormValues } from "@/lib/hotel-search";
import type { HotelFilters, HotelSortKey } from "@/types/booking";

const RECENT_KEY = "fnf-recent-hotel-search";
const VIEW_PREFIX = "fnf-hotel-view:";
const LAST_RESULTS_KEY = "fnf-hotel-last-results";

function store(kind: "local" | "session"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function rememberRecentHotelSearch(values: HotelSearchFormValues) {
  store("local")?.setItem(RECENT_KEY, JSON.stringify(values));
}

/** Most recent valid search whose check-in has not passed, else null. */
export function readRecentHotelSearch(): HotelSearchFormValues | null {
  try {
    const raw = store("local")?.getItem(RECENT_KEY);
    if (!raw) return null;
    const parsed = hotelSearchSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (parsed.data.checkIn < todayISO()) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export interface HotelResultsView {
  filters: HotelFilters;
  sort: HotelSortKey;
  scrollY: number;
}

export function saveHotelResultsView(searchId: string, view: HotelResultsView) {
  store("session")?.setItem(VIEW_PREFIX + searchId, JSON.stringify(view));
}

export function readHotelResultsView(searchId: string): HotelResultsView | null {
  try {
    const raw = store("session")?.getItem(VIEW_PREFIX + searchId);
    return raw ? (JSON.parse(raw) as HotelResultsView) : null;
  } catch {
    return null;
  }
}

/** URL search params of the last results page, for the detail page's Back link. */
export function rememberLastResults(search: Record<string, unknown>) {
  store("session")?.setItem(LAST_RESULTS_KEY, JSON.stringify(search));
}

export function readLastResults(): Record<string, unknown> | null {
  try {
    const raw = store("session")?.getItem(LAST_RESULTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* Sign-in prompt pacing: once per session, and not within 24h of a dismissal. */
const PROMPT_SHOWN = "fnf-signin-prompt-shown";
const PROMPT_DISMISSED = "fnf-signin-prompt-dismissed-at";
export const SIGNIN_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function shouldShowSignInPrompt(now: number, shownThisSession: boolean, dismissedAt: number | null) {
  if (shownThisSession) return false;
  if (dismissedAt !== null && now - dismissedAt < SIGNIN_PROMPT_COOLDOWN_MS) return false;
  return true;
}

export function signInPromptAllowed(now = Date.now()) {
  const shown = store("session")?.getItem(PROMPT_SHOWN) === "1";
  const raw = store("local")?.getItem(PROMPT_DISMISSED);
  const dismissedAt = raw ? Number(raw) : null;
  return shouldShowSignInPrompt(now, shown, Number.isFinite(dismissedAt) ? dismissedAt : null);
}

export function markSignInPromptShown() {
  store("session")?.setItem(PROMPT_SHOWN, "1");
}

export function markSignInPromptDismissed(now = Date.now()) {
  store("local")?.setItem(PROMPT_DISMISSED, String(now));
}
