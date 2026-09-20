/**
 * Mock hotel provider.
 *
 * It exists for ONE reason: the FastAPI hotel endpoints (and behind them the
 * provider integration) do not exist yet, so without it the hotel journey
 * cannot be walked end to end. It is a drop-in stand-in for the backend, not a
 * set of business rules:
 *
 *  - it follows the same call sequence the provider requires
 *    (search -> detail -> review -> book), with review as the final validation,
 *  - it holds the authoritative price in a server-shaped session, so the
 *    browser never becomes the source of the payable amount,
 *  - it marks everything it returns with `isTestMode: true`, so the UI says so,
 *  - it is only reachable while `VITE_BOOKING_API_URL` is unset (or hotel test
 *    mode is explicitly forced), and is bypassed entirely once the real
 *    endpoints are live.
 *
 * Session state lives in sessionStorage so a reload behaves like a real
 * server-stored session.
 *
 * TEST SCENARIOS (typed into the destination field, or the contact email):
 *   destination contains "noresults"   -> empty result set
 *   destination contains "expired"     -> search session is already expired
 *   destination contains "pricechange" -> review returns a higher price
 *   destination contains "soldout"     -> review reports the room unavailable
 *   contact email contains "pending"   -> booking stays in processing
 *   contact email contains "bookfail"  -> hotel booking fails after payment
 *   payment id contains "fail"         -> payment declined (test sheet button)
 */

import goa from "@/assets/goa.webp";
import dubai from "@/assets/dubai.webp";
import maldives from "@/assets/maldives.webp";
import kerala from "@/assets/kerala.webp";
import kashmir from "@/assets/kashmir.webp";
import singapore from "@/assets/singapore.webp";
import swiss from "@/assets/swiss.webp";
import bangkok from "@/assets/bangkok.webp";
import { nightsBetween } from "@/lib/hotel-search";
import { readHotelSnapshot } from "@/lib/hotel-session";
import type {
  FareBreakdownLine,
  HotelBookingRequest,
  HotelBookingResult,
  HotelBookingSummary,
  HotelDetailRequest,
  HotelDetailResponse,
  HotelGuestDetailsRequest,
  HotelGuestDetailsResponse,
  HotelGuestSummaryItem,
  HotelOccupancy,
  HotelResult,
  HotelReviewResponse,
  HotelRoomOption,
  HotelSearchRequest,
  HotelSearchResponse,
  HotelSelectionRequest,
  HotelStay,
  HotelSummary,
  Money,
  PaymentMethodOption,
  PaymentOrder,
  PaymentOrderRequest,
} from "@/types/booking";

/* ------------------------------------------------------------------ */
/* Error codes — mirrored by the future FastAPI implementation         */
/* ------------------------------------------------------------------ */

export const HOTEL_SEARCH_EXPIRED = "HOTEL_SEARCH_EXPIRED";
export const HOTEL_ROOM_UNAVAILABLE = "HOTEL_ROOM_UNAVAILABLE";
export const HOTEL_REVIEW_EXPIRED = "HOTEL_REVIEW_EXPIRED";
export const HOTEL_NOT_FOUND = "HOTEL_NOT_FOUND";
export const HOTEL_BOOKING_NOT_FOUND = "HOTEL_BOOKING_NOT_FOUND";

const SEARCH_KEY = "fnf.hotelMock.searches";
const REVIEW_KEY = "fnf.hotelMock.reviews";
const BOOKING_KEY = "fnf.hotelMock.bookings";

/** Simulated backend/provider latency, so loading states are exercised. */
const LATENCY_MS = 850;
const SEARCH_TTL_MS = 20 * 60_000;
const REVIEW_TTL_MS = 12 * 60_000;

/* ------------------------------------------------------------------ */
/* Storage helpers                                                     */
/* ------------------------------------------------------------------ */

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readMap<T>(key: string): Record<string, T> {
  const raw = storage()?.getItem(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, T>;
  } catch {
    return {};
  }
}

function writeMap<T>(key: string, value: Record<string, T>): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal: the journey still works for the current page view.
  }
}

function wait(ms = LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(code: string): never {
  throw new Error(code);
}

function token(length = 24): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, length);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, length);
}

