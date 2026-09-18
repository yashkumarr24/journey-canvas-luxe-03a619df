/**
 * Hotel search form schema, validation, query options, filtering and sorting.
 * Generic validation only — no provider-specific rules are invented here.
 */

import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { hotelApi } from "@/lib/hotel-api";
import type {
  HotelFilters,
  HotelOccupancy,
  HotelResult,
  HotelSearchRequest,
  HotelSortKey,
} from "@/types/booking";

export const MAX_ROOMS = 5;
export const MAX_ADULTS_PER_ROOM = 6;
export const MAX_CHILDREN_PER_ROOM = 4;
export const MAX_STAY_NIGHTS = 30;
/** Ages accepted for a child sharing a room; older counts as an adult. */
export const MAX_CHILD_AGE = 17;

export const nationalityOptions = [
  { value: "IN", label: "India" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "SG", label: "Singapore" },
  { value: "AU", label: "Australia" },
];

export const currencyOptions = [
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "AED", label: "AED — UAE Dirham" },
];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a date");

const roomSchema = z.object({
  adults: z
    .number()
    .int()
    .min(1, "At least one adult per room")
    .max(MAX_ADULTS_PER_ROOM, `Up to ${MAX_ADULTS_PER_ROOM} adults per room`),
  childAges: z
    .array(z.number().int().min(0, "Enter an age").max(MAX_CHILD_AGE, `Children must be under ${MAX_CHILD_AGE + 1}`))
    .max(MAX_CHILDREN_PER_ROOM, `Up to ${MAX_CHILDREN_PER_ROOM} children per room`),
});

export const hotelSearchSchema = z
  .object({
    destination: z
      .string()
      .trim()
      .min(2, "Enter a city, area or hotel name")
      .max(80, "That destination is too long"),
    checkIn: isoDate,
    checkOut: isoDate,
    rooms: z.array(roomSchema).min(1).max(MAX_ROOMS),
    nationality: z.string().length(2),
    currency: z.string().length(3),
  })
  .superRefine((value, ctx) => {
    if (value.checkOut <= value.checkIn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkOut"],
        message: "Check-out must be after check-in",
      });
      return;
    }
    if (nightsBetween(value.checkIn, value.checkOut) > MAX_STAY_NIGHTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkOut"],
        message: `Stays of up to ${MAX_STAY_NIGHTS} nights can be booked online`,
      });
    }
  });

export type HotelSearchFormValues = z.infer<typeof hotelSearchSchema>;

export function blankRoom(): HotelOccupancy {
  return { adults: 2, childAges: [] };
}

export const defaultHotelSearchValues: HotelSearchFormValues = {
  destination: "",
  checkIn: "",
  checkOut: "",
  rooms: [blankRoom()],
  nationality: "IN",
  currency: "INR",
};

export function toHotelSearchRequest(values: HotelSearchFormValues): HotelSearchRequest {
  return {
    destination: values.destination.trim(),
    checkIn: values.checkIn,
    checkOut: values.checkOut,
    rooms: values.rooms.map((room) => ({
      adults: room.adults,
      childAges: [...room.childAges],
    })),
    nationality: values.nationality,
    currency: values.currency,
  };
}

/* ------------------------------------------------------------------ */
/* Query options                                                       */
/* ------------------------------------------------------------------ */

export function hotelSearchKey(request: HotelSearchRequest) {
  return ["booking", "hotels", "search", request] as const;
}

/**
 * Query options for a submitted hotel search. The query is only created after
 * the user submits valid criteria — it never runs on page load.
 */
