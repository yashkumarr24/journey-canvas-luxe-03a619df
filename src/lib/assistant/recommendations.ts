/**
 * Recommendation layer (PHASE 12).
 *
 * Every recommendation is derived from flight results that the backend already
 * returned. Nothing here invents a price, a duration, a stop count, a schedule
 * or an airline: when the data is missing from a result, that recommendation is
 * simply not offered.
 */

import { minutesFromMidnight, totalDurationMinutes, totalStops } from "@/lib/flight-search";
import type { FlightRecommendation, TimeWindow, TravelRequirements } from "@/types/assistant";
import type { FlightResult } from "@/types/booking";

const WINDOWS: Record<TimeWindow, [number, number]> = {
  early_morning: [0, 6 * 60],
  morning: [6 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 21 * 60],
  night: [21 * 60, 24 * 60],
};

function outbound(result: FlightResult) {
  return result.itineraries.find((i) => i.direction === "outbound") ?? result.itineraries[0];
}

function departureMinutes(result: FlightResult): number | undefined {
  const leg = outbound(result);
  return minutesFromMidnight(leg?.segments[0]?.departureAt);
}

function arrivalMinutes(result: FlightResult): number | undefined {
  const leg = outbound(result);
  const segments = leg?.segments ?? [];
  return minutesFromMidnight(segments[segments.length - 1]?.arrivalAt);
}

function inWindow(minutes: number | undefined, window: TimeWindow): boolean {
  if (minutes === undefined) return false;
  const [from, to] = WINDOWS[window];
  return minutes >= from && minutes < to;
}

function airlineNames(result: FlightResult): string[] {
  const names = new Set<string>();
  if (result.validatingAirline?.name) names.add(result.validatingAirline.name);
  for (const itinerary of result.itineraries) {
    for (const segment of itinerary.segments) {
      if (segment.airline?.name) names.add(segment.airline.name);
      if (segment.airline?.code) names.add(segment.airline.code);
    }
  }
  return [...names];
}

function money(result: FlightResult): number | undefined {
  const amount = result.fare?.totalPrice?.amount;
  return typeof amount === "number" ? amount : undefined;
}

function formatPrice(result: FlightResult): string {
  const amount = money(result);
  if (amount === undefined) return "the fare shown";
  const currency = result.fare?.totalPrice?.currency ?? "INR";
  return `${currency} ${amount.toLocaleString()}`;
}

function formatDurationShort(minutes?: number): string {
  if (minutes === undefined) return "the duration shown";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Rank the ACTUAL results. Returns at most one recommendation per key and never
 * repeats the same result twice.
 */
export function buildRecommendations(
  results: FlightResult[],
  requirements: TravelRequirements,
): FlightRecommendation[] {
  if (results.length === 0) return [];

  const recommendations: FlightRecommendation[] = [];
  const used = new Set<string>();

  const push = (rec: FlightRecommendation | null) => {
    if (!rec || used.has(rec.resultId)) return;
    used.add(rec.resultId);
    recommendations.push(rec);
  };

  const priced = results.filter((r) => money(r) !== undefined);
  if (priced.length > 0) {
    const cheapest = priced.reduce((a, b) => (money(a)! <= money(b)! ? a : b));
    push({
      key: "cheapest",
      label: "Lowest fare",
      reason: `Cheapest option in these results at ${formatPrice(cheapest)}.`,
      resultId: cheapest.id,
    });
  }

  const timed = results.filter((r) => totalDurationMinutes(r) !== undefined);
  if (timed.length > 0) {
    const fastest = timed.reduce((a, b) =>
      totalDurationMinutes(a)! <= totalDurationMinutes(b)! ? a : b,
    );
    push({
      key: "fastest",
      label: "Shortest travel time",
      reason: `Total journey time of ${formatDurationShort(totalDurationMinutes(fastest))}.`,
      resultId: fastest.id,
    });
  }

  const withStops = results.filter((r) => totalStops(r) !== undefined);
  if (withStops.length > 0) {
    const fewest = withStops.reduce((a, b) => (totalStops(a)! <= totalStops(b)! ? a : b));
    const stops = totalStops(fewest)!;
    push({
      key: stops === 0 ? "non_stop" : "fewest_stops",
      label: stops === 0 ? "Non-stop" : "Fewest stops",
      reason:
        stops === 0
          ? "Flies non-stop, as returned by the search."
          : `Has the fewest stops in these results (${stops}).`,
      resultId: fewest.id,
    });
  }

  if (requirements.preferredDepartureWindow) {
    const window = requirements.preferredDepartureWindow;
    const match = results.find((r) => inWindow(departureMinutes(r), window));
    if (match) {
      push({
        key: "preferred_departure",
        label: "Matches your preferred departure time",
        reason: `Departs within the ${window.replace("_", " ")} window you asked for.`,
        resultId: match.id,
      });
    }
  }

  if (requirements.preferredArrivalWindow) {
    const window = requirements.preferredArrivalWindow;
    const match = results.find((r) => inWindow(arrivalMinutes(r), window));
    if (match) {
      push({
        key: "preferred_arrival",
        label: "Matches your preferred arrival time",
        reason: `Arrives within the ${window.replace("_", " ")} window you asked for.`,
        resultId: match.id,
      });
    }
  }

  for (const preferred of requirements.preferredAirlines ?? []) {
    const needle = preferred.toLowerCase();
    const match = results.find((r) =>
      airlineNames(r).some((name) => name.toLowerCase().includes(needle)),
    );
    if (match) {
      push({
        key: "preferred_airline",
        label: `Your preferred airline`,
        reason: `${preferred} appears on this itinerary in the search results.`,
        resultId: match.id,
      });
      break;
    }
  }

  return recommendations;
}

/** Filter helper: applies only preferences that real result data can answer. */
export function applyPreferenceFilters(
  results: FlightResult[],
  requirements: TravelRequirements,
): FlightResult[] {
  let filtered = results;
  if (requirements.nonStopOnly) {
    const nonStop = filtered.filter((r) => totalStops(r) === 0);
    if (nonStop.length > 0) filtered = nonStop;
  }
  if (requirements.preferredDepartureWindow) {
    const window = requirements.preferredDepartureWindow;
    const inPreferred = filtered.filter((r) => inWindow(departureMinutes(r), window));
    if (inPreferred.length > 0) filtered = inPreferred;
  }
  return filtered;
}