/** Matches the `FF-XXXXXXXX` shape the database constraint enforces. */
function bookingReference(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `FF-${out}`;
}

function money(amount: number, currency: string): Money {
  return { amount: Math.round(amount), currency };
}

function scenario(text: string | undefined, key: string): boolean {
  return (text ?? "").toLowerCase().replace(/[\s-_]/g, "").includes(key);
}

/* ------------------------------------------------------------------ */
/* Static catalogue (stands in for the provider's inventory)           */
/* ------------------------------------------------------------------ */

interface CatalogueEntry {
  id: string;
  name: string;
  starRating: number;
  propertyType: string;
  city: string;
  country: string;
  area: string;
  address: string;
  landmark: string;
  image: string;
  amenities: string[];
  reviewScore: number;
  reviewCount: number;
  /** Per room, per night, before taxes, in INR. */
  basePerNight: number;
  description: string;
}

const CATALOGUE: CatalogueEntry[] = [
  {
    id: "hx-goa-oceanline",
    name: "Oceanline Beach Resort",
    starRating: 5,
    propertyType: "Resort",
    city: "Goa",
    country: "India",
    area: "Candolim",
    address: "Sinquerim Beach Road, Candolim, North Goa 403515",
    landmark: "3 min walk to Candolim Beach",
    image: goa,
    amenities: ["Private beach", "Outdoor pool", "Spa", "Free Wi-Fi", "Airport shuttle", "Restaurant"],
    reviewScore: 8.9,
    reviewCount: 1842,
    basePerNight: 11_400,
    description:
      "A low-rise beachfront resort wrapped around two pools, with palm-shaded verandas, a full-service spa and direct sand access from the garden wing.",
  },
  {
    id: "hx-goa-casa-verde",
    name: "Casa Verde Boutique Stay",
    starRating: 4,
    propertyType: "Boutique hotel",
    city: "Goa",
    country: "India",
    area: "Assagao",
    address: "House 214, Badem Church Road, Assagao, North Goa 403507",
    landmark: "10 min drive to Anjuna Beach",
    image: kerala,
    amenities: ["Outdoor pool", "Free Wi-Fi", "Breakfast", "Garden", "Free parking"],
    reviewScore: 8.4,
    reviewCount: 623,
    basePerNight: 6_800,
    description:
      "A restored Portuguese villa with eight rooms, a courtyard pool and a kitchen that serves Goan breakfasts until noon.",
  },
  {
    id: "hx-dubai-marina-vista",
    name: "Marina Vista Hotel & Suites",
    starRating: 5,
    propertyType: "Hotel",
    city: "Dubai",
    country: "United Arab Emirates",
    area: "Dubai Marina",
    address: "Al Marsa Street, Dubai Marina, Dubai",
    landmark: "Marina Walk across the road",
    image: dubai,
    amenities: ["Rooftop pool", "Gym", "Free Wi-Fi", "Airport shuttle", "Business centre", "Restaurant"],
    reviewScore: 9.1,
    reviewCount: 3120,
    basePerNight: 18_900,
    description:
      "Glass-fronted tower on the Marina promenade, with a heated rooftop pool, two restaurants and metro access two minutes away.",
  },
  {
    id: "hx-maldives-atoll",
    name: "Atoll Water Villas",
    starRating: 5,
    propertyType: "Resort",
    city: "Male",
    country: "Maldives",
    area: "South Male Atoll",
    address: "South Male Atoll, Kaafu, Maldives",
    landmark: "25 min speedboat from Velana International",
    image: maldives,
    amenities: ["Overwater villas", "House reef", "Spa", "All-inclusive", "Diving centre", "Free Wi-Fi"],
    reviewScore: 9.4,
    reviewCount: 987,
    basePerNight: 42_500,
    description:
      "Thatched water villas on a private lagoon with steps into the house reef, a dive school and dinner served on the sandbank.",
  },
  {
    id: "hx-kashmir-dal-retreat",
    name: "Dal Retreat by the Lake",
    starRating: 4,
    propertyType: "Lodge",
    city: "Srinagar",
    country: "India",
    area: "Boulevard Road",
    address: "Boulevard Road, Dal Lake, Srinagar 190001",
    landmark: "Lake-facing, 15 min to Mughal Gardens",
    image: kashmir,
    amenities: ["Lake view", "Heating", "Restaurant", "Free Wi-Fi", "Free parking", "Airport shuttle"],
    reviewScore: 8.6,
    reviewCount: 512,
    basePerNight: 7_600,
    description:
      "Cedar-panelled rooms looking straight onto Dal Lake, with shikara rides from the private jetty and Wazwan dinners on request.",
  },
  {
    id: "hx-singapore-orchard",
    name: "Orchard Central Residences",
    starRating: 4,
    propertyType: "Apartment hotel",
    city: "Singapore",
    country: "Singapore",
    area: "Orchard",
    address: "181 Orchard Road, Singapore 238896",
    landmark: "2 min walk to Somerset MRT",
    image: singapore,
    amenities: ["Kitchenette", "Gym", "Free Wi-Fi", "Laundry", "Rooftop pool"],
    reviewScore: 8.8,
    reviewCount: 2210,
    basePerNight: 15_200,
    description:
      "Serviced apartments above the Orchard shopping belt, with full kitchenettes, a lap pool on level 12 and MRT access underground.",
  },
  {
    id: "hx-swiss-alpine-haus",
    name: "Alpine Haus Interlaken",
    starRating: 4,
    propertyType: "Hotel",
    city: "Interlaken",
    country: "Switzerland",
    area: "Matten",
    address: "Hauptstrasse 22, 3800 Matten bei Interlaken",
    landmark: "Facing the Jungfrau ridge",
    image: swiss,
    amenities: ["Mountain view", "Sauna", "Breakfast", "Free Wi-Fi", "Ski storage", "Restaurant"],
    reviewScore: 9.0,
    reviewCount: 1440,
    basePerNight: 21_300,
    description:
      "A family-run chalet hotel with balconies facing the Jungfrau, a wood-fired sauna and the Interlaken Ost train five minutes away.",
  },
  {
    id: "hx-bangkok-riverside",
    name: "Riverside Sathorn Hotel",
    starRating: 4,
    propertyType: "Hotel",
    city: "Bangkok",
    country: "Thailand",
    area: "Sathorn",
    address: "45 Charoen Krung Road, Sathorn, Bangkok 10120",
    landmark: "Riverfront, 5 min to Saphan Taksin BTS",
    image: bangkok,
    amenities: ["River view", "Outdoor pool", "Spa", "Free Wi-Fi", "Restaurant", "Shuttle boat"],
    reviewScore: 8.5,
    reviewCount: 1976,
    basePerNight: 6_200,
    description:
      "River-facing rooms with a free shuttle boat to the sky-train pier, a garden pool and a rooftop Thai kitchen.",
  },
];

