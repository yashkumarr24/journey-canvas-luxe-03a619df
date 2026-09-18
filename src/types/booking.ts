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
/* Hotels — search, detail, rooms (PHASE 9)                            */
/* ------------------------------------------------------------------ */

/**
 * As with flights, these are OUR normalized contracts. The FastAPI adapter maps
 * the provider flow (Listing/Search -> Detail -> Review -> Book) onto them, so
 * nothing here mentions a provider field name, a provider id or a raw payload.
 */

export interface HotelOccupancy {
  adults: number;
  /** Ages of children sharing the room; empty when none. */
  childAges: number[];
}

export interface HotelImage {
  url: string;
  caption?: string;
}

export interface HotelLocation {
  address?: string;
  area?: string;
  city?: string;
  country?: string;
  landmark?: string;
  latitude?: number;
  longitude?: number;
}

/** Cheapest sellable rate for the whole stay, as shown in results. */
export interface HotelRateSummary {
  totalPrice: Money;
  perNightPrice?: Money;
  mealPlan?: string;
  refundable?: boolean;
  /** ISO timestamp; absent when the provider gives no free-cancellation window. */
  freeCancellationUntil?: string;
  roomName?: string;
  roomsAvailable?: number;
}

/** Identity fields shared by results, detail, review and confirmation. */
export interface HotelSummary {
  /** Opaque, server-controlled handle. Never a provider id we invent. */
  id: string;
  name: string;
  starRating?: number;
  propertyType?: string;
  location?: HotelLocation;
  thumbnailUrl?: string;
  images?: HotelImage[];
}

export interface HotelResult extends HotelSummary {
  amenities?: string[];
  reviewScore?: number;
  reviewCount?: number;
  rate?: HotelRateSummary;
}

export interface HotelSearchRequest {
  /** Free-text city / area, resolved server-side. */
  destination: string;
  /** ISO date, YYYY-MM-DD. */
  checkIn: string;
  checkOut: string;
  /** One entry per physical room requested. */
  rooms: HotelOccupancy[];
  /** ISO-3166 alpha-2 guest nationality; affects rates and tax. */
  nationality?: string;
  currency?: string;
}

export interface HotelSearchResponse {
  /** Server-side search session id, required by detail and review. */
  searchId?: string;
  results: HotelResult[];
  currency?: string;
  /** ISO timestamp after which the search session must be repeated. */
  expiresAt?: string;
  nights?: number;
  /** Facets for the filter UI, derived server-side. */
  amenities?: string[];
  propertyTypes?: string[];
}

export interface HotelDetailRequest {
  searchId: string;
  hotelId: string;
}

export interface HotelCancellationRule {
  /** ISO timestamps bounding the window this charge applies to. */
  from?: string;
  to?: string;
  charge?: Money;
  description?: string;
}

export interface HotelCancellationPolicy {
  refundable: boolean;
  /** Short provider-supplied summary; rendered as-is. */
  summary?: string;
  freeCancellationUntil?: string;
  rules?: HotelCancellationRule[];
}

/**
 * One sellable room/rate option. `id` is an opaque rate handle: the browser
 * echoes it back on selection and never sends a price with it.
 */
export interface HotelRoomOption {
  id: string;
  roomName: string;
  roomType?: string;
  bedType?: string;
  occupancy: HotelOccupancy;
  /** Number of physical rooms this option covers. */
  roomCount: number;
  mealPlan?: string;
  inclusions?: string[];
  cancellation: HotelCancellationPolicy;
  basePrice?: Money;
  taxes?: Money;
  feesAndCharges?: Money;
  totalPrice: Money;
  roomsAvailable?: number;
  /** e.g. "Pay now", "Pay at hotel". */
  paymentPolicy?: string;
}

/**
 * Detail payload. Everything below is designed to arrive from the provider's
 * dynamic detail call at request time — the frontend keeps no static copy.
 */
export interface HotelDetail extends HotelResult {
  description?: string;
  checkInTime?: string;
  checkOutTime?: string;
  facilities?: string[];
  /** Property rules and notes, one line each. */
  policies?: string[];
  rooms: HotelRoomOption[];
}

export interface HotelDetailResponse {
  searchId?: string;
  hotel: HotelDetail;
  checkIn?: string;
  checkOut?: string;
  nights?: number;
  currency?: string;
  expiresAt?: string;
}

/* ------------------------------------------------------------------ */
/* Hotels — filtering / sorting                                        */
/* ------------------------------------------------------------------ */

export type HotelSortKey = "recommended" | "price_low" | "price_high" | "rating";

