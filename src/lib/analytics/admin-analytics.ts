/**
 * Admin analytics aggregation — pure functions over an analytics snapshot.
 *
 * These run locally against the mock store today. When FastAPI is live the same
 * shapes come back from
 *   GET /api/v1/admin/analytics/overview | activity | funnel | sessions
 * so the dashboard components never change.
 *
 * Every metric is explicitly named so nothing on screen is ambiguous:
 * "event count" != "unique sessions" != "unique users".
 */

import { isSessionActive, type AnalyticsSnapshot } from "./analytics-store";
import {
  ANALYTICS_EVENTS,
  FLIGHT_FUNNEL,
  HOTEL_FUNNEL,
  eventVertical,
  type AnalyticsEvent,
  type AnalyticsSessionInfo,
  type FunnelStep,
} from "./events";

export type Vertical = "all" | "flight" | "hotel";
export type Audience = "all" | "guest" | "authenticated";
export type BookingStatusFilter = "all" | "completed" | "failed";

export interface AnalyticsFilters {
  /** Inclusive ISO date (YYYY-MM-DD). */
  from: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  to: string;
  vertical: Vertical;
  audience: Audience;
  /** Exact event name, or "all". */
  eventType: string;
  bookingStatus: BookingStatusFilter;
}

export function defaultFilters(days = 7): AnalyticsFilters {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    vertical: "all",
    audience: "all",
    eventType: "all",
    bookingStatus: "all",
  };
}

function inRange(iso: string, filters: AnalyticsFilters): boolean {
  const day = iso.slice(0, 10);
  return day >= filters.from && day <= filters.to;
}

export function filterEvents(
  snapshot: AnalyticsSnapshot,
  filters: AnalyticsFilters,
): AnalyticsEvent[] {
  return snapshot.events.filter((event) => {
    if (!inRange(event.occurredAt, filters)) return false;
    if (filters.vertical !== "all") {
      const vertical = eventVertical(event.name);
      if (vertical !== filters.vertical && vertical !== "general") return false;
      if (vertical === "general" && filters.eventType === "all") {
        // keep general events (page views, sessions) visible for context
      }
    }
    if (filters.audience === "guest" && event.userId) return false;
    if (filters.audience === "authenticated" && !event.userId) return false;
    if (filters.eventType !== "all" && event.name !== filters.eventType) return false;
    if (filters.bookingStatus === "completed" && !event.name.endsWith("booking_completed")) {
      return false;
    }
    if (filters.bookingStatus === "failed" && !event.name.endsWith("booking_failed")) {
      return false;
    }
    return true;
  });
}

function countBy(events: AnalyticsEvent[], name: string): number {
  return events.filter((event) => event.name === name).length;
}

function uniqueSessions(events: AnalyticsEvent[]): number {
  return new Set(events.map((event) => event.sessionId)).size;
}

function uniqueUsers(events: AnalyticsEvent[]): number {
  return new Set(events.filter((e) => e.userId).map((e) => e.userId as string)).size;
}

export interface OverviewMetrics {
  /** Sessions with activity inside the idle window, right now. */
  activeSessions: number;
  /** Distinct sessions that produced at least one event in range. */
  totalSessions: number;
  /** Distinct signed-in users in range. */
  authenticatedUsers: number;
  /** Distinct sessions with no user id in range. */
  guestSessions: number;
  flightSearches: number;
  hotelSearches: number;
  checkoutsStarted: number;
  paymentsStarted: number;
  paymentsSucceeded: number;
  paymentsFailed: number;
  bookingsCompleted: number;
  bookingsFailed: number;
  /** Sessions that searched but never completed a booking. */
  abandonedSessions: number;
  /** bookingsCompleted / sessions that searched, as a percentage. */
  conversionRate: number;
  /** 100 - conversionRate, over searching sessions. */
  abandonmentRate: number;
  totalEvents: number;
}

