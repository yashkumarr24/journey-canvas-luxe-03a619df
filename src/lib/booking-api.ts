/**
 * Centralized booking API client.
 *
 * This is the SINGLE entry point the frontend uses to talk to the Fly n Feel
 * FastAPI backend. Booking components must never call `fetch` directly and
 * must never talk to a travel provider (TripJack) from the browser.
 *
 *   Component -> TanStack Query -> booking-api.ts -> FastAPI -> provider
 *
 * The only configuration the browser knows is the public backend base URL
 * (`VITE_BOOKING_API_URL`). No provider keys, payment secrets or database
 * credentials are ever referenced here.
 */

import type {
  APIResponse,
  BookingError,
  BookingErrorKind,
  BookingSummary,
  FlightReviewResponse,
  FlightSearchRequest,
  FlightSearchResponse,
  FlightSelectionRequest,
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
  PaymentConfirmRequest,
  PaymentFailureRequest,
  PaymentOrder,
  PaymentOrderRequest,
  PaymentResult,
  TravellerDetailsRequest,
  TravellerDetailsResponse,
} from "@/types/booking";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const RAW_BASE_URL = import.meta.env.VITE_BOOKING_API_URL ?? "";

/** Public FastAPI base URL. Empty string means "not configured yet". */
export const bookingApiBaseUrl = RAW_BASE_URL.replace(/\/+$/, "");

/** True once VITE_BOOKING_API_URL points somewhere. */
export const isBookingApiConfigured = bookingApiBaseUrl.length > 0;

/** Travel searches are slow; keep a generous but bounded default. */
export const DEFAULT_TIMEOUT_MS = 45_000;

/* ------------------------------------------------------------------ */
/* Error model                                                         */
/* ------------------------------------------------------------------ */

const FRIENDLY_MESSAGES: Record<BookingErrorKind, string> = {
  network: "Unable to connect to the booking service. Please try again.",
  timeout: "The booking service is taking longer than expected. Please try again.",
  cancelled: "The request was cancelled.",
  bad_request: "Some of the search details look incorrect. Please review and try again.",
  unauthorized: "Your session has expired. Please start again.",
  forbidden: "You don't have access to this booking action.",
  not_found: "We couldn't find what you were looking for.",
  conflict: "This booking has already changed. Please refresh and try again.",
  validation: "Please check the details entered and try again.",
  rate_limited: "Too many searches in a short time. Please wait a moment and try again.",
  server: "Something went wrong. Please try again later.",
  unavailable: "The booking service is temporarily unavailable. Please try again shortly.",
  not_implemented: "Flight search service is being configured.",
  unknown: "Something went wrong. Please try again later.",
};

const STATUS_KIND: Record<number, BookingErrorKind> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation",
  429: "rate_limited",
  500: "server",
  501: "not_implemented",
  502: "unavailable",
  503: "unavailable",
  504: "timeout",
};

export class BookingApiError extends Error implements BookingError {
  readonly kind: BookingErrorKind;
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string;

  constructor(init: BookingError) {
    super(init.message);
    this.name = "BookingApiError";
    this.kind = init.kind;
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
  }

  /** True when retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return (
      this.kind === "network" ||
      this.kind === "timeout" ||
      this.kind === "server" ||
      this.kind === "unavailable" ||
      this.kind === "rate_limited"
    );
  }

  toJSON(): BookingError {
    return {
      kind: this.kind,
      code: this.code,
      message: this.message,
      status: this.status,
      requestId: this.requestId,
    };
  }
}

function makeError(
  kind: BookingErrorKind,
  options: { code?: string; message?: string; status?: number; requestId?: string } = {},
): BookingApiError {
  return new BookingApiError({
    kind,
    code: options.code ?? kind.toUpperCase(),
    message: options.message?.trim() || FRIENDLY_MESSAGES[kind],
    status: options.status,
    requestId: options.requestId,
  });
}

/** Normalize any thrown value into a BookingApiError with a safe message. */
export function toBookingError(error: unknown): BookingApiError {
  if (error instanceof BookingApiError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return makeError("cancelled");
  }
  return makeError("unknown");
}

/* ------------------------------------------------------------------ */
/* Low-level request helper                                            */
/* ------------------------------------------------------------------ */

export interface RequestOptions {
  /** Overrides DEFAULT_TIMEOUT_MS for slow endpoints. */
  timeoutMs?: number;
  /** Caller-owned cancellation (TanStack Query passes its own signal). */
  signal?: AbortSignal;
  /** Extra non-sensitive headers. */
  headers?: Record<string, string>;
}

/**
 * Placeholder for future customer authentication. When auth lands, this
 * resolver will return a short-lived bearer token issued by our own backend
 * (never a provider credential).
 */
type TokenResolver = () => string | null | Promise<string | null>;

let authTokenResolver: TokenResolver | null = null;

export function setBookingAuthTokenResolver(resolver: TokenResolver | null): void {
  authTokenResolver = resolver;
}

function createRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("json");
}

