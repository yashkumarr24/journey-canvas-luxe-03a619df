/**
 * Notification entry point for the Phase 11 operations code.
 *
 * PHASE 13: this file is now a thin compatibility shim. All channel selection,
 * message composition, provider dispatch, delivery state and idempotency live in
 * the centralized service (`@/lib/notifications/notification-service`), so no
 * booking, payment or support module contains provider-specific logic.
 *
 * The `notify()` signature is unchanged on purpose — every Phase 11 call site
 * keeps working exactly as before.
 */

import { notificationService } from "@/lib/notifications/notification-service";
import type { NotificationRecord } from "@/types/notifications";
import type { NotificationEvent, NotificationType } from "@/types/operations";

export interface NotifyInput {
  type: NotificationType;
  title?: string;
  body?: string;
  audience?: NotificationEvent["audience"];
  bookingReference?: string | null;
  supportRequestId?: string | null;
  /** Explicit idempotency key when the caller can retry the same action. */
  dedupeKey?: string | null;
}

/** Record + dispatch a notification. Never throws: notifications never block a flow. */
export function notify(input: NotifyInput): NotificationRecord | null {
  return notificationService.emit(input);
}

export function listNotifications(limit = 50): NotificationRecord[] {
  return notificationService.list({ audience: "customer", limit });
}