/* ------------------------------------------------------------------ */
/* Room / rate construction                                            */
/* ------------------------------------------------------------------ */

interface RateTemplate {
  key: string;
  roomName: string;
  roomType: string;
  bedType: string;
  mealPlan: string;
  multiplier: number;
  refundable: boolean;
  inclusions: string[];
  extraAdults: number;
}

const RATE_TEMPLATES: RateTemplate[] = [
  {
    key: "std-ro",
    roomName: "Classic Room",
    roomType: "Classic",
    bedType: "1 king bed",
    mealPlan: "Room only",
    multiplier: 1,
    refundable: false,
    inclusions: ["Free Wi-Fi", "Daily housekeeping"],
    extraAdults: 0,
  },
  {
    key: "std-bb",
    roomName: "Classic Room",
    roomType: "Classic",
    bedType: "1 king bed",
    mealPlan: "Breakfast included",
    multiplier: 1.14,
    refundable: true,
    inclusions: ["Free Wi-Fi", "Buffet breakfast for 2", "Free cancellation"],
    extraAdults: 0,
  },
  {
    key: "dlx-bb",
    roomName: "Deluxe Room with view",
    roomType: "Deluxe",
    bedType: "1 king bed or 2 twin beds",
    mealPlan: "Breakfast included",
    multiplier: 1.38,
    refundable: true,
    inclusions: ["Free Wi-Fi", "Buffet breakfast for 2", "Free cancellation", "Early check-in on request"],
    extraAdults: 1,
  },
  {
    key: "suite-hb",
    roomName: "Premium Suite",
    roomType: "Suite",
    bedType: "1 king bed + sofa bed",
    mealPlan: "Breakfast & dinner",
    multiplier: 1.92,
    refundable: true,
    inclusions: [
      "Free Wi-Fi",
      "Buffet breakfast for 2",
      "Set dinner for 2",
      "Free cancellation",
      "Airport transfer",
    ],
    extraAdults: 2,
  },
];

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function buildRoom(
  entry: CatalogueEntry,
  template: RateTemplate,
  rooms: HotelOccupancy[],
  nights: number,
  currency: string,
): HotelRoomOption {
  const roomCount = rooms.length;
  const base = entry.basePerNight * template.multiplier * nights * roomCount;
  const taxes = base * 0.12;
  const fees = base * 0.02;
  const occupancy = rooms[0] ?? { adults: 2, childAges: [] };

  return {
    id: `${entry.id}::${template.key}`,
    roomName: template.roomName,
    roomType: template.roomType,
    bedType: template.bedType,
    occupancy: {
      adults: Math.max(occupancy.adults, 1),
      childAges: [...(occupancy.childAges ?? [])],
    },
    roomCount,
    mealPlan: template.mealPlan,
    inclusions: template.inclusions,
    cancellation: template.refundable
      ? {
          refundable: true,
          summary: "Free cancellation up to 48 hours before check-in, then one night is charged.",
          freeCancellationUntil: hoursFromNow(48),
          rules: [
            { to: hoursFromNow(48), charge: money(0, currency), description: "No charge" },
            { from: hoursFromNow(48), charge: money(base / nights, currency), description: "One night charged" },
          ],
        }
      : {
          refundable: false,
          summary: "Non-refundable. This rate cannot be changed or cancelled after booking.",
        },
    basePrice: money(base, currency),
    taxes: money(taxes, currency),
    feesAndCharges: money(fees, currency),
    totalPrice: money(base + taxes + fees, currency),
    roomsAvailable: template.key === "suite-hb" ? 2 : 6,
    paymentPolicy: "Pay now to confirm",
  };
}

