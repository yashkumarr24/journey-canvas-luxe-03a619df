/**
 * Analytics API boundary.
 *
 * Components never call this directly — they use `useAnalytics()` from
 * `tracker.tsx`. This module decides WHERE events go:
 *
 *   configured backend :  POST {VITE_BOOKING_API_URL}/api/v1/analytics/*
 *   otherwise (now)     :  local mock store (analytics-store.ts)
 *
 * Contract with FastAPI (see backend/app/api/v1/analytics.py):
 *   POST /api/v1/analytics/session       -> register/refresh a session
 *   POST /api/v1/analytics/events        -> batch of events
 *   POST /api/v1/analytics/session/end   -> mark a session ended
 *
 * Every function resolves — it NEVER throws and never surfaces an error to the
 * customer. Analytics failures are invisible by design.
 */

import { bookingApiBaseUrl, isBookingApiConfigured } from "@/lib/booking-api";

import type { AnalyticsEvent, AnalyticsSessionInfo } from "./events";
import * as store from "./analytics-store";

/** True while analytics is served by the local mock sink. */
export const useMockAnalytics =
  !isBookingApiConfigured || import.meta.env.VITE_ANALYTICS_TEST_MODE === "true";

const TIMEOUT_MS = 4000;

async function post(path: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(`${bookingApiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      // Analytics is fire-and-forget; it must not carry auth cookies.
      credentials: "omit",
      keepalive: true,
    });
  } catch {
    /* offline, blocked, aborted — silently ignored */
  } finally {
    clearTimeout(timer);
  }
}

export const analyticsApi = {
  /** Register or refresh a session. */
  async startSession(session: AnalyticsSessionInfo): Promise<void> {
    if (useMockAnalytics) {
      store.upsertSession(session);
      return;
    }
    await post("/api/v1/analytics/session", session);
  },

  /** Send a batch of events. */
  async trackEvents(events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;
    if (useMockAnalytics) {
      store.appendEvents(events);
      return;
    }
    await post("/api/v1/analytics/events", { events });
  },

  /** Update the current page / last-activity marker. */
  async touchSession(sessionId: string, currentPage: string, userId: string | null): Promise<void> {
    if (useMockAnalytics) {
      store.patchSession(sessionId, {
        currentPage,
        userId,
        lastActivityAt: new Date().toISOString(),
        status: "active",
      });
      return;
    }
    await post("/api/v1/analytics/session", { sessionId, currentPage, userId });
  },

  /** Mark a session as ended (best effort, runs during page hide). */
  endSession(sessionId: string): void {
    if (useMockAnalytics) {
      store.endSession(sessionId);
      return;
    }
    const payload = JSON.stringify({ sessionId });
    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          `${bookingApiBaseUrl}/api/v1/analytics/session/end`,
          new Blob([payload], { type: "application/json" }),
        );
        return;
      }
    } catch {
      /* fall through */
    }
    void post("/api/v1/analytics/session/end", { sessionId });
  },
};
