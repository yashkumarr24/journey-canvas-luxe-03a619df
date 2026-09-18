/**
 * Hotel API boundary.
 *
 * Every hotel screen calls THIS module. React components never call `fetch`,
 * never talk to a travel provider and never see a payment secret:
 *
 *   Component -> TanStack Query -> hotel-api.ts -> FastAPI -> TripJack/Razorpay
 *
 * While the FastAPI hotel endpoints do not exist, calls are served by the local
 * mock provider (`hotel-mock.ts`) which follows the same call sequence
 * (search -> detail -> review -> book) and holds the authoritative price in a
 * session, so the browser never becomes the source of the payable amount.
 *
 * Replacing the mock later means deleting the `useMockHotels` branch — the call
 * signatures already match the intended FastAPI contract.
 */

import {
  BookingApiError,
  bookingApi,
  isBookingApiConfigured,
  toBookingError,
  type RequestOptions,
} from "@/lib/booking-api";
import {
  HOTEL_BOOKING_NOT_FOUND,
  HOTEL_NOT_FOUND,
  HOTEL_REVIEW_EXPIRED,
  HOTEL_ROOM_UNAVAILABLE,
  HOTEL_SEARCH_EXPIRED,
  mockHotelProvider,
} from "@/lib/hotel-mock";
import type {
  HotelBookingRequest,
  HotelBookingResult,
  HotelBookingSummary,
  HotelDetailRequest,
  HotelDetailResponse,
  HotelGuestDetailsRequest,
  HotelGuestDetailsResponse,
  HotelReviewResponse,
  HotelSearchRequest,
  HotelSearchResponse,
  HotelSelectionRequest,
  PaymentOrder,
  PaymentOrderRequest,
} from "@/types/booking";

/** True while the hotel journey is served by the local mock provider. */
export const useMockHotels =
  !isBookingApiConfigured || import.meta.env.VITE_HOTEL_TEST_MODE === "true";

/**
 * Domain failures the UI branches on. The backend will return these same codes,
 * so no screen needs to change when the mock is removed.
 */
const DOMAIN_ERRORS: Record<string, { message: string; kind: BookingApiError["kind"] }> = {
  [HOTEL_SEARCH_EXPIRED]: {
    kind: "conflict",
    message:
      "This search has expired, so the prices are no longer guaranteed. Please search again for current rates.",
  },
  [HOTEL_REVIEW_EXPIRED]: {
    kind: "conflict",
    message:
      "This room was only held for a short time and the hold has ended. Please search again to pick a room.",
  },
  [HOTEL_ROOM_UNAVAILABLE]: {
    kind: "conflict",
    message: "The hotel has just sold this room. Please choose another room or another property.",
  },
  HOTEL_PRICE_CHANGE_NOT_ACCEPTED: {
    kind: "validation",
    message: "Please confirm the updated total before continuing.",
  },
  [HOTEL_NOT_FOUND]: {
    kind: "not_found",
    message: "We couldn't find this hotel in your current search. Please search again.",
  },
  [HOTEL_BOOKING_NOT_FOUND]: {
    kind: "not_found",
    message:
      "We couldn't find this booking in your current session. Please start a new search to pick your stay again.",
  },
};

function asBookingError(error: unknown): BookingApiError {
  if (error instanceof Error && DOMAIN_ERRORS[error.message]) {
    const mapped = DOMAIN_ERRORS[error.message];
    return new BookingApiError({ kind: mapped.kind, code: error.message, message: mapped.message });
  }
  return toBookingError(error);
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw asBookingError(error);
  }
}

/** True when a failure means "start the search again". */
export function isHotelSessionExpired(error: unknown): boolean {
  const mapped = asBookingError(error);
  return mapped.code === HOTEL_SEARCH_EXPIRED || mapped.code === HOTEL_REVIEW_EXPIRED;
}

export function isHotelRoomUnavailable(error: unknown): boolean {
  return asBookingError(error).code === HOTEL_ROOM_UNAVAILABLE;
}

export const hotelApi = {
  /* --- Search / detail -------------------------------------------------- */

  search(payload: HotelSearchRequest, options?: RequestOptions): Promise<HotelSearchResponse> {
    return guard(() =>
      useMockHotels ? mockHotelProvider.search(payload) : bookingApi.searchHotels(payload, options),
    );
  },

  detail(payload: HotelDetailRequest, options?: RequestOptions): Promise<HotelDetailResponse> {
    return guard(() =>
      useMockHotels ? mockHotelProvider.detail(payload) : bookingApi.hotelDetail(payload, options),
    );
  },

  /* --- Review (final validation before booking) ------------------------- */

  review(payload: HotelSelectionRequest, options?: RequestOptions): Promise<HotelReviewResponse> {
    return guard(() =>
      useMockHotels ? mockHotelProvider.review(payload) : bookingApi.reviewHotel(payload, options),
    );
  },

  getReview(
    reviewToken: string,
    guestToken?: string | null,
    options?: RequestOptions,
  ): Promise<HotelReviewResponse> {
    return guard(() =>
      useMockHotels
        ? mockHotelProvider.getReview(reviewToken)
        : bookingApi.getHotelReview(reviewToken, guestToken, options),
    );
  },

  /* --- Guests / draft booking ------------------------------------------ */

  submitGuests(
    payload: HotelGuestDetailsRequest,
    options?: RequestOptions,
  ): Promise<HotelGuestDetailsResponse> {
    return guard(() =>
      useMockHotels
        ? mockHotelProvider.submitGuests(payload)
        : bookingApi.submitHotelGuests(payload, options),
    );
  },

  getBooking(
    bookingReference: string,
    guestToken?: string | null,
    signal?: AbortSignal,
  ): Promise<HotelBookingSummary> {
    return guard(() =>
      useMockHotels
        ? mockHotelProvider.getBooking(bookingReference)
        : bookingApi.getHotelBooking(bookingReference, guestToken, { signal }),
    );
  },

  /* --- Payment / booking ------------------------------------------------ */

  /** Payment orders are shared with flights: the backend resolves the amount. */
  createOrder(payload: PaymentOrderRequest): Promise<PaymentOrder> {
    return guard(() =>
      useMockHotels ? mockHotelProvider.createOrder(payload) : bookingApi.createPaymentOrder(payload),
    );
  },

  /** Verified server-side, then booked with the provider. */
  book(payload: HotelBookingRequest): Promise<HotelBookingResult> {
    return guard(() => (useMockHotels ? mockHotelProvider.book(payload) : bookingApi.bookHotel(payload)));
  },

  reportFailure(payload: {
    bookingReference: string;
    guestToken?: string;
    orderId?: string;
    reason: "cancelled" | "failed";
    message?: string;
  }): Promise<unknown> {
    return guard(() =>
      useMockHotels
        ? mockHotelProvider.reportFailure(payload.bookingReference, payload.reason, payload.message)
        : bookingApi.reportPaymentFailure(payload),
    );
  },
};