export function overview(
  snapshot: AnalyticsSnapshot,
  filters: AnalyticsFilters,
): OverviewMetrics {
  // Metrics are computed over the date range with audience/vertical filters,
  // but ignore `eventType`/`bookingStatus` so the cards stay comparable.
  const scoped = filterEvents(snapshot, {
    ...filters,
    eventType: "all",
    bookingStatus: "all",
  });

  const searchSessions = new Set(
    scoped
      .filter(
        (event) =>
          event.name === ANALYTICS_EVENTS.flightSearch ||
          event.name === ANALYTICS_EVENTS.hotelSearch,
      )
      .map((event) => event.sessionId),
  );
  const bookedSessions = new Set(
    scoped
      .filter(
        (event) =>
          event.name === ANALYTICS_EVENTS.flightBookingCompleted ||
          event.name === ANALYTICS_EVENTS.hotelBookingCompleted,
      )
      .map((event) => event.sessionId),
  );

  const now = Date.now();
  const activeSessions = snapshot.sessions.filter((session) => {
    if (!isSessionActive(session, now)) return false;
    if (filters.audience === "guest" && session.userId) return false;
    if (filters.audience === "authenticated" && !session.userId) return false;
    return true;
  }).length;

  const searching = searchSessions.size;
  const booked = bookedSessions.size;
  const abandoned = Math.max(0, searching - booked);

  return {
    activeSessions,
    totalSessions: uniqueSessions(scoped),
    authenticatedUsers: uniqueUsers(scoped),
    guestSessions: new Set(
      scoped.filter((event) => !event.userId).map((event) => event.sessionId),
    ).size,
    flightSearches: countBy(scoped, ANALYTICS_EVENTS.flightSearch),
    hotelSearches: countBy(scoped, ANALYTICS_EVENTS.hotelSearch),
    checkoutsStarted:
      countBy(scoped, ANALYTICS_EVENTS.flightCheckoutStarted) +
      countBy(scoped, ANALYTICS_EVENTS.hotelCheckoutStarted),
    paymentsStarted:
      countBy(scoped, ANALYTICS_EVENTS.flightPaymentStarted) +
      countBy(scoped, ANALYTICS_EVENTS.hotelPaymentStarted),
    paymentsSucceeded:
      countBy(scoped, ANALYTICS_EVENTS.flightPaymentSuccess) +
      countBy(scoped, ANALYTICS_EVENTS.hotelPaymentSuccess),
    paymentsFailed:
      countBy(scoped, ANALYTICS_EVENTS.flightPaymentFailed) +
      countBy(scoped, ANALYTICS_EVENTS.hotelPaymentFailed),
    bookingsCompleted:
      countBy(scoped, ANALYTICS_EVENTS.flightBookingCompleted) +
      countBy(scoped, ANALYTICS_EVENTS.hotelBookingCompleted),
    bookingsFailed:
      countBy(scoped, ANALYTICS_EVENTS.flightBookingFailed) +
      countBy(scoped, ANALYTICS_EVENTS.hotelBookingFailed),
    abandonedSessions: abandoned,
    conversionRate: searching === 0 ? 0 : Math.round((booked / searching) * 1000) / 10,
    abandonmentRate: searching === 0 ? 0 : Math.round((abandoned / searching) * 1000) / 10,
    totalEvents: scoped.length,
  };
}

/* -------------------------------------------------------------------- */
/* Live activity                                                        */
/* -------------------------------------------------------------------- */

export interface LiveActivityRow {
  sessionId: string;
  /** "Guest" or "User" — no email, no name. */
  identity: "Guest" | "User";
  userIdShort: string | null;
  currentPage: string;
  lastEventName: string | null;
  device: AnalyticsSessionInfo["device"];
  browser: string;
  lastActivityAt: string;
  active: boolean;
}

export function liveActivity(snapshot: AnalyticsSnapshot, limit = 30): LiveActivityRow[] {
  const lastEvent = new Map<string, AnalyticsEvent>();
  for (const event of snapshot.events) lastEvent.set(event.sessionId, event);
  const now = Date.now();

  return [...snapshot.sessions]
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
    .slice(0, limit)
    .map((session) => ({
      sessionId: session.sessionId,
      identity: session.userId ? ("User" as const) : ("Guest" as const),
      userIdShort: session.userId ? `${session.userId.slice(0, 8)}…` : null,
      currentPage: session.currentPage,
      lastEventName: lastEvent.get(session.sessionId)?.name ?? null,
      device: session.device,
      browser: session.browser,
      lastActivityAt: session.lastActivityAt,
      active: isSessionActive(session, now),
    }));
}

/* -------------------------------------------------------------------- */
/* Funnel                                                               */
/* -------------------------------------------------------------------- */

export interface FunnelRow {
  key: string;
  label: string;
  eventCount: number;
  uniqueSessions: number;
  uniqueUsers: number;
  /** % of sessions that reached step 1 and also reached this step. */
  reachedPct: number;
  /** Sessions lost between the previous step and this one. */
  droppedSessions: number;
}

export function funnel(
  snapshot: AnalyticsSnapshot,
  vertical: "flight" | "hotel",
  filters: AnalyticsFilters,
): FunnelRow[] {
  const scoped = filterEvents(snapshot, {
    ...filters,
    vertical: "all",
    eventType: "all",
    bookingStatus: "all",
  });
  const steps: FunnelStep[] = vertical === "flight" ? FLIGHT_FUNNEL : HOTEL_FUNNEL;

  let firstStepSessions = 0;
  let previousSessions = 0;

  return steps.map((step, index) => {
    const matched = scoped.filter((event) =>
      (step.events as readonly string[]).includes(event.name),
    );
    const sessions = uniqueSessions(matched);
    if (index === 0) {
      firstStepSessions = sessions;
      previousSessions = sessions;
    }
    const row: FunnelRow = {
      key: step.key,
      label: step.label,
      eventCount: matched.length,
      uniqueSessions: sessions,
      uniqueUsers: uniqueUsers(matched),
      reachedPct:
        firstStepSessions === 0
          ? 0
          : Math.round((sessions / firstStepSessions) * 1000) / 10,
      droppedSessions: index === 0 ? 0 : Math.max(0, previousSessions - sessions),
    };
    previousSessions = sessions;
    return row;
  });
}