function isApiFailure(body: unknown): body is { code?: string; message?: string; success: false } {
  return typeof body === "object" && body !== null && (body as { success?: unknown }).success === false;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  if (!isBookingApiConfigured) {
    throw makeError("not_implemented", {
      code: "BOOKING_API_NOT_CONFIGURED",
      message: "The booking service is being configured. Please check back soon.",
    });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);

  const onExternalAbort = () => controller.abort(new DOMException("cancelled", "AbortError"));
  if (options.signal) {
    if (options.signal.aborted) onExternalAbort();
    else options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const requestId = createRequestId();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Request-ID": requestId,
    ...options.headers,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const token = authTokenResolver ? await authTokenResolver() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${bookingApiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: "omit",
      mode: "cors",
    });
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason as DOMException | undefined;
      throw makeError(reason?.name === "TimeoutError" ? "timeout" : "cancelled", { requestId });
    }
    throw makeError("network", { requestId });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }

  const payload: unknown = isJsonResponse(response) ? await response.json().catch(() => null) : null;
  const responseId = response.headers.get("x-request-id") ?? requestId;

  if (!response.ok) {
    const kind = STATUS_KIND[response.status] ?? (response.status >= 500 ? "server" : "unknown");
    const failure = isApiFailure(payload) ? payload : null;
    throw makeError(kind, {
      code: failure?.code,
      // Backend contract guarantees `message` is already user-safe.
      message: failure?.message,
      status: response.status,
      requestId: responseId,
    });
  }

  if (isApiFailure(payload)) {
    throw makeError("unknown", {
      code: payload.code,
      message: payload.message,
      status: response.status,
      requestId: responseId,
    });
  }

  // Accept both a bare payload and our { success: true, data } envelope.
  if (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { success?: unknown }).success === true &&
    "data" in payload
  ) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}

/* ------------------------------------------------------------------ */
/* Public API surface                                                  */
/* ------------------------------------------------------------------ */

