/**
 * Demo activity generator — local testing only.
 *
 * Creates synthetic sessions (guest + authenticated, flights + hotels, booked /
 * failed / abandoned) so the admin dashboard, funnel and journey views can be
 * verified without ten people browsing the site.
 *
 * These rows are analytics only: no bookings, no payments, no provider calls,
 * no rows in any real business table. Every session is flagged `synthetic` and
 * can be cleared with one button.
 */

import { appendEvents, readStore, replaceStore, upsertSession } from "./analytics-store";
import {
  ANALYTICS_EVENTS,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsSessionInfo,
  type DeviceCategory,
} from "./events";

type Scenario = "flight_booked" | "flight_failed" | "hotel_booked" | "hotel_abandoned" | "browsing";

const SCENARIOS: Record<Scenario, { page: string; name: AnalyticsEventName }[]> = {
  flight_booked: [
    { page: "home", name: ANALYTICS_EVENTS.pageViewed },
    { page: "flights", name: ANALYTICS_EVENTS.flightSearch },
    { page: "flights", name: ANALYTICS_EVENTS.flightResultsViewed },
    { page: "flights", name: ANALYTICS_EVENTS.flightSelected },
    { page: "flight_review", name: ANALYTICS_EVENTS.flightReviewStarted },
    { page: "flight_review", name: ANALYTICS_EVENTS.travellerDetailsStarted },
    { page: "flight_review", name: ANALYTICS_EVENTS.travellerDetailsCompleted },
    { page: "flight_checkout", name: ANALYTICS_EVENTS.flightCheckoutStarted },
    { page: "flight_checkout", name: ANALYTICS_EVENTS.flightPaymentStarted },
    { page: "flight_checkout", name: ANALYTICS_EVENTS.flightPaymentSuccess },
    { page: "flight_confirmation", name: ANALYTICS_EVENTS.flightBookingCompleted },
  ],
  flight_failed: [
    { page: "flights", name: ANALYTICS_EVENTS.flightSearch },
    { page: "flights", name: ANALYTICS_EVENTS.flightResultsViewed },
    { page: "flights", name: ANALYTICS_EVENTS.flightSelected },
    { page: "flight_review", name: ANALYTICS_EVENTS.flightReviewStarted },
    { page: "flight_checkout", name: ANALYTICS_EVENTS.flightCheckoutStarted },
    { page: "flight_checkout", name: ANALYTICS_EVENTS.flightPaymentStarted },
    { page: "flight_checkout", name: ANALYTICS_EVENTS.flightPaymentFailed },
    { page: "flight_checkout", name: ANALYTICS_EVENTS.flightBookingFailed },
  ],
  hotel_booked: [
    { page: "hotels", name: ANALYTICS_EVENTS.hotelSearch },
    { page: "hotels", name: ANALYTICS_EVENTS.hotelResultsViewed },
    { page: "hotel_details", name: ANALYTICS_EVENTS.hotelViewed },
    { page: "hotel_details", name: ANALYTICS_EVENTS.hotelRoomSelected },
    { page: "hotel_review", name: ANALYTICS_EVENTS.hotelReviewStarted },
    { page: "hotel_review", name: ANALYTICS_EVENTS.hotelGuestDetailsCompleted },
    { page: "hotel_checkout", name: ANALYTICS_EVENTS.hotelCheckoutStarted },
    { page: "hotel_checkout", name: ANALYTICS_EVENTS.hotelPaymentStarted },
    { page: "hotel_checkout", name: ANALYTICS_EVENTS.hotelPaymentSuccess },
    { page: "hotel_confirmation", name: ANALYTICS_EVENTS.hotelBookingCompleted },
  ],
  hotel_abandoned: [
    { page: "hotels", name: ANALYTICS_EVENTS.hotelSearch },
    { page: "hotels", name: ANALYTICS_EVENTS.hotelResultsViewed },
    { page: "hotels", name: ANALYTICS_EVENTS.hotelFilterUsed },
    { page: "hotel_details", name: ANALYTICS_EVENTS.hotelViewed },
    { page: "hotel_details", name: ANALYTICS_EVENTS.hotelRoomSelected },
  ],
  browsing: [
    { page: "home", name: ANALYTICS_EVENTS.pageViewed },
    { page: "domestic", name: ANALYTICS_EVENTS.pageViewed },
    { page: "about", name: ANALYTICS_EVENTS.pageViewed },
  ],
};

