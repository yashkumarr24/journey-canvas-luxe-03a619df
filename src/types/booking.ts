/**
 * Normalized booking domain types for the Fly n Feel booking platform.
 *
 * IMPORTANT: These types describe OUR OWN normalized API contract that the
 * FastAPI backend exposes. They are intentionally NOT coupled to any provider
 * (TripJack) response shape. The backend adapter is responsible for mapping
 * provider payloads into these structures:
 *
 *   Provider raw response -> FastAPI adapter -> normalized response -> frontend
 */

/* ------------------------------------------------------------------ */
/* Generic API envelope                                                */
/* ------------------------------------------------------------------ */

export interface APISuccess<T> {
  success: true;
  data: T;
  requestId?: string;
}

export interface APIFailure {
  success: false;
  code: string;
  message: string;
  requestId?: string;
}

export type APIResponse<T> = APISuccess<T> | APIFailure;

/** Machine-readable error codes produced by the frontend API client. */
export type BookingErrorKind =
  | "network"
  | "timeout"
  | "cancelled"
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "server"
  | "unavailable"
  | "not_implemented"
  | "unknown";

export interface BookingError {
  /** Normalized category used for UI branching. */
  kind: BookingErrorKind;
  /** Backend error code when available, otherwise the kind. */
  code: string;
  /** Safe, user-facing message. Never contains stack traces or internals. */
  message: string;
  /** HTTP status when the failure came from a response. */
  status?: number;
  /** Correlation id echoed by the backend, useful for support. */
  requestId?: string;
}

/* ------------------------------------------------------------------ */
/* Shared travel primitives                                            */
/* ------------------------------------------------------------------ */

export type TripType = "oneway" | "roundtrip";

export type CabinClass = "economy" | "premium_economy" | "business" | "first";

export interface PassengerCounts {
  adults: number;
  children: number;
  infants: number;
}

export interface Money {
  /** Minor-unit-free decimal amount, as normalized by the backend. */
  amount: number;
  /** ISO-4217 code, e.g. "INR". */
  currency: string;
}

export interface AirportRef {
  /** IATA code, e.g. "AMD". */
  code: string;
  name?: string;
  city?: string;
  country?: string;
  terminal?: string;
}

/* ------------------------------------------------------------------ */
/* Flights                                                             */
/* ------------------------------------------------------------------ */

export interface FlightSearchRequest {
  tripType: TripType;
  /** IATA code of origin airport/city. */
  origin: string;
  /** IATA code of destination airport/city. */
  destination: string;
  /** ISO date, YYYY-MM-DD. */
  departureDate: string;
  /** ISO date, YYYY-MM-DD. Required when tripType is "roundtrip". */
  returnDate?: string;
  passengers: PassengerCounts;
  cabinClass: CabinClass;
  /** ISO-4217 preferred quoting currency. */
  currency?: string;
}

export interface FlightSegment {
  id: string;
  airline: { code: string; name?: string; logoUrl?: string };
  flightNumber?: string;
  aircraft?: string;
  origin: AirportRef;
  destination: AirportRef;
  /** ISO 8601 local datetime strings as normalized by the backend. */
  departureAt: string;
  arrivalAt: string;
  /** Minutes. Optional — never fabricate when the provider omits it. */
  durationMinutes?: number;
  cabinClass?: CabinClass;
  baggage?: { checkIn?: string; cabin?: string };
}

export interface FlightItinerary {
  /** "outbound" for one-way and the first leg, "inbound" for the return leg. */
  direction: "outbound" | "inbound";
  segments: FlightSegment[];
  /** Number of stops; derived by the backend, may be absent. */
  stops?: number;
  durationMinutes?: number;
}

export interface FlightFare {
  /** Opaque token used later for re-pricing/booking. */
  fareId?: string;
  totalPrice: Money;
  basePrice?: Money;
  taxes?: Money;
  refundable?: boolean;
  fareType?: string;
  /** Free-text conditions supplied by the provider adapter. */
  conditions?: string[];
  seatsAvailable?: number;
}

export interface FlightResult {
  /** Stable id for list rendering and later re-pricing. */
  id: string;
  itineraries: FlightItinerary[];
  fare: FlightFare;
  /** Marketing/validating carrier, when known. */
  validatingAirline?: { code: string; name?: string };
}

export interface FlightSearchResponse {
  /** Server-side search session id used for re-pricing and booking. */
  searchId?: string;
  results: FlightResult[];
  /** Distinct airlines present in results, for filter UI. */
  airlines?: { code: string; name?: string }[];
  currency?: string;
  /** ISO timestamp after which the quote is no longer valid. */
  expiresAt?: string;
}

/* ------------------------------------------------------------------ */
/* Hotels                                                              */
/* ------------------------------------------------------------------ */

export interface HotelOccupancy {
  adults: number;
  /** Ages of children in the room; empty when none. */
  childAges: number[];
}

export interface HotelSearchRequest {
  /** Free-text city / area, resolved server-side. */
  destination: string;
  /** ISO date, YYYY-MM-DD. */
  checkIn: string;
  checkOut: string;
  rooms: HotelOccupancy[];
  nationality?: string;
  currency?: string;
}

export interface HotelResult {
  id: string;
  name: string;
  starRating?: number;
  address?: string;
  city?: string;
  country?: string;
  thumbnailUrl?: string;
  /** Lowest available total for the stay. */
  price?: Money;
  refundable?: boolean;
  amenities?: string[];
  reviewScore?: number;
}

export interface HotelSearchResponse {
  searchId?: string;
  results: HotelResult[];
  currency?: string;
  expiresAt?: string;
}

/* ------------------------------------------------------------------ */
/* Results filtering / sorting                                         */
/* ------------------------------------------------------------------ */

export type FlightSortKey = "recommended" | "cheapest" | "fastest";

export interface FlightFilters {
  /** Airline IATA codes to include; empty means "all". */
  airlines: string[];
  /** Allowed stop counts (0, 1, 2 = 2+); empty means "all". */
  stops: number[];
  /** Inclusive price bounds in the response currency. */
  maxPrice?: number;
  /** Departure window in minutes from midnight, local time. */
  departureWindow?: [number, number];
  arrivalWindow?: [number, number];
  /** Maximum total journey duration in minutes. */
  maxDurationMinutes?: number;
}

export const defaultFlightFilters: FlightFilters = {
  airlines: [],
  stops: [],
};