function toSummary(entry: CatalogueEntry): HotelSummary {
  return {
    id: entry.id,
    name: entry.name,
    starRating: entry.starRating,
    propertyType: entry.propertyType,
    thumbnailUrl: entry.image,
    images: [
      { url: entry.image, caption: `${entry.name} — exterior` },
      { url: entry.image, caption: "Rooms" },
      { url: entry.image, caption: "Pool & grounds" },
      { url: entry.image, caption: "Dining" },
    ],
    location: {
      address: entry.address,
      area: entry.area,
      city: entry.city,
      country: entry.country,
      landmark: entry.landmark,
    },
  };
}

function toResult(entry: CatalogueEntry, rooms: HotelOccupancy[], nights: number, currency: string): HotelResult {
  const cheapest = buildRoom(entry, RATE_TEMPLATES[0], rooms, nights, currency);
  const refundable = buildRoom(entry, RATE_TEMPLATES[1], rooms, nights, currency);

  return {
    ...toSummary(entry),
    amenities: entry.amenities,
    reviewScore: entry.reviewScore,
    reviewCount: entry.reviewCount,
    rate: {
      totalPrice: cheapest.totalPrice,
      perNightPrice: money(cheapest.totalPrice.amount / Math.max(nights * rooms.length, 1), currency),
      mealPlan: cheapest.mealPlan,
      refundable: refundable.cancellation.refundable,
      freeCancellationUntil: refundable.cancellation.freeCancellationUntil,
      roomName: cheapest.roomName,
      roomsAvailable: cheapest.roomsAvailable,
    },
  };
}