export interface HotelFilters {
  /** Star ratings to include; empty means "all". */
  starRatings: number[];
  maxPrice?: number;
  amenities: string[];
  propertyTypes: string[];
  freeCancellationOnly: boolean;
}

export const defaultHotelFilters: HotelFilters = {
  starRatings: [],
  amenities: [],
  propertyTypes: [],
  freeCancellationOnly: false,
};

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

/* ------------------------------------------------------------------ */
/* Checkout, payment + confirmation (PHASE 8)                          */
/* ------------------------------------------------------------------ */

/**
 * IMPORTANT: no request type below carries an amount, a currency or a fare id.
 * The browser sends a booking reference plus provider acknowledgement fields;
 * the backend resolves the payable total from its own stored booking, verifies
 * the provider signature and decides the outcome.
 */

/** Lifecycle of a booking from draft through to a ticketed order. */
export type BookingStatus =
  | "awaiting_payment"
  | "payment_processing"
  | "payment_failed"
  | "booking_processing"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "expired";

export interface FareBreakdownLine {
  label: string;
  amount: Money;
  kind?: "base" | "tax" | "fee" | "discount";
  /** Rendered as smaller helper text under the label. */
  note?: string;
}

export interface TravellerSummaryItem {
  type: PassengerType;
  title?: string;
  fullName: string;
  dateOfBirth?: string;
  /** Masked by the backend; the frontend never reformats it. */
  passportNumber?: string;
  nationality?: string;
  /** Present once the airline has issued a seat/ticket for this traveller. */
  ticketNumber?: string;
}

export interface PaymentMethodOption {
  id: string;
  label: string;
  description?: string;
  enabled: boolean;
}

/** Everything the checkout and confirmation screens render. */
export interface BookingSummary {
  bookingReference: string;
  status: BookingStatus;
  itineraries: FlightItinerary[];
  fare: ReviewFare;
  breakdown: FareBreakdownLine[];
  totalPayable: Money;
  passengers: PassengerCounts;
  travellers: TravellerSummaryItem[];
  contact: ContactInput;
  /** Deadline for paying while the fare is still held. */
  expiresAt?: string;
  priceChange?: PriceChange;
  /** Airline PNR — only after the booking is confirmed. */
  pnr?: string;
  airlineBookingReference?: string;
  /** Absolute URLs issued by the backend; absent means "not available yet". */
  ticketUrl?: string | null;
  invoiceUrl?: string | null;
  paymentMethods?: PaymentMethodOption[];
  /** Safe, user-facing explanation for a failed or cancelled booking. */
  statusMessage?: string;
  /** True when the summary came from the local test adapter, not the backend. */
  isTestMode?: boolean;
}

export type PaymentProvider = "razorpay" | "test";

export interface PaymentOrder {
  provider: PaymentProvider;
  bookingReference: string;
  orderId: string;
  /** Server-resolved payable amount, for display and provider handoff only. */
  amount: Money;
  /** Publishable key id. Never a secret. */
  keyId?: string;
  prefill?: { name?: string; email?: string; phone?: string };
  expiresAt?: string;
}

export interface PaymentOrderRequest {
  bookingReference: string;
  guestToken?: string;
  /** Chosen method id from BookingSummary.paymentMethods. */
  method?: string;
  idempotencyKey?: string;
}

export interface PaymentConfirmRequest {
  bookingReference: string;
  guestToken?: string;
  provider: PaymentProvider;
  orderId: string;
  paymentId: string;
  /** Provider signature, verified server-side. */
  signature?: string;
  idempotencyKey?: string;
}

export interface PaymentFailureRequest {
  bookingReference: string;
  guestToken?: string;
  orderId?: string;
  reason: "cancelled" | "failed";
  /** Provider-supplied description, if any. */
  message?: string;
}

export interface PaymentResult {
  status: Extract<
    BookingStatus,
    "confirmed" | "booking_processing" | "payment_failed" | "failed"
  >;
  booking: BookingSummary;
  message?: string;
}

/* ------------------------------------------------------------------ */
/* Hotels — review, guests, booking (PHASE 9)                          */
/* ------------------------------------------------------------------ */

/**
 * Same rule as flights: no request type below carries a price, a currency or a
 * user id. The backend resolves the payable amount from its own stored review
 * session and rejects any request that tries to send one.
 */

export interface HotelSelectionRequest {
  /** Our own search id from HotelSearchResponse. */
  searchId: string;
  hotelId: string;
  /** Opaque rate handle echoed back from the detail response. */
  rateId: string;
  /** Guest continuity token issued by the server on a previous selection. */
  guestToken?: string;
  idempotencyKey?: string;
}