const DEVICES: DeviceCategory[] = ["desktop", "mobile", "tablet"];
const ROUTES = [
  { origin: "DEL", destination: "GOI" },
  { origin: "BOM", destination: "DXB" },
  { origin: "BLR", destination: "SIN" },
];
const CITIES = ["Goa", "Udaipur", "Manali", "Dubai"];

function rnd<T>(items: T[], index: number): T {
  return items[index % items.length];
}

function idFor(prefix: string, index: number, salt: number): string {
  return `${prefix}_demo${salt.toString(36)}${index.toString(36)}`;
}

interface SeedOptions {
  /** How many synthetic sessions to create. */
  sessions?: number;
  /** Spread events across this many past days. */
  days?: number;
}

/** Adds synthetic sessions to the local store. Returns how many were added. */
export function seedDemoActivity({ sessions = 12, days = 7 }: SeedOptions = {}): number {
  const salt = Date.now() % 100000;
  const scenarios = Object.keys(SCENARIOS) as Scenario[];
  const newSessions: AnalyticsSessionInfo[] = [];
  const newEvents: AnalyticsEvent[] = [];

  for (let i = 0; i < sessions; i += 1) {
    const scenario = rnd(scenarios, i);
    const steps = SCENARIOS[scenario];
    const sessionId = idFor("ses", i, salt);
    const authenticated = i % 3 === 0;
    const dayOffset = i % days;
    const start = new Date(Date.now() - dayOffset * 86_400_000 - (i % 6) * 900_000);

    steps.forEach((step, stepIndex) => {
      const occurredAt = new Date(start.getTime() + stepIndex * 45_000).toISOString();
      const props: AnalyticsEvent["props"] = { demo: true };
      if (step.name === ANALYTICS_EVENTS.flightSearch) {
        const route = rnd(ROUTES, i);
        props.origin = route.origin;
        props.destination = route.destination;
        props.adults = 1 + (i % 3);
        props.cabinClass = "economy";
      }
      if (step.name === ANALYTICS_EVENTS.hotelSearch) {
        props.destination = rnd(CITIES, i);
        props.rooms = 1 + (i % 2);
        props.adults = 2;
        props.children = i % 2;
      }
      newEvents.push({
        id: idFor("evt", i * 100 + stepIndex, salt),
        sessionId,
        userId: authenticated ? `demo-user-${(i % 4) + 1}` : null,
        name: step.name,
        page: step.page,
        props,
        occurredAt,
      });
    });

    const lastEvent = newEvents[newEvents.length - 1];
    newSessions.push({
      sessionId,
      userId: authenticated ? `demo-user-${(i % 4) + 1}` : null,
      startedAt: start.toISOString(),
      lastActivityAt: lastEvent.occurredAt,
      currentPage: lastEvent.page,
      device: rnd(DEVICES, i),
      browser: rnd(["Chrome", "Safari", "Firefox"], i),
      platform: rnd(["Windows", "Android", "iOS", "macOS"], i),
      status: dayOffset === 0 && i % 4 === 0 ? "active" : "ended",
      synthetic: true,
    });
  }

  newSessions.forEach(upsertSession);
  appendEvents(newEvents);
  return newSessions.length;
}

/** Removes only the synthetic rows, keeping real local activity intact. */
export function clearDemoActivity(): void {
  const snapshot = readStore();
  const syntheticIds = new Set(
    snapshot.sessions.filter((session) => session.synthetic).map((s) => s.sessionId),
  );
  replaceStore({
    sessions: snapshot.sessions.filter((session) => !session.synthetic),
    events: snapshot.events.filter((event) => !syntheticIds.has(event.sessionId)),
  });
}
