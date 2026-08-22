/**
 * Flight search form schema, validation and TanStack Query helpers.
 * Generic validation only — no airline-specific rules are invented here.
 */

import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { bookingApi } from "@/lib/booking-api";
import type {
  CabinClass,
  FlightResult,
  FlightSearchRequest,
  TripType,
} from "@/types/booking";

export const MAX_PASSENGERS = 9;

export const cabinClassOptions: { value: CabinClass; label: string }[] = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium Economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];

const iata = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Enter a 3-letter airport code, e.g. AMD");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a date");

export const flightSearchSchema = z
  .object({
    tripType: z.enum(["oneway", "roundtrip"]),
    origin: iata,
    destination: iata,
    departureDate: isoDate,
    returnDate: z.string().optional(),
    adults: z.number().int().min(1, "At least one adult is required").max(MAX_PASSENGERS),
    children: z.number().int().min(0).max(MAX_PASSENGERS),
    infants: z.number().int().min(0).max(MAX_PASSENGERS),
    cabinClass: z.enum(["economy", "premium_economy", "business", "first"]),
  })
  .superRefine((value, ctx) => {
    if (value.origin && value.destination && value.origin === value.destination) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destination"],
        message: "Origin and destination cannot be the same",
      });
    }

    if (value.tripType === "roundtrip") {
      if (!value.returnDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["returnDate"],
          message: "Select a return date for a round trip",
        });
      } else if (value.returnDate < value.departureDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["returnDate"],
          message: "Return date cannot be before the departure date",
        });
      }
    }

    const seated = value.adults + value.children;
    if (seated > MAX_PASSENGERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["children"],
        message: `Up to ${MAX_PASSENGERS} adults and children in total`,
      });
    }

    // Generic, provider-neutral rule: an infant travels on an adult's lap.
    if (value.infants > value.adults) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["infants"],
        message: "Infants cannot outnumber adults",
      });
    }
  });

export type FlightSearchFormValues = z.infer<typeof flightSearchSchema>;

export const defaultFlightSearchValues: FlightSearchFormValues = {
  tripType: "roundtrip",
  origin: "",
  destination: "",
  departureDate: "",
  returnDate: "",
  adults: 1,
  children: 0,
  infants: 0,
  cabinClass: "economy",
};

export function toSearchRequest(values: FlightSearchFormValues): FlightSearchRequest {
  return {
    tripType: values.tripType as TripType,
    origin: values.origin.toUpperCase(),
    destination: values.destination.toUpperCase(),
    departureDate: values.departureDate,
    returnDate: values.tripType === "roundtrip" ? values.returnDate || undefined : undefined,
    passengers: {
      adults: values.adults,
      children: values.children,
      infants: values.infants,
    },
    cabinClass: values.cabinClass,
    currency: "INR",
  };
}

/** Stable, serializable cache key for a search request. */
export function flightSearchKey(request: FlightSearchRequest) {
  return ["booking", "flights", "search", request] as const;
}

/**
 * Query options for a submitted search. The query is only created after the
 * user submits valid criteria — it never runs on page load.
 */
export function flightSearchQueryOptions(request: FlightSearchRequest | null) {
  return queryOptions({
    queryKey: request ? flightSearchKey(request) : (["booking", "flights", "search", "idle"] as const),
    queryFn: ({ signal }) => bookingApi.searchFlights(request as FlightSearchRequest, { signal }),
    enabled: request !== null,
    retry: false,
    // Quotes go stale quickly; never serve a cached fare silently for long.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

/* ------------------------------------------------------------------ */
/* Derived helpers for results UI (work on normalized data only)       */
/* ------------------------------------------------------------------ */

export function totalDurationMinutes(result: FlightResult): number | undefined {
  const values = result.itineraries.map((itinerary) => {
    if (typeof itinerary.durationMinutes === "number") return itinerary.durationMinutes;
    const segmentTotal = itinerary.segments.reduce<number | undefined>((sum, segment) => {
      if (sum === undefined || typeof segment.durationMinutes !== "number") return undefined;
      return sum + segment.durationMinutes;
    }, 0);
    return segmentTotal;
  });
  if (values.some((value) => value === undefined)) return undefined;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function totalStops(result: FlightResult): number | undefined {
  const values = result.itineraries.map((itinerary) =>
    typeof itinerary.stops === "number"
      ? itinerary.stops
      : itinerary.segments.length > 0
        ? itinerary.segments.length - 1
        : undefined,
  );
  if (values.some((value) => value === undefined)) return undefined;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function formatDuration(minutes?: number): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

export function formatMoney(amount?: number, currency = "INR"): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

export function formatTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function minutesFromMidnight(iso?: string): number | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.getHours() * 60 + date.getMinutes();
}
