/**
 * PHASE 13 — notification contracts.
 *
 * These types describe the delivery layer that sits on top of the Phase 11
 * `notification_events` records. Rules that hold everywhere in this file:
 *
 *  - a notification carries REFERENCES and STATUSES only. Never a card detail,
 *    OTP, password, passport/document number, provider credential or a full
 *    contact record,
 *  - a delivery state describes what our own service attempted. It never
 *    claims a provider confirmed anything, because no real Email/SMS/WhatsApp
 *    provider is connected yet,
 *  - delivery NEVER decides booking or payment success. A failed notification
 *    is a notification problem, nothing else.
 */

import type { NotificationEvent, NotificationType } from "@/types/operations";

export type NotificationChannel = "in_app" | "email" | "sms" | "whatsapp" | "push";

/** Safe delivery states. `skipped` = no provider is wired for that channel. */
export type NotificationDeliveryState = "queued" | "sent" | "failed" | "retrying" | "skipped";

export interface NotificationDelivery {
  channel: NotificationChannel;
  state: NotificationDeliveryState;
  /** How many send attempts the service has made (never unbounded). */
  attempts: number;
  /** Provider identifier, e.g. "demo-email". Never a key or endpoint. */
  providerId: string;
  /** Provider mode, so the UI can label demo delivery honestly. */
  mode: "demo" | "live";
  updatedAt: string;
  /** Short, non-sensitive failure reason for the admin desk. */
  error?: string | null;
}

export type NotificationAudience = NotificationEvent["audience"];

/** A stored notification plus its read state and delivery attempts. */
export interface NotificationRecord extends NotificationEvent {
  /** Null while unread. */
  readAt?: string | null;
  /** Idempotency key — a repeat emit with the same key is ignored. */
  dedupeKey?: string | null;
  deliveries?: NotificationDelivery[];
}

/** What the centralized service is asked to emit. */
export interface NotificationEmitInput {
  type: NotificationType;
  /** Optional override; the template supplies a default. */
  title?: string;
  body?: string;
  audience?: NotificationAudience;
  bookingReference?: string | null;
  supportRequestId?: string | null;
  /** Restrict the channels for this one event (defaults to the template). */
  channels?: NotificationChannel[];
  /** Explicit idempotency key. Defaults to type + reference + title. */
  dedupeKey?: string | null;
}

/** The payload a channel provider receives. Contains no PII beyond references. */
export interface NotificationMessage {
  notificationId: string;
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  body: string;
  bookingReference?: string | null;
  supportRequestId?: string | null;
}

export interface NotificationSendResult {
  ok: boolean;
  /** Short reason when `ok` is false. Never a stack trace or credential. */
  error?: string;
}

/**
 * Channel provider abstraction.
 *
 * Booking, payment and support code never talks to a provider: it emits an
 * event through the notification service, and the service picks the provider
 * registered for each channel. Swapping the demo provider for a real one is a
 * registry change, nothing more.
 */
export interface NotificationProvider {
  id: string;
  channel: NotificationChannel;
  mode: "demo" | "live";
  send(message: NotificationMessage): Promise<NotificationSendResult>;
}

export interface NotificationListQuery {
  audience?: NotificationAudience;
  unreadOnly?: boolean;
  bookingReference?: string | null;
  limit?: number;
}
