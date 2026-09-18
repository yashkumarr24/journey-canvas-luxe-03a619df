/**
 * Notification event foundation (PHASE 11).
 *
 * This module RECORDS events. It does not send anything: no email, SMS,
 * WhatsApp or push provider is connected, so every event is stored with
 * `dispatched: false` and the channels it would eventually use.
 *
 * When a provider is added later, the only change needed is a dispatcher that
 * consumes these records server-side — the call sites below stay identical.
 * Payloads carry references and statuses only: never a password, OTP, card
 * detail, API key or full contact record.
 */

import { opsId, readOpsStore, updateOpsStore } from "@/lib/ops/ops-store";
import type { NotificationEvent, NotificationType } from "@/types/operations";

type Channels = NotificationEvent["channels"];

const DEFAULT_CHANNELS: Record<NotificationType, Channels> = {
  booking_created: ["in_app", "email"],
  booking_confirmed: ["in_app", "email", "whatsapp"],
  payment_successful: ["in_app", "email"],
  payment_failed: ["in_app", "email"],
  booking_failed: ["in_app", "email", "sms"],
  cancellation_requested: ["in_app", "email"],
  cancellation_status_changed: ["in_app", "email"],
  refund_status_changed: ["in_app", "email"],
  support_request_created: ["in_app", "email"],
  support_request_updated: ["in_app", "email"],
};

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  audience?: NotificationEvent["audience"];
  bookingReference?: string | null;
  supportRequestId?: string | null;
}

/** Record a notification event. Never throws — notifications must not block a flow. */
export function notify(input: NotifyInput): NotificationEvent | null {
  try {
    const event: NotificationEvent = {
      id: opsId("ntf"),
      type: input.type,
      title: input.title,
      body: input.body,
      createdAt: new Date().toISOString(),
      bookingReference: input.bookingReference ?? null,
      supportRequestId: input.supportRequestId ?? null,
      audience: input.audience ?? "customer",
      channels: DEFAULT_CHANNELS[input.type],
      dispatched: false,
    };
    updateOpsStore((store) => ({ ...store, notifications: [...store.notifications, event] }));
    return event;
  } catch {
    return null;
  }
}

export function listNotifications(limit = 50): NotificationEvent[] {
  return readOpsStore()
    .notifications.slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
