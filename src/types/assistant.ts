/**
 * AI Travel Assistant contracts (PHASE 12).
 *
 * These are OUR normalized types. Nothing here mentions a model, a provider
 * field name or a raw provider payload, so the mock provider today and the
 * backend AI endpoint later satisfy the same interface.
 *
 * The assistant only ever produces *requirements* — search intent. It never
 * produces flights, fares, fare ids, prices, schedules or baggage rules; those
 * come exclusively from the existing flight-search boundary.
 */

import type { CabinClass, TripType } from "@/types/booking";

export type AssistantRole = "user" | "assistant";

export type AssistantMessageKind = "text" | "question" | "summary" | "error";

export interface AssistantMessage {
  id: string;
  role: AssistantRole;
  text: string;
  at: string;
  kind: AssistantMessageKind;
}

/** Broad time-of-day preference. Deliberately coarse — never an exact time. */
export type TimeWindow = "early_morning" | "morning" | "afternoon" | "evening" | "night";

export type BaggagePreference = "checked_baggage" | "cabin_only";
export type AssistantProduct = "flights" | "hotels";
export type ResultSortPreference = "recommended" | "cheapest" | "fastest";

/**
 * Structured travel requirements accumulated across the conversation.
 * Every field is optional: the assistant asks for what is missing instead of
 * guessing.
 */
export interface TravelRequirements {
  products?: AssistantProduct[];
  tripType?: TripType;
  /** IATA code, uppercase. */
  origin?: string;
  /** Human label for the origin, for display only. */
  originLabel?: string;
  destination?: string;
  destinationLabel?: string;
  /** ISO date, YYYY-MM-DD. */
  departureDate?: string;
  returnDate?: string;
  /** Stated trip length in nights, when the user gave a duration. */
  durationNights?: number;
  adults?: number;
  children?: number;
  infants?: number;
  cabinClass?: CabinClass;
  preferredDepartureWindow?: TimeWindow;
  preferredArrivalWindow?: TimeWindow;
  preferredReturnWindow?: TimeWindow;
  nonStopOnly?: boolean;
  baggagePreference?: BaggagePreference;
  /** Airline names/codes the user mentioned. Only used to rank real results. */
  preferredAirlines?: string[];
  hotelDestination?: string;
  hotelLocationPreference?: string;
  resultSort?: ResultSortPreference;
  /** Anything else worth showing back to the user, e.g. "flexible dates". */
  notes?: string[];
}

export type RequirementField =
  | "origin"
  | "destination"
  | "departureDate"
  | "returnDate"
  | "passengers"
  | "cabinClass";

export interface MissingRequirement {
  field: RequirementField;
  /** Question the UI can show verbatim. */
  prompt: string;
}

export interface AssistantTurnRequest {
  /** Raw user message. Sanitised and length-capped before it leaves the app. */
  message: string;
  /** Requirements understood so far, so a turn is stateless server-side. */
  requirements: TravelRequirements;
  /** Recent conversation for context. Trimmed; never contains documents. */
  history: Pick<AssistantMessage, "role" | "text">[];
}

export interface AssistantTurnResponse {
  /** Assistant reply text. */
  reply: string;
  /** Merged requirements after this turn. */
  requirements: TravelRequirements;
  /** Still-needed information, in the order it should be asked for. */
  missing: MissingRequirement[];
  /** True when the requirements validate against the flight-search schema. */
  ready: boolean;
  /** Optional follow-up chips. */
  suggestions?: string[];
  /** Which implementation answered — surfaced in the UI, never hidden. */
  provider: "demo" | "ai";
}

/* ------------------------------------------------------------------ */
/* Recommendations — derived ONLY from returned flight results         */
/* ------------------------------------------------------------------ */

export type RecommendationKey =
  | "cheapest"
  | "fastest"
  | "fewest_stops"
  | "preferred_departure"
  | "preferred_arrival"
  | "preferred_airline"
  | "non_stop";

export interface FlightRecommendation {
  key: RecommendationKey;
  label: string;
  /** Why this result matched, phrased from real result data only. */
  reason: string;
  /** Id of a result present in the current search response. */
  resultId: string;
}

/** The pluggable assistant implementation. */
export interface AssistantProvider {
  readonly id: "demo" | "ai";
  interpret(input: AssistantTurnRequest): Promise<AssistantTurnResponse>;
}