export const bookingApi = {
  get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>("POST", path, body, options),

  /** Backend liveness probe — used by the dev status banner. */
  health: (options?: RequestOptions) =>
    request<{ status: string }>("GET", "/health", undefined, { timeoutMs: 8_000, ...options }),

  /** Flight search. The backend endpoint is added in a later phase. */
  searchFlights: (payload: FlightSearchRequest, options?: RequestOptions) =>
    request<FlightSearchResponse>("POST", "/api/v1/flights/search", payload, options),

  /**
   * Select a fare. The backend re-prices it with the provider and opens a
   * server-held review session; we only ever receive opaque tokens back.
   */
  selectFlight: (payload: FlightSelectionRequest, options?: RequestOptions) =>
    request<FlightReviewResponse>("POST", "/api/v1/flights/select", payload, options),

  /**
   * Re-read a review session. The guest token travels in a header so it stays
   * out of URLs, browser history and server access logs.
   */
  getReview: (reviewToken: string, guestToken?: string | null, options?: RequestOptions) =>
    request<FlightReviewResponse>(
      "GET",
      `/api/v1/flights/review/${encodeURIComponent(reviewToken)}`,
      undefined,
      {
        timeoutMs: 15_000,
        ...options,
        headers: { ...(guestToken ? { "X-Guest-Token": guestToken } : {}), ...options?.headers },
      },
    ),

  /** Submit traveller + contact details and create a draft booking. */
  submitTravellers: (payload: TravellerDetailsRequest, options?: RequestOptions) =>
    request<TravellerDetailsResponse>("POST", "/api/v1/flights/travellers", payload, options),

  /* --- Checkout / payment (PHASE 8) ----------------------------------- */

  /**
   * Server-authoritative booking summary for the checkout and confirmation
   * screens. The guest token travels in a header, never in the URL.
   */
  getBooking: (bookingReference: string, guestToken?: string | null, options?: RequestOptions) =>
    request<BookingSummary>(
      "GET",
      `/api/v1/bookings/${encodeURIComponent(bookingReference)}`,
      undefined,
      {
        timeoutMs: 15_000,
        ...options,
        headers: { ...(guestToken ? { "X-Guest-Token": guestToken } : {}), ...options?.headers },
      },
    ),

  /**
   * Creates a payment order. The backend resolves the payable amount itself and
   * returns only an order id plus a publishable key id.
   */
  createPaymentOrder: (payload: PaymentOrderRequest, options?: RequestOptions) =>
    request<PaymentOrder>("POST", "/api/v1/payments/order", payload, options),

  /**
   * Hands the provider acknowledgement to the backend, which verifies the
   * signature server-side and then issues the booking.
   */
  confirmPayment: (payload: PaymentConfirmRequest, options?: RequestOptions) =>
    request<PaymentResult>("POST", "/api/v1/payments/confirm", payload, {
      timeoutMs: 60_000,
      ...options,
    }),

  /** Records a cancelled or declined payment attempt against the booking. */
  reportPaymentFailure: (payload: PaymentFailureRequest, options?: RequestOptions) =>
    request<BookingSummary>("POST", "/api/v1/payments/failure", payload, options),

  /* --- Hotels (PHASE 9) ------------------------------------------------ */

  /** Hotel listing/search. Opens a server-held search session. */
  searchHotels: (payload: HotelSearchRequest, options?: RequestOptions) =>
    request<HotelSearchResponse>("POST", "/api/v1/hotels/search", payload, options),

  /**
   * Dynamic hotel detail + sellable room options for one search session.
   * The room list is always provider-fresh; the frontend caches nothing.
   */
  hotelDetail: (payload: HotelDetailRequest, options?: RequestOptions) =>
    request<HotelDetailResponse>("POST", "/api/v1/hotels/detail", payload, options),

  /**
   * Select a room/rate. The backend re-prices and re-checks availability with
   * the provider and opens a server-held review session; we only ever receive
   * opaque tokens back.
   */
  reviewHotel: (payload: HotelSelectionRequest, options?: RequestOptions) =>
    request<HotelReviewResponse>("POST", "/api/v1/hotels/review", payload, options),

  /** Re-read a hotel review session. Guest token travels in a header. */
  getHotelReview: (reviewToken: string, guestToken?: string | null, options?: RequestOptions) =>
    request<HotelReviewResponse>(
      "GET",
      `/api/v1/hotels/review/${encodeURIComponent(reviewToken)}`,
      undefined,
      {
        timeoutMs: 15_000,
        ...options,
        headers: { ...(guestToken ? { "X-Guest-Token": guestToken } : {}), ...options?.headers },
      },
    ),

  /** Submit guest details and create a draft hotel booking. */
  submitHotelGuests: (payload: HotelGuestDetailsRequest, options?: RequestOptions) =>
    request<HotelGuestDetailsResponse>("POST", "/api/v1/hotels/guests", payload, options),

  /** Server-authoritative hotel booking summary for checkout/confirmation. */
  getHotelBooking: (bookingReference: string, guestToken?: string | null, options?: RequestOptions) =>
    request<HotelBookingSummary>(
      "GET",
      `/api/v1/hotels/bookings/${encodeURIComponent(bookingReference)}`,
      undefined,
      {
        timeoutMs: 15_000,
        ...options,
        headers: { ...(guestToken ? { "X-Guest-Token": guestToken } : {}), ...options?.headers },
      },
    ),

  /**
   * Verifies the payment server-side and then books the stay with the provider.
   * Payment orders are created through the shared /api/v1/payments/order
   * endpoint, so hotels reuse one payment architecture with flights.
   */
  bookHotel: (payload: HotelBookingRequest, options?: RequestOptions) =>
    request<HotelBookingResult>("POST", "/api/v1/hotels/booking", payload, {
      timeoutMs: 90_000,
      ...options,
    }),
};

export type { APIResponse };
