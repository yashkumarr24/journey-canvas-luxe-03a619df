/**
 * Shared frontend shaping of /api/v1/flights/search results.
 *
 * Segment origin/destination values are never rewritten. The only change is
 * structural: when a single "outbound" itinerary actually contains the whole
 * round trip (onward segments followed by the return segments, as happens for
 * combined international fares), it is split at the searched destination so
 * each leg starts at its first segment's origin and ends at its last
 * segment's destination. Without this, AMD -> DXB -> AMD rendered as AMD → AMD.
 */

import type {
  FlightItinerary,
  FlightResult,
  FlightSearchRequest,
  FlightSearchResponse,
  FlightSegment,
} from "@/types/booking";

function code(value?: { code?: string }): string | undefined {
  return value?.code?.trim().toUpperCase() || undefined;
}

function buildLeg(
  segments: FlightSegment[],
  direction: FlightItinerary["direction"],
): FlightItinerary {
  const durations = segments.map((s) => s.durationMinutes);
  const allKnown = durations.every((d) => typeof d === "number");
  return {
    direction,
    segments,
    stops: Math.max(segments.length - 1, 0),
    durationMinutes: allKnown ? durations.reduce<number>((sum, d) => sum + (d ?? 0), 0) : undefined,
  };
}

/** Split one itinerary that loops back to the origin into outbound + inbound. */
function splitLoopedItinerary(
  itinerary: FlightItinerary,
  request: FlightSearchRequest,
): FlightItinerary[] {
  const segments = itinerary.segments ?? [];
  if (segments.length < 2) return [itinerary];

  const origin = request.origin.toUpperCase();
  const destination = request.destination.toUpperCase();
  if (code(segments[0]?.origin) !== origin) return [itinerary];
  if (code(segments.at(-1)?.destination) !== origin) return [itinerary];

  const splitAt = segments.findIndex((s) => code(s.destination) === destination);
  if (splitAt < 0 || splitAt === segments.length - 1) return [itinerary];
  if (code(segments[splitAt + 1]?.origin) !== destination) return [itinerary];

  return [
    buildLeg(segments.slice(0, splitAt + 1), "outbound"),
    buildLeg(segments.slice(splitAt + 1), "inbound"),
  ];
}

export function normalizeFlightResult(
  result: FlightResult,
  request: FlightSearchRequest,
): FlightResult {
  const itineraries = result.itineraries ?? [];
  if (itineraries.length !== 1 || itineraries[0].direction !== "outbound") return result;
  const legs = splitLoopedItinerary(itineraries[0], request);
  return legs.length === 1 ? result : { ...result, itineraries: legs };
}

export function normalizeFlightSearchResponse(
  response: FlightSearchResponse,
  request: FlightSearchRequest,
): FlightSearchResponse {
  if (!response || !Array.isArray(response.results)) return response;
  return {
    ...response,
    results: response.results.map((result) => normalizeFlightResult(result, request)),
  };
}
