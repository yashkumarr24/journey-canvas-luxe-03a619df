/**
 * Single frontend boundary for booking operations, support and notes (PHASE 11).
 *
 * Every operations screen — customer and admin — calls this module and nothing
 * else. Two implementations sit behind it:
 *
 *   VITE_BOOKING_API_URL set    -> FastAPI endpoints (contracts below)
 *   VITE_BOOKING_API_URL unset  -> local mock provider, clearly labelled as test
 *
 * Contracts (FastAPI, to be implemented server-side):
 *   GET    /api/v1/bookings
 *   GET    /api/v1/bookings/{ref}
 *   POST   /api/v1/bookings/{ref}/cancellation-request
 *   POST   /api/v1/bookings/lookup                  (guest: ref + contact email)
 *   GET    /api/v1/support
 *   POST   /api/v1/support
 *   GET    /api/v1/support/{id}
 *   POST   /api/v1/support/{id}/messages
 *   GET    /api/v1/admin/bookings
 *   GET    /api/v1/admin/bookings/{ref}
 *   POST   /api/v1/admin/bookings/{ref}/notes
 *   PATCH  /api/v1/admin/bookings/{ref}/cancellation
 *   GET    /api/v1/admin/support
 *   PATCH  /api/v1/admin/support/{id}
 *   GET    /api/v1/admin/operations/metrics
 *
 * The frontend never sends a price, a role, a user id or an admin level: the
 * backend derives all of them from the verified token.
 */

import { bookingApi, isBookingApiConfigured, toBookingError } from "@/lib/booking-api";
import { mockOpsProvider, OpsMockError, type CustomerContext } from "@/lib/ops/ops-mock";
import type {
  AdminBookingDetail,
  AdminBookingListItem,
  AdminSupportRequest,
  BookingDetail,
  BookingListItem,
  BookingListQuery,
  CancellationRequest,
  CancellationRequestInput,
  GuestBookingLookupInput,
  InternalNote,
  Paged,
  SupportRequest,
  SupportRequestInput,
  SupportStatus,
} from "@/types/operations";

/** True while the local test provider is in use. */
export const useMockOperations = !isBookingApiConfigured;

export class OpsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OpsError";
  }
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OpsMockError) throw new OpsError(error.code, error.message);
    if (error instanceof OpsError) throw error;
    const api = toBookingError(error);
    throw new OpsError(api.kind, api.message);
  }
}

function queryString(query: BookingListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const opsApi = {
  /* -- customer ---------------------------------------------------- */

  listBookings: (query: BookingListQuery, ctx: CustomerContext) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.listBookings(query, ctx)
        : bookingApi.get<Paged<BookingListItem>>(`/api/v1/bookings${queryString(query)}`),
    ),

  getBooking: (reference: string, ctx: CustomerContext) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.getBooking(reference, ctx)
        : bookingApi.get<BookingDetail>(`/api/v1/bookings/${encodeURIComponent(reference)}`),
    ),

  lookupGuestBooking: (input: GuestBookingLookupInput) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.lookupGuestBooking(input)
        : bookingApi.post<BookingDetail>("/api/v1/bookings/lookup", input),
    ),

  requestCancellation: (input: CancellationRequestInput, ctx: CustomerContext) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.requestCancellation(input, ctx)
        : bookingApi.post<CancellationRequest>(
            `/api/v1/bookings/${encodeURIComponent(input.bookingReference)}/cancellation-request`,
            { reason: input.reason, comment: input.comment },
          ),
    ),

  listSupport: (ctx: CustomerContext) =>
    guard(() =>
      useMockOperations ? mockOpsProvider.listSupport(ctx) : bookingApi.get<SupportRequest[]>("/api/v1/support"),
    ),

  createSupportRequest: (input: SupportRequestInput, ctx: CustomerContext & { email: string }) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.createSupportRequest(input, ctx)
        : bookingApi.post<SupportRequest>("/api/v1/support", input),
    ),

  addSupportMessage: (id: string, body: string, ctx: CustomerContext) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.addSupportMessage(id, body, ctx)
        : bookingApi.post<SupportRequest>(`/api/v1/support/${encodeURIComponent(id)}/messages`, { body }),
    ),

  /* -- admin ------------------------------------------------------- */

  adminListBookings: (query: BookingListQuery) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.adminListBookings(query)
        : bookingApi.get<Paged<AdminBookingListItem>>(`/api/v1/admin/bookings${queryString(query)}`),
    ),

  adminGetBooking: (reference: string) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.adminGetBooking(reference)
        : bookingApi.get<AdminBookingDetail>(`/api/v1/admin/bookings/${encodeURIComponent(reference)}`),
    ),

  adminAddNote: (reference: string, body: string, author: { name: string; role: string }) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.adminAddNote(reference, body, author)
        : bookingApi.post<InternalNote>(`/api/v1/admin/bookings/${encodeURIComponent(reference)}/notes`, { body }),
    ),

  adminUpdateCancellation: (
    reference: string,
    next: { status: CancellationRequest["status"]; refundStatus: CancellationRequest["refundStatus"]; note?: string },
    admin: { name: string },
  ) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.adminUpdateCancellation(reference, next, admin)
        : bookingApi.post<CancellationRequest>(
            `/api/v1/admin/bookings/${encodeURIComponent(reference)}/cancellation`,
            next,
          ),
    ),

  adminListSupport: (filters: { status?: SupportStatus | "all"; category?: string; search?: string }) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.adminListSupport(filters)
        : bookingApi.get<AdminSupportRequest[]>(`/api/v1/admin/support${queryString(filters as BookingListQuery)}`),
    ),

  adminUpdateSupport: (
    id: string,
    patch: { status?: SupportStatus; reply?: string; internal?: boolean },
    admin: { name: string },
  ) =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.adminUpdateSupport(id, patch, admin)
        : bookingApi.post<AdminSupportRequest>(`/api/v1/admin/support/${encodeURIComponent(id)}`, patch),
    ),

  adminOperationsMetrics: () =>
    guard(() =>
      useMockOperations
        ? mockOpsProvider.adminOperationsMetrics()
        : bookingApi.get<Awaited<ReturnType<typeof mockOpsProvider.adminOperationsMetrics>>>(
            "/api/v1/admin/operations/metrics",
          ),
    ),
};

export type { CustomerContext };
