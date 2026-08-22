/**
 * Filtering and sorting for normalized flight results.
 * Pure functions over API data — nothing is hardcoded or fabricated.
 */

import type { FlightFilters, FlightResult, FlightSortKey } from "@/types/booking";
import { minutesFromMidnight, totalDurationMinutes, totalStops } from "@/lib/flight-search";

function outbound(result: FlightResult) {
  return result.itineraries.find((i) => i.direction === "outbound") ?? result.itineraries[0];
}

function firstDeparture(result: FlightResult): number | undefined {
  return minutesFromMidnight(outbound(result)?.segments[0]?.departureAt);
}

function lastArrival(result: FlightResult): number | undefined {
  const segments = outbound(result)?.segments ?? [];
  return minutesFromMidnight(segments[segments.length - 1]?.arrivalAt);
}

export function resultAirlines(result: FlightResult): string[] {
  const codes = new Set<string>();
  if (result.validatingAirline?.code) codes.add(result.validatingAirline.code);
  for (const itinerary of result.itineraries) {
    for (const segment of itinerary.segments) {
      if (segment.airline?.code) codes.add(segment.airline.code);
    }
  }
  return [...codes];
}

/** Airline options present in the current result set, for the filter UI. */
export function collectAirlines(results: FlightResult[]): { code: string; name?: string }[] {
  const map = new Map<string, { code: string; name?: string }>();
  for (const result of results) {
    for (const itinerary of result.itineraries) {
      for (const segment of itinerary.segments) {
        const code = segment.airline?.code;
        if (code && !map.has(code)) map.set(code, { code, name: segment.airline?.name });
      }
    }
  }
  return [...map.values()].sort((a, b) => (a.name ?? a.code).localeCompare(b.name ?? b.code));
}

export function priceRange(results: FlightResult[]): [number, number] | null {
  const prices = results
    .map((r) => r.fare?.totalPrice?.amount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (prices.length === 0) return null;
  return [Math.min(...prices), Math.max(...prices)];
}

function withinWindow(value: number | undefined, window?: [number, number]): boolean {
  if (!window) return true;
  if (value === undefined) return true; // never drop a result for missing data
  return value >= window[0] && value <= window[1];
}

export function applyFlightFilters(results: FlightResult[], filters: FlightFilters): FlightResult[] {
  return results.filter((result) => {
    if (filters.airlines.length > 0) {
      const codes = resultAirlines(result);
      if (!codes.some((code) => filters.airlines.includes(code))) return false;
    }

    if (filters.stops.length > 0) {
      const stops = totalStops(result);
      if (stops !== undefined) {
        const bucket = stops >= 2 ? 2 : stops;
        if (!filters.stops.includes(bucket)) return false;
      }
    }

    if (typeof filters.maxPrice === "number") {
      const price = result.fare?.totalPrice?.amount;
      if (typeof price === "number" && price > filters.maxPrice) return false;
    }

    if (typeof filters.maxDurationMinutes === "number") {
      const duration = totalDurationMinutes(result);
      if (typeof duration === "number" && duration > filters.maxDurationMinutes) return false;
    }

    if (!withinWindow(firstDeparture(result), filters.departureWindow)) return false;
    if (!withinWindow(lastArrival(result), filters.arrivalWindow)) return false;

    return true;
  });
}

/** Sorts a copy; values that are missing sink to the bottom. */
export function sortFlightResults(results: FlightResult[], sort: FlightSortKey): FlightResult[] {
  const copy = [...results];
  const price = (r: FlightResult) => r.fare?.totalPrice?.amount ?? Number.POSITIVE_INFINITY;
  const duration = (r: FlightResult) => totalDurationMinutes(r) ?? Number.POSITIVE_INFINITY;

  switch (sort) {
    case "cheapest":
      return copy.sort((a, b) => price(a) - price(b));
    case "fastest":
      return copy.sort((a, b) => duration(a) - duration(b));
    case "recommended":
    default:
      // Balanced score: normalized price + normalized duration.
      return copy.sort((a, b) => {
        const scoreA = price(a) / 1000 + duration(a) / 60;
        const scoreB = price(b) / 1000 + duration(b) / 60;
        return scoreA - scoreB;
      });
  }
}

export const sortOptions: { value: FlightSortKey; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "cheapest", label: "Cheapest" },
  { value: "fastest", label: "Fastest" },
];