/* -------------------------------------------------------------------- */
/* Time series                                                          */
/* -------------------------------------------------------------------- */

export interface SeriesPoint {
  day: string;
  flightSearches: number;
  hotelSearches: number;
  sessions: number;
  bookings: number;
}

export function dailySeries(
  snapshot: AnalyticsSnapshot,
  filters: AnalyticsFilters,
): SeriesPoint[] {
  const scoped = filterEvents(snapshot, {
    ...filters,
    vertical: "all",
    eventType: "all",
    bookingStatus: "all",
  });
  const days: string[] = [];
  const start = new Date(`${filters.from}T00:00:00Z`);
  const end = new Date(`${filters.to}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }

  return days.map((day) => {
    const dayEvents = scoped.filter((event) => event.occurredAt.slice(0, 10) === day);
    return {
      day,
      flightSearches: countBy(dayEvents, ANALYTICS_EVENTS.flightSearch),
      hotelSearches: countBy(dayEvents, ANALYTICS_EVENTS.hotelSearch),
      sessions: uniqueSessions(dayEvents),
      bookings:
        countBy(dayEvents, ANALYTICS_EVENTS.flightBookingCompleted) +
        countBy(dayEvents, ANALYTICS_EVENTS.hotelBookingCompleted),
    };
  });
}

/* -------------------------------------------------------------------- */
/* Sessions + journey                                                   */
/* -------------------------------------------------------------------- */

export interface SessionRow {
  sessionId: string;
  identity: "Guest" | "User";
  device: AnalyticsSessionInfo["device"];
  browser: string;
  platform: string;
  startedAt: string;
  lastActivityAt: string;
  eventCount: number;
  currentPage: string;
  outcome: "booked" | "payment_failed" | "abandoned" | "browsing";
  active: boolean;
}

function outcomeFor(events: AnalyticsEvent[]): SessionRow["outcome"] {
  const names = new Set(events.map((event) => event.name));
  if (
    names.has(ANALYTICS_EVENTS.flightBookingCompleted) ||
    names.has(ANALYTICS_EVENTS.hotelBookingCompleted)
  ) {
    return "booked";
  }
  if (
    names.has(ANALYTICS_EVENTS.flightPaymentFailed) ||
    names.has(ANALYTICS_EVENTS.hotelPaymentFailed) ||
    names.has(ANALYTICS_EVENTS.flightBookingFailed) ||
    names.has(ANALYTICS_EVENTS.hotelBookingFailed)
  ) {
    return "payment_failed";
  }
  if (names.has(ANALYTICS_EVENTS.flightSearch) || names.has(ANALYTICS_EVENTS.hotelSearch)) {
    return "abandoned";
  }
  return "browsing";
}

export function sessionRows(
  snapshot: AnalyticsSnapshot,
  filters: AnalyticsFilters,
): SessionRow[] {
  const scoped = filterEvents(snapshot, {
    ...filters,
    eventType: "all",
    bookingStatus: "all",
  });
  const bySession = new Map<string, AnalyticsEvent[]>();
  for (const event of scoped) {
    const list = bySession.get(event.sessionId) ?? [];
    list.push(event);
    bySession.set(event.sessionId, list);
  }
  const now = Date.now();

  return snapshot.sessions
    .filter((session) => bySession.has(session.sessionId))
    .map((session) => {
      const events = bySession.get(session.sessionId) ?? [];
      return {
        sessionId: session.sessionId,
        identity: session.userId ? ("User" as const) : ("Guest" as const),
        device: session.device,
        browser: session.browser,
        platform: session.platform,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        eventCount: events.length,
        currentPage: session.currentPage,
        outcome: outcomeFor(events),
        active: isSessionActive(session, now),
      };
    })
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
}

export interface JourneyStep {
  name: string;
  page: string;
  occurredAt: string;
  props: AnalyticsEvent["props"];
}

export function sessionJourney(
  snapshot: AnalyticsSnapshot,
  sessionId: string,
): { session: AnalyticsSessionInfo | null; steps: JourneyStep[] } {
  const session = snapshot.sessions.find((item) => item.sessionId === sessionId) ?? null;
  const steps = snapshot.events
    .filter((event) => event.sessionId === sessionId)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .map((event) => ({
      name: event.name,
      page: event.page,
      occurredAt: event.occurredAt,
      props: event.props,
    }));
  return { session, steps };
}
