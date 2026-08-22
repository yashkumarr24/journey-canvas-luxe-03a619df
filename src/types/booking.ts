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

/* ------------------------------------------------------------------ */
/* Fare review + travellers (PHASE 7)                                  */
/* ------------------------------------------------------------------ */

/**
 * IMPORTANT: no request type below carries a price, a currency or a user id.
 * The backend resolves the payable amount from its own stored session and
 * rejects any request that tries to send one.
 */

export interface FlightSelectionRequest {
  /** Our own search id from FlightSearchResponse. */
  searchId: string;
  /** Opaque fare handle echoed back from the search result. */
  fareId: string;
  /** Guest continuity token issued by the server on a previous selection. */
  guestToken?: string;
  /** Guards against a double-submit creating two provider pre-books. */
  idempotencyKey?: string;
}

export interface PriceChange {
  previous: Money;
  current: Money;
  difference: Money;
  direction: "increase" | "decrease";
}

export interface TravellerRequirements {
  passportRequired: boolean;
  passportExpiryRequired: boolean;
  nationalityRequired: boolean;
  dateOfBirthRequired: boolean;
  international: boolean;
}

export interface ReviewFare {
  totalPrice: Money;
  basePrice?: Money;
  taxes?: Money;
  otherCharges?: Money;
  fareType?: string;
  refundable?: boolean;
  conditions?: string[];
  baggageCheckIn?: string;
  baggageCabin?: string;
  seatsAvailable?: number;
}

export interface FlightReviewResponse {
  /** Opaque handle for this review session — the only thing we persist. */
  reviewToken: string;
  /** Returned exactly once, when a guest session is created. */
  guestToken?: string;
  status: "reviewed" | "price_changed";
  itineraries: FlightItinerary[];
  fare: ReviewFare;
  priceChange?: PriceChange;
  passengers: PassengerCounts;
  requirements: TravellerRequirements;
  expiresAt: string;
  validForSeconds: number;
}

export type PassengerType = "adult" | "child" | "infant";

export interface TravellerInput {
  type: PassengerType;
  title?: string;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD. */
  dateOfBirth?: string;
  gender?: "male" | "female" | "other";
  /** ISO-3166 alpha-2. */
  nationality?: string;
  passportNumber?: string;
  passportExpiry?: string;
  passportIssuingCountry?: string;
  /** Ownership is re-verified server-side against the signed-in user. */
  savedTravellerId?: string;
  saveToProfile?: boolean;
}

export interface ContactInput {
  email: string;
  phone: string;
}

export interface TravellerDetailsRequest {
  reviewToken: string;
  guestToken?: string;
  travellers: TravellerInput[];
  contact: ContactInput;
  /** Consent to a server-detected price increase. Never an amount. */
  acceptPriceChange?: boolean;
  idempotencyKey?: string;
}

export interface TravellerDetailsResponse {
  bookingReference: string;
  /** Draft only — nothing is held or paid until the payment phase. */
  status: "awaiting_payment";
  totalPrice: Money;
  passengers: PassengerCounts;
  travellerCount: number;
  contactEmail: string;
  expiresAt: string;
  nextStep: "payment";
}
