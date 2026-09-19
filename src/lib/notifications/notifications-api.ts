/**
 * PHASE 13 — single frontend boundary for notifications.
 *
 * Every notification screen (customer and admin) calls this module and nothing
 * else. Two implementations sit behind it, exactly like Phase 11 operations:
 *
 *   VITE_BOOKING_API_URL set    -> FastAPI endpoints (contracts below)
 *   VITE_BOOKING_API_URL unset  -> local demo service, clearly labelled
 *
 * Contracts (FastAPI, `backend/app/api/v1/notifications.py`):
 *   GET   /api/v1/notifications                    customer, own records only
 *   GET   /api/v1/notifications/unread-count       customer
 *   POST  /api/v1/notifications/{id}/read          customer
 *   POST  /api/v1/notifications/read-all           customer
 *   GET   /api/v1/admin/notifications              admin level 1
 *   POST  /api/v1/admin/notifications/{id}/retry   admin level 2
 *
 * The frontend never sends an audience, a user id, an admin level or a provider
 * name: the backend derives all of them from the verified token.
 */

import { bookingApi, isBookingApiConfigured, toBookingError } from "@/lib/booking-api";
import { notificationService } from "@/lib/notifications/notification-service";
import type { NotificationListQuery, NotificationRecord } from "@/types/notifications";

/** True while the local demo notification service is in use. */
export const useMockNotifications = !isBookingApiConfigured;

export class NotificationApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NotificationApiError";
  }
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const api = toBookingError(error);
    throw new NotificationApiError(api.kind, api.message);
  }
}

function queryString(query: NotificationListQuery): string {
  const params = new URLSearchParams();
  if (query.unreadOnly) params.set("unread_only", "true");
  if (query.bookingReference) params.set("booking_reference", query.bookingReference);
  if (query.limit) params.set("limit", String(query.limit));
  const raw = params.toString();
  return raw ? `?${raw}` : "";
}

export const notificationsApi = {
  /** Customer notification centre. */
  list: (query: NotificationListQuery = {}): Promise<NotificationRecord[]> =>
    guard(async () =>
      useMockNotifications
        ? notificationService.list({ ...query, audience: "customer" })
        : bookingApi.get<NotificationRecord[]>(`/api/v1/notifications${queryString(query)}`),
    ),

  unreadCount: (): Promise<number> =>
    guard(async () =>
      useMockNotifications
        ? notificationService.unreadCount("customer")
        : (await bookingApi.get<{ count: number }>("/api/v1/notifications/unread-count")).count,
    ),

  markRead: (id: string): Promise<void> =>
    guard(async () => {
      if (useMockNotifications) {
        notificationService.markRead(id);
        return;
      }
      await bookingApi.post(`/api/v1/notifications/${encodeURIComponent(id)}/read`);
    }),

  markAllRead: (): Promise<void> =>
    guard(async () => {
      if (useMockNotifications) {
        notificationService.markAllRead("customer");
        return;
      }
      await bookingApi.post("/api/v1/notifications/read-all");
    }),

  /** Admin operations desk — level 1 read. */
  adminList: (query: NotificationListQuery = {}): Promise<NotificationRecord[]> =>
    guard(async () =>
      useMockNotifications
        ? notificationService.list({ ...query, audience: query.audience ?? "admin" })
        : bookingApi.get<NotificationRecord[]>(
            `/api/v1/admin/notifications${queryString(query)}`,
          ),
    ),

  /** Retry the failed channels of one notification — level 2. */
  adminRetry: (id: string): Promise<void> =>
    guard(async () => {
      if (useMockNotifications) {
        notificationService.retry(id);
        return;
      }
      await bookingApi.post(`/api/v1/admin/notifications/${encodeURIComponent(id)}/retry`);
    }),
};
