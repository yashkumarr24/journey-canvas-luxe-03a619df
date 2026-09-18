/**
 * Requirement merging, gap detection and the bridge into the EXISTING flight
 * search boundary.
 *
 * Nothing here talks to a provider. The only way requirements become a search
 * is `toValidatedSearchRequest`, which runs the same `flightSearchSchema` the
 * flight search form uses — so an assistant-generated search can never skip
 * the validation a typed search goes through.
 */

import {
  defaultFlightSearchValues,
  flightSearchSchema,
  toSearchRequest,
  type FlightSearchFormValues,
} from "@/lib/flight-search";
import type { FlightSearchRequest } from "@/types/booking";
import { hotelSearchSchema, toHotelSearchRequest } from "@/lib/hotel-search";
import type { HotelSearchRequest } from "@/types/booking";
import type { MissingRequirement, RequirementField, TravelRequirements } from "@/types/assistant";

export const MAX_ASSISTANT_MESSAGE_LENGTH = 500;

/** Strip control characters and cap length before a message leaves the app. */
export function sanitizeAssistantMessage(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ASSISTANT_MESSAGE_LENGTH);
}

export function mergeRequirements(
  base: TravelRequirements,
  patch: TravelRequirements,
): TravelRequirements {
  const merged: TravelRequirements = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

const PROMPTS: Record<RequirementField, string> = {
  origin: "Which city will you be departing from?",
  destination: "Where would you like to fly to?",
  departureDate: "What date would you like to travel?",
  returnDate: "When would you like to return?",
  passengers: "How many travellers are flying, and are any of them children or infants?",
  cabinClass: "Which cabin would you prefer — economy, premium economy, business or first?",
};

/** Ordered list of what still needs to be asked. */
export function missingRequirements(requirements: TravelRequirements): MissingRequirement[] {
  const missing: MissingRequirement[] = [];
  const add = (field: RequirementField) => missing.push({ field, prompt: PROMPTS[field] });

  if (!requirements.origin) add("origin");
  if (!requirements.destination) add("destination");
  if (!requirements.departureDate) add("departureDate");
  if (requirements.tripType === "roundtrip" && !requirements.returnDate) add("returnDate");
  return missing;
}

/**
 * Requirements -> form values. Defaults are conservative and explicit:
 * one adult and economy, exactly like the search form's own defaults.
 */
export function toFormValues(requirements: TravelRequirements): FlightSearchFormValues {
  const tripType = requirements.tripType ?? (requirements.returnDate ? "roundtrip" : "oneway");
  return {
    ...defaultFlightSearchValues,
    tripType,
    origin: (requirements.origin ?? "").toUpperCase(),
    destination: (requirements.destination ?? "").toUpperCase(),
    departureDate: requirements.departureDate ?? "",
    returnDate: tripType === "roundtrip" ? (requirements.returnDate ?? "") : "",
    adults: requirements.adults ?? 1,
    children: requirements.children ?? 0,
    infants: requirements.infants ?? 0,
    cabinClass: requirements.cabinClass ?? "economy",
  };
}

export interface ValidationOutcome {
  ok: boolean;
  request?: FlightSearchRequest;
  /** Human-readable problems, safe to show. */
  issues: string[];
}

/**
 * The ONLY path from assistant output to a flight search. Runs the shared Zod
 * schema, so invalid dates, impossible passenger mixes and same-city routes are
 * rejected here rather than reaching the API boundary.
 */
export function toValidatedSearchRequest(requirements: TravelRequirements): ValidationOutcome {
  const parsed = flightSearchSchema.safeParse(toFormValues(requirements));
  if (!parsed.success) {
    const issues = [...new Set(parsed.error.issues.map((issue) => issue.message))];
    return { ok: false, issues };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (parsed.data.departureDate < today) {
    return { ok: false, issues: ["The departure date is in the past. Please give a future date."] };
  }

  return { ok: true, request: toSearchRequest(parsed.data), issues: [] };
}

export interface HotelValidationOutcome {
  ok: boolean;
  request?: HotelSearchRequest;
  issues: string[];
}

export function wantsHotels(requirements: TravelRequirements): boolean {
  return requirements.products?.includes("hotels") ?? false;
}

/** Uses the existing hotel schema, so assistant output cannot bypass validation. */
export function toValidatedHotelSearchRequest(requirements: TravelRequirements): HotelValidationOutcome {
  if (!wantsHotels(requirements)) return { ok: false, issues: [] };
  const values = {
    destination: requirements.hotelDestination ?? requirements.destinationLabel ?? "",
    checkIn: requirements.departureDate ?? "",
    checkOut: requirements.returnDate ?? "",
    rooms: [{ adults: requirements.adults ?? 1, childAges: Array(requirements.children ?? 0).fill(8) }],
    nationality: "IN",
    currency: "INR",
  };
  const parsed = hotelSearchSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, issues: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  }
  return { ok: true, request: toHotelSearchRequest(parsed.data), issues: [] };
}

export function isReady(requirements: TravelRequirements): boolean {
  return missingRequirements(requirements).length === 0 && toValidatedSearchRequest(requirements).ok;
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

const TIME_WINDOW_LABELS: Record<string, string> = {
  early_morning: "Early morning (before 6am)",
  morning: "Morning (6am – 12pm)",
  afternoon: "Afternoon (12pm – 5pm)",
  evening: "Evening (5pm – 9pm)",
  night: "Night (after 9pm)",
};

export function timeWindowLabel(window?: string): string | null {
  return window ? (TIME_WINDOW_LABELS[window] ?? null) : null;
}

export function formatRequirementDate(date?: string): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