export interface HotelStay {
  checkIn: string;
  checkOut: string;
  nights: number;
  /** Guest allocation per physical room, as priced. */
  rooms: HotelOccupancy[];
}

/** What the provider says this booking needs, resolved per rate. */
export interface HotelGuestRequirements {
  panRequired: boolean;
  passportRequired: boolean;
  nationalityRequired: boolean;
  dateOfBirthRequired: boolean;
  /** All guest names required, not just the lead guest. */
  allGuestNamesRequired: boolean;
  international: boolean;
}

export interface HotelReviewResponse {
  /** Opaque handle for this review session — the only thing we persist. */
  reviewToken: string;
  /** Returned exactly once, when a guest session is created. */
  guestToken?: string;
  status: "reviewed" | "price_changed";
  hotel: HotelSummary;
  room: HotelRoomOption;
  stay: HotelStay;
  /** Server-produced lines; never summed in the browser. */
  breakdown: FareBreakdownLine[];
  totalPayable: Money;
  priceChange?: PriceChange;
  requirements: HotelGuestRequirements;
  expiresAt: string;
  validForSeconds: number;
}

export type HotelGuestType = "adult" | "child";

export interface HotelGuestInput {
  type: HotelGuestType;
  /** 1-based index of the room this guest occupies. */
  roomIndex: number;
  /** Exactly one guest per booking is the lead guest. */
  isLead?: boolean;
  title?: string;
  firstName: string;
  lastName: string;
  age?: number;
  dateOfBirth?: string;
  /** ISO-3166 alpha-2. */
  nationality?: string;
  panNumber?: string;
  passportNumber?: string;
  /** Ownership is re-verified server-side against the signed-in user. */
  savedTravellerId?: string;
  saveToProfile?: boolean;
}

export interface HotelContactInput extends ContactInput {
  /** Country dialling code, e.g. "+91". Stored separately from the number. */
  dialCode?: string;
}

export interface HotelGuestDetailsRequest {
  reviewToken: string;
  guestToken?: string;
  guests: HotelGuestInput[];
  contact: HotelContactInput;
  specialRequests?: string;
  /** Consent to a server-detected price increase. Never an amount. */
  acceptPriceChange?: boolean;
  idempotencyKey?: string;
}

export interface HotelGuestDetailsResponse {
  bookingReference: string;
  /** Draft only — nothing is held or paid until the payment step. */
  status: "awaiting_payment";
  totalPrice: Money;
  guestCount: number;
  contactEmail: string;
  expiresAt: string;
  nextStep: "payment";
}

export interface HotelGuestSummaryItem {
  type: HotelGuestType;
  title?: string;
  fullName: string;
  roomIndex: number;
  isLead?: boolean;
  age?: number;
  nationality?: string;
  /** Masked by the backend; the frontend never reformats it. */
  panNumber?: string;
}

/** Everything the hotel checkout and confirmation screens render. */
export interface HotelBookingSummary {
  bookingReference: string;
  status: BookingStatus;
  hotel: HotelSummary & { description?: string; checkInTime?: string; checkOutTime?: string };
  room: HotelRoomOption;
  stay: HotelStay;
  breakdown: FareBreakdownLine[];
  totalPayable: Money;
  guests: HotelGuestSummaryItem[];
  contact: HotelContactInput;
  specialRequests?: string;
  /** Deadline for paying while the rate is still held. */
  expiresAt?: string;
  priceChange?: PriceChange;
  /** Provider booking id — only after the hotel booking succeeds. */
  hotelBookingId?: string;
  /** Hotel-side confirmation number, when the provider returns one. */
  hotelConfirmationNumber?: string;
  /** Absolute URLs issued by the backend; absent means "not available yet". */
  voucherUrl?: string | null;
  invoiceUrl?: string | null;
  paymentMethods?: PaymentMethodOption[];
  /** Safe, user-facing explanation for a failed, pending or cancelled booking. */
  statusMessage?: string;
  /** True when the summary came from the local mock provider, not the backend. */
  isTestMode?: boolean;
}

/**
 * Result of the hotel booking call. The backend verifies the payment signature
 * server-side FIRST, then books with the provider, then returns this.
 */
export interface HotelBookingRequest {
  bookingReference: string;
  guestToken?: string;
  provider: PaymentProvider;
  orderId: string;
  paymentId: string;
  /** Provider signature, verified server-side. */
  signature?: string;
  idempotencyKey?: string;
}

export interface HotelBookingResult {
  status: Extract<
    BookingStatus,
    "confirmed" | "booking_processing" | "payment_failed" | "failed"
  >;
  booking: HotelBookingSummary;
  message?: string;
}
