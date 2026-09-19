/**
 * PHASE 13 — sanitized notification analytics.
 *
 * The notification service is not a React component, so it cannot use the
 * `useAnalytics()` hook. This helper records the same sanitized event shape the
 * Phase 10 tracker produces, through the same API boundary.
 *
 * Only event names, channel names, counts and states are ever recorded: no
 * message body, no email address, no phone number, no booking amount.
 */

import { analyticsApi } from "@/lib/analytics/analytics-api";
import { ANALYTICS_EVENTS, sanitizeProps, type AnalyticsProps } from "@/lib/analytics/events";
import { ensureSession, newEventId } from "@/lib/analytics/session";

type NotificationAnalyticsKey =
  | "notification_created"
  | "notification_delivered"
  | "notification_delivery_failed"
  | "notification_suppressed_duplicate"
  | "notification_read"
  | "notification_marked_all_read"
  | "notification_retry_requested";

const NAME_MAP: Record<NotificationAnalyticsKey, string> = {
  notification_created: ANALYTICS_EVENTS.notificationCreated,
  notification_delivered: ANALYTICS_EVENTS.notificationDelivered,
  notification_delivery_failed: ANALYTICS_EVENTS.notificationDeliveryFailed,
  notification_suppressed_duplicate: ANALYTICS_EVENTS.notificationSuppressedDuplicate,
  notification_read: ANALYTICS_EVENTS.notificationRead,
  notification_marked_all_read: ANALYTICS_EVENTS.notificationMarkedAllRead,
  notification_retry_requested: ANALYTICS_EVENTS.notificationRetryRequested,
};

/** Fire-and-forget. Never throws, never awaited. */
export function trackNotificationEvent(
  key: NotificationAnalyticsKey,
  props: AnalyticsProps,
): void {
  if (typeof window === "undefined") return;
  try {
    const { sessionId } = ensureSession();
    void analyticsApi.trackEvents([
      {
        id: newEventId(),
        sessionId,
        userId: null,
        name: NAME_MAP[key] as never,
        page: "notifications",
        props: sanitizeProps(props),
        occurredAt: new Date().toISOString(),
      },
    ]);
  } catch {
    /* analytics must never break notifications */
  }
}