function matches(entry: CatalogueEntry, destination: string): boolean {
  const needle = destination.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [entry.city, entry.country, entry.area, entry.name, entry.propertyType]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

interface SearchSession {
  searchId: string;
  request: HotelSearchRequest;
  nights: number;
  hotelIds: string[];
  expiresAt: string;
}

interface ReviewSession {
  reviewToken: string;
  searchId: string;
  hotelId: string;
  rateId: string;
  /** Authoritative payable amount for this session. */
  totalPayable: Money;
  searchedAmount: Money;
  priceChanged: boolean;
  stay: HotelStay;
  expiresAt: string;
  bookingReference?: string;
}

function readSearch(searchId: string): SearchSession | null {
  return readMap<SearchSession>(SEARCH_KEY)[searchId] ?? null;
}

function requireSearch(searchId: string): SearchSession {
  const session = readSearch(searchId);
  if (!session) fail(HOTEL_SEARCH_EXPIRED);
  if (Date.parse(session.expiresAt) <= Date.now()) fail(HOTEL_SEARCH_EXPIRED);
  return session;
}

function putSearch(session: SearchSession): void {
  const map = readMap<SearchSession>(SEARCH_KEY);
  map[session.searchId] = session;
  writeMap(SEARCH_KEY, map);
}

function putReview(session: ReviewSession): void {
  const map = readMap<ReviewSession>(REVIEW_KEY);
  map[session.reviewToken] = session;
  writeMap(REVIEW_KEY, map);
}

function requireReview(reviewToken: string): ReviewSession {
  const session = readMap<ReviewSession>(REVIEW_KEY)[reviewToken];
  if (!session) fail(HOTEL_REVIEW_EXPIRED);
  if (Date.parse(session.expiresAt) <= Date.now()) fail(HOTEL_REVIEW_EXPIRED);
  return session;
}

function putBooking(summary: HotelBookingSummary): HotelBookingSummary {
  const map = readMap<HotelBookingSummary>(BOOKING_KEY);
  map[summary.bookingReference] = summary;
  writeMap(BOOKING_KEY, map);
  return summary;
}

function entryById(hotelId: string): CatalogueEntry {
  const entry = CATALOGUE.find((item) => item.id === hotelId);
  if (!entry) fail(HOTEL_NOT_FOUND);
  return entry;
}

function roomById(entry: CatalogueEntry, rateId: string, rooms: HotelOccupancy[], nights: number, currency: string) {
  const template = RATE_TEMPLATES.find((item) => rateId === `${entry.id}::${item.key}`);
  if (!template) fail(HOTEL_ROOM_UNAVAILABLE);
  return buildRoom(entry, template, rooms, nights, currency);
}

function buildBreakdown(room: HotelRoomOption, nights: number): FareBreakdownLine[] {
  const currency = room.totalPrice.currency;
  const lines: FareBreakdownLine[] = [];
  if (room.basePrice) {
    lines.push({
      label: "Room charges",
      amount: money(room.basePrice.amount, currency),
      kind: "base",
      note: `${room.roomCount} room${room.roomCount > 1 ? "s" : ""} × ${nights} night${nights > 1 ? "s" : ""}`,
    });
  }
  if (room.taxes) {
    lines.push({ label: "Taxes", amount: money(room.taxes.amount, currency), kind: "tax" });
  }
  if (room.feesAndCharges) {
    lines.push({ label: "Service fees", amount: money(room.feesAndCharges.amount, currency), kind: "fee" });
  }
  if (lines.length === 0) {
    lines.push({ label: "Stay total", amount: room.totalPrice, kind: "base" });
  }
  return lines;
}

const TEST_METHODS: PaymentMethodOption[] = [
  { id: "upi", label: "UPI", description: "Pay from any UPI app", enabled: true },
  { id: "card", label: "Credit or debit card", description: "Visa, Mastercard, RuPay, Amex", enabled: true },
  { id: "netbanking", label: "Net banking", description: "All major Indian banks", enabled: true },
  { id: "wallet", label: "Wallets", description: "Paytm, PhonePe, Amazon Pay", enabled: true },
];

function maskPan(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.length < 4) return "••••";
  return `${"•".repeat(Math.max(2, value.length - 4))}${value.slice(-4)}`;
}

function toGuestSummary(request: HotelGuestDetailsRequest): HotelGuestSummaryItem[] {
  return request.guests.map((guest) => ({
    type: guest.type,
    title: guest.title,
    fullName: `${guest.firstName} ${guest.lastName}`.trim(),
    roomIndex: guest.roomIndex,
    isLead: guest.isLead,
    age: guest.age,
    nationality: guest.nationality,
    panNumber: maskPan(guest.panNumber),
  }));
}