export function hotelSearchQueryOptions(request: HotelSearchRequest | null) {
  return queryOptions({
    queryKey: request ? hotelSearchKey(request) : (["booking", "hotels", "search", "idle"] as const),
    queryFn: ({ signal }) => hotelApi.search(request as HotelSearchRequest, { signal }),
    enabled: request !== null,
    retry: false,
    // Rates go stale quickly; never serve a cached price silently for long.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}

export function hotelDetailQueryOptions(searchId: string | undefined, hotelId: string | undefined) {
  return queryOptions({
    queryKey: ["booking", "hotels", "detail", searchId ?? "none", hotelId ?? "none"] as const,
    queryFn: ({ signal }) =>
      hotelApi.detail({ searchId: searchId as string, hotelId: hotelId as string }, { signal }),
    enabled: Boolean(searchId && hotelId),
    retry: false,
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------------ */
/* Formatting + derived helpers (normalized data only)                 */
/* ------------------------------------------------------------------ */

export function nightsBetween(checkIn?: string, checkOut?: string): number {
  if (!checkIn || !checkOut) return 0;
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function formatStayDate(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function guestCount(rooms: HotelOccupancy[]): { adults: number; children: number } {
  return rooms.reduce(
    (total, room) => ({
      adults: total.adults + (room.adults ?? 0),
      children: total.children + (room.childAges?.length ?? 0),
    }),
    { adults: 0, children: 0 },
  );
}

export function occupancyLabel(rooms: HotelOccupancy[]): string {
  const { adults, children } = guestCount(rooms);
  const parts = [`${rooms.length} room${rooms.length > 1 ? "s" : ""}`];
  if (adults) parts.push(`${adults} adult${adults > 1 ? "s" : ""}`);
  if (children) parts.push(`${children} child${children > 1 ? "ren" : ""}`);
  return parts.join(" · ");
}

export function stayLabel(checkIn?: string, checkOut?: string): string {
  const nights = nightsBetween(checkIn, checkOut);
  if (!nights) return "—";
  return `${formatStayDate(checkIn)} → ${formatStayDate(checkOut)} · ${nights} night${nights > 1 ? "s" : ""}`;
}

/* ------------------------------------------------------------------ */
/* Filters + sorting                                                   */
/* ------------------------------------------------------------------ */

export const hotelSortOptions: { value: HotelSortKey; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "price_low", label: "Price: low to high" },
  { value: "price_high", label: "Price: high to low" },
  { value: "rating", label: "Guest rating" },
];

function resultPrice(result: HotelResult): number | undefined {
  return result.rate?.totalPrice?.amount;
}

export function hotelPriceRange(results: HotelResult[]): [number, number] | undefined {
  const prices = results.map(resultPrice).filter((value): value is number => typeof value === "number");
  if (prices.length === 0) return undefined;
  return [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))];
}

export function collectAmenities(results: HotelResult[]): string[] {
  return [...new Set(results.flatMap((result) => result.amenities ?? []))].sort();
}

export function collectPropertyTypes(results: HotelResult[]): string[] {
  return [...new Set(results.map((result) => result.propertyType).filter((value): value is string => !!value))].sort();
}

export function applyHotelFilters(results: HotelResult[], filters: HotelFilters): HotelResult[] {
  return results.filter((result) => {
    if (filters.starRatings.length > 0) {
      const stars = Math.floor(result.starRating ?? 0);
      if (!filters.starRatings.includes(stars)) return false;
    }
    if (filters.propertyTypes.length > 0 && !filters.propertyTypes.includes(result.propertyType ?? "")) {
      return false;
    }
    if (filters.amenities.length > 0) {
      const owned = new Set(result.amenities ?? []);
      if (!filters.amenities.every((amenity) => owned.has(amenity))) return false;
    }
    if (filters.freeCancellationOnly && !result.rate?.refundable) return false;
    if (typeof filters.maxPrice === "number") {
      const price = resultPrice(result);
      if (typeof price === "number" && price > filters.maxPrice) return false;
    }
    return true;
  });
}

export function sortHotelResults(results: HotelResult[], sort: HotelSortKey): HotelResult[] {
  const list = [...results];
  switch (sort) {
    case "price_low":
      return list.sort((a, b) => (resultPrice(a) ?? Infinity) - (resultPrice(b) ?? Infinity));
    case "price_high":
      return list.sort((a, b) => (resultPrice(b) ?? -Infinity) - (resultPrice(a) ?? -Infinity));
    case "rating":
      return list.sort((a, b) => (b.reviewScore ?? 0) - (a.reviewScore ?? 0));
    default:
      return list;
  }
}