/** Rehydrates a booking from the store, or from the review snapshot. */
function resolveBooking(reference: string): HotelBookingSummary | null {
  const existing = readMap<HotelBookingSummary>(BOOKING_KEY)[reference];
  if (existing) return existing;

  const snapshot = readHotelSnapshot(reference);
  if (!snapshot) return null;

  return putBooking({
    bookingReference: reference,
    status: "awaiting_payment",
    hotel: snapshot.hotel,
    room: snapshot.room,
    stay: snapshot.stay,
    breakdown: snapshot.breakdown,
    totalPayable: snapshot.totalPayable,
    guests: snapshot.guests.map((guest) => ({
      type: guest.type,
      title: guest.title,
      fullName: `${guest.firstName} ${guest.lastName}`.trim(),
      roomIndex: guest.roomIndex,
      isLead: guest.isLead,
      age: guest.age,
      nationality: guest.nationality,
      panNumber: maskPan(guest.panNumber),
    })),
    contact: snapshot.contact,
    specialRequests: snapshot.specialRequests,
    expiresAt: snapshot.expiresAt,
    priceChange: snapshot.priceChange,
    voucherUrl: null,
    invoiceUrl: null,
    paymentMethods: TEST_METHODS,
    isTestMode: true,
  });
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export const mockHotelProvider = {
  async search(request: HotelSearchRequest): Promise<HotelSearchResponse> {
    await wait();
    const currency = request.currency ?? "INR";
    const nights = nightsBetween(request.checkIn, request.checkOut) || 1;

    if (scenario(request.destination, "noresults")) {
      return { searchId: undefined, results: [], currency, nights, expiresAt: hoursFromNow(0.3) };
    }

    const entries = CATALOGUE.filter((entry) => matches(entry, request.destination));
    const pool = entries.length > 0 ? entries : CATALOGUE;
    const results = pool.map((entry) => toResult(entry, request.rooms, nights, currency));

    // "expired" makes the session start already elapsed, so the expiry path can
    // be exercised on the very next call.
    const expiresAt = scenario(request.destination, "expired")
      ? new Date(Date.now() - 1_000).toISOString()
      : new Date(Date.now() + SEARCH_TTL_MS).toISOString();

    const session: SearchSession = {
      searchId: `hs_${token(20)}`,
      request,
      nights,
      hotelIds: pool.map((entry) => entry.id),
      expiresAt,
    };
    putSearch(session);

    return {
      searchId: session.searchId,
      results,
      currency,
      nights,
      expiresAt,
      amenities: [...new Set(pool.flatMap((entry) => entry.amenities))].sort(),
      propertyTypes: [...new Set(pool.map((entry) => entry.propertyType))].sort(),
    };
  },

  async detail(payload: HotelDetailRequest): Promise<HotelDetailResponse> {
    await wait(600);
    const session = requireSearch(payload.searchId);
    const entry = entryById(payload.hotelId);
    const currency = session.request.currency ?? "INR";

    return {
      searchId: session.searchId,
      checkIn: session.request.checkIn,
      checkOut: session.request.checkOut,
      nights: session.nights,
      currency,
      expiresAt: session.expiresAt,
      hotel: {
        ...toSummary(entry),
        amenities: entry.amenities,
        reviewScore: entry.reviewScore,
        reviewCount: entry.reviewCount,
        description: entry.description,
        checkInTime: "14:00",
        checkOutTime: "11:00",
        facilities: entry.amenities,
        policies: [
          "Valid government photo ID is required for every adult guest at check-in.",
          "Children under 6 stay free when sharing the existing bedding.",
          "Unmarried couples are welcome; local ID is accepted.",
        ],
        rooms: RATE_TEMPLATES.map((template) =>
          buildRoom(entry, template, session.request.rooms, session.nights, currency),
        ),
      },
    };
  },

  /**
   * Review is the final real-time validation before booking: it re-prices, it
   * re-checks availability and it opens the server-held session that owns the
   * payable amount from here on.
   */
  async review(payload: HotelSelectionRequest): Promise<HotelReviewResponse> {
    await wait(1_100);
    const session = requireSearch(payload.searchId);
    const entry = entryById(payload.hotelId);
    const currency = session.request.currency ?? "INR";
    const destination = session.request.destination;

    if (scenario(destination, "soldout")) fail(HOTEL_ROOM_UNAVAILABLE);

    const room = roomById(entry, payload.rateId, session.request.rooms, session.nights, currency);
    const searched = room.totalPrice;
    const priceChanged = scenario(destination, "pricechange");
    const total = priceChanged ? money(searched.amount * 1.08, currency) : searched;

    const priced: HotelRoomOption = priceChanged
      ? {
          ...room,
          basePrice: room.basePrice ? money(room.basePrice.amount * 1.08, currency) : undefined,
          taxes: room.taxes ? money(room.taxes.amount * 1.08, currency) : undefined,
          feesAndCharges: room.feesAndCharges ? money(room.feesAndCharges.amount * 1.08, currency) : undefined,
          totalPrice: total,
        }
      : room;

    const stay: HotelStay = {
      checkIn: session.request.checkIn,
      checkOut: session.request.checkOut,
      nights: session.nights,
      rooms: session.request.rooms,
    };

    const expiresAt = new Date(Date.now() + REVIEW_TTL_MS).toISOString();
    const review: ReviewSession = {
      reviewToken: `hr_${token(28)}`,
      searchId: session.searchId,
      hotelId: entry.id,
      rateId: payload.rateId,
      totalPayable: total,
      searchedAmount: searched,
      priceChanged,
      stay,
      expiresAt,
    };
    putReview(review);

    return {
      reviewToken: review.reviewToken,
      guestToken: `hg_${token(32)}`,
      status: priceChanged ? "price_changed" : "reviewed",
      hotel: toSummary(entry),
      room: priced,
      stay,
      breakdown: buildBreakdown(priced, session.nights),
      totalPayable: total,
      priceChange: priceChanged
        ? {
            previous: searched,
            current: total,
            difference: money(total.amount - searched.amount, currency),
            direction: "increase",
          }
        : undefined,
      requirements: {
        panRequired: total.amount >= 200_000,
        passportRequired: entry.country !== "India",
        nationalityRequired: entry.country !== "India",
        dateOfBirthRequired: false,
        allGuestNamesRequired: true,
        international: entry.country !== "India",
      },
      expiresAt,
      validForSeconds: Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)),
    };
  },

  async getReview(reviewToken: string): Promise<HotelReviewResponse> {
    await wait(400);
    const session = requireReview(reviewToken);
    const entry = entryById(session.hotelId);
    const search = readSearch(session.searchId);
    const currency = session.totalPayable.currency;
    const rooms = session.stay.rooms;
    const room = roomById(entry, session.rateId, rooms, session.stay.nights, currency);
    const priced: HotelRoomOption = { ...room, totalPrice: session.totalPayable };

    return {
      reviewToken: session.reviewToken,
      status: session.priceChanged ? "price_changed" : "reviewed",
      hotel: toSummary(entry),
      room: priced,
      stay: session.stay,
      breakdown: buildBreakdown(priced, session.stay.nights),
      totalPayable: session.totalPayable,
      priceChange: session.priceChanged
        ? {
            previous: session.searchedAmount,
            current: session.totalPayable,
            difference: money(session.totalPayable.amount - session.searchedAmount.amount, currency),
            direction: "increase",
          }
        : undefined,
      requirements: {
        panRequired: session.totalPayable.amount >= 200_000,
        passportRequired: entry.country !== "India",
        nationalityRequired: entry.country !== "India",
        dateOfBirthRequired: false,
        allGuestNamesRequired: true,
        international: entry.country !== "India",
      },
      expiresAt: session.expiresAt,
      validForSeconds: Math.max(0, Math.round((Date.parse(session.expiresAt) - Date.now()) / 1000)),
      guestToken: undefined,
      ...(search ? {} : {}),
    };
  },

  async submitGuests(payload: HotelGuestDetailsRequest): Promise<HotelGuestDetailsResponse> {
    await wait(900);
    const session = requireReview(payload.reviewToken);

    if (session.priceChanged && !payload.acceptPriceChange) {
      fail("HOTEL_PRICE_CHANGE_NOT_ACCEPTED");
    }

    const reference = session.bookingReference ?? bookingReference();
    putReview({ ...session, bookingReference: reference });

    const entry = entryById(session.hotelId);
    const room = roomById(entry, session.rateId, session.stay.rooms, session.stay.nights, session.totalPayable.currency);
    const priced: HotelRoomOption = { ...room, totalPrice: session.totalPayable };

    putBooking({
      bookingReference: reference,
      status: "awaiting_payment",
      hotel: {
        ...toSummary(entry),
        description: entry.description,
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
      room: priced,
      stay: session.stay,
      breakdown: buildBreakdown(priced, session.stay.nights),
      totalPayable: session.totalPayable,
      guests: toGuestSummary(payload),
      contact: payload.contact,
      specialRequests: payload.specialRequests,
      expiresAt: session.expiresAt,
      priceChange: session.priceChanged
        ? {
            previous: session.searchedAmount,
            current: session.totalPayable,
            difference: money(
              session.totalPayable.amount - session.searchedAmount.amount,
              session.totalPayable.currency,
            ),
            direction: "increase",
          }
        : undefined,
      voucherUrl: null,
      invoiceUrl: null,
      paymentMethods: TEST_METHODS,
      isTestMode: true,
    });

    return {
      bookingReference: reference,
      status: "awaiting_payment",
      totalPrice: session.totalPayable,
      guestCount: payload.guests.length,
      contactEmail: payload.contact.email,
      expiresAt: session.expiresAt,
      nextStep: "payment",
    };
  },

  async getBooking(reference: string): Promise<HotelBookingSummary> {
    await wait(400);
    const booking = resolveBooking(reference);
    if (!booking) fail(HOTEL_BOOKING_NOT_FOUND);
    return booking;
  },

  async createOrder(payload: PaymentOrderRequest): Promise<PaymentOrder> {
    await wait();
    const booking = resolveBooking(payload.bookingReference);
    if (!booking) fail(HOTEL_BOOKING_NOT_FOUND);
    return {
      provider: "test",
      bookingReference: booking.bookingReference,
      orderId: `test_order_${token(10)}`,
      amount: booking.totalPayable,
      prefill: { email: booking.contact.email, phone: booking.contact.phone },
      expiresAt: booking.expiresAt,
    };
  },

  /**
   * Mirrors the real contract: the caller passes a provider payment id and the
   * backend decides the outcome after verifying it, then books the stay.
   */
  async book(payload: HotelBookingRequest): Promise<HotelBookingResult> {
    await wait(1_600);
    const booking = resolveBooking(payload.bookingReference);
    if (!booking) fail(HOTEL_BOOKING_NOT_FOUND);

    if (payload.paymentId.toLowerCase().includes("fail")) {
      const failed = putBooking({
        ...booking,
        status: "payment_failed",
        statusMessage: "The payment was declined. No money has been taken.",
      });
      return { status: "payment_failed", booking: failed, message: failed.statusMessage };
    }

    const email = booking.contact.email.toLowerCase();

    if (scenario(email, "bookfail")) {
      const failed = putBooking({
        ...booking,
        status: "failed",
        statusMessage:
          "The hotel released the room before we could confirm it. Your payment is refunded in full and our desk will call you with alternatives.",
      });
      return { status: "failed", booking: failed, message: failed.statusMessage };
    }

    if (scenario(email, "pending")) {
      const pending = putBooking({
        ...booking,
        status: "booking_processing",
        statusMessage: "Your payment is confirmed. The hotel is still confirming the room.",
      });
      return { status: "booking_processing", booking: pending, message: pending.statusMessage };
    }

    const confirmed = putBooking({
      ...booking,
      status: "confirmed",
      hotelBookingId: `HB${token(8).toUpperCase()}`,
      hotelConfirmationNumber: `CONF${token(6).toUpperCase()}`,
      // Documents are produced by the backend; nothing to link to yet.
      voucherUrl: null,
      invoiceUrl: null,
      statusMessage: undefined,
    });
    return { status: "confirmed", booking: confirmed };
  },

  async reportFailure(reference: string, reason: "cancelled" | "failed", message?: string) {
    await wait(300);
    const booking = resolveBooking(reference);
    if (!booking) fail(HOTEL_BOOKING_NOT_FOUND);
    return putBooking({
      ...booking,
      status: reason === "cancelled" ? "awaiting_payment" : "payment_failed",
      statusMessage:
        reason === "cancelled"
          ? "You closed the payment window before paying. Your room is still held."
          : (message ?? "The payment did not go through. No money has been taken."),
    });
  },
};
