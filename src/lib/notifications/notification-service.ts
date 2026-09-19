/**
 * PHASE 13 — centralized notification service.
 *
 * This is the ONLY place that decides channels, composes messages, talks to
 * providers and tracks delivery state. Booking, payment, cancellation and
 * support code calls `notificationService.emit({ type, ... })` and nothing else.
 *
 * Guarantees this module is required to keep:
 *  1. It never throws. Every public function swallows its own failures, so a
 *     notification problem can never fail a booking or a payment.
 *  2. Delivery is fire-and-forget. No caller ever awaits a provider.
 *  3. Idempotency: a repeat emit with the same dedupe key inside the dedupe
 *     window is ignored, so a retried checkout cannot double-notify.
 *  4. Only references and statuses are stored — never card data, OTPs,
 *     passwords, passport/document numbers or unnecessary PII.
 *
 * Storage is the existing Phase 11 ops store while the local test provider is
 * in use. Once the backend is configured, the same records come from
 * `notification_events` through `notificationsApi`.
 */

import { opsId, readOpsStore, updateOpsStore } from "@/lib/ops/ops-store";
import { getNotificationProvider } from "@/lib/notifications/providers";
import { renderTemplate, NOTIFICATION_TEMPLATES } from "@/lib/notifications/templates";
import { trackNotificationEvent } from "@/lib/notifications/notification-analytics";
import type {
  NotificationChannel,
  NotificationDelivery,
  NotificationEmitInput,
  NotificationListQuery,
  NotificationRecord,
} from "@/types/notifications";

/** A repeat of the same event inside this window is treated as a duplicate. */
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
/** Bounded retries — the architecture is queue-ready, but nothing loops forever. */
const MAX_ATTEMPTS = 3;

function nowIso(): string {
  return new Date().toISOString();
}

function defaultDedupeKey(input: NotificationEmitInput, title: string): string {
  const ref = input.bookingReference ?? input.supportRequestId ?? "none";
  return `${input.type}:${ref}:${title}`;
}

function readRecords(): NotificationRecord[] {
  return readOpsStore().notifications as NotificationRecord[];
}

function writeRecords(mutate: (records: NotificationRecord[]) => NotificationRecord[]): void {
  try {
    updateOpsStore((store) => ({
      ...store,
      notifications: mutate(store.notifications as NotificationRecord[]),
    }));
  } catch {
    /* storage failures must not surface into a booking flow */
  }
}

function patchRecord(id: string, patch: Partial<NotificationRecord>): void {
  writeRecords((records) =>
    records.map((record) => (record.id === id ? { ...record, ...patch } : record)),
  );
}

function isDuplicate(dedupeKey: string): boolean {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  return readRecords().some(
    (record) =>
      record.dedupeKey === dedupeKey && new Date(record.createdAt).getTime() >= cutoff,
  );
}

function initialDeliveries(channels: NotificationChannel[]): NotificationDelivery[] {
  return channels.map((channel) => {
    const provider = getNotificationProvider(channel);
    return {
      channel,
      // No provider registered for the channel yet -> honestly "skipped".
      state: provider ? "queued" : "skipped",
      attempts: 0,
      providerId: provider?.id ?? "none",
      mode: provider?.mode ?? "demo",
      updatedAt: nowIso(),
      error: provider ? null : "No provider configured for this channel",
    };
  });
}

function updateDelivery(
  id: string,
  channel: NotificationChannel,
  patch: Partial<NotificationDelivery>,
): void {
  writeRecords((records) =>
    records.map((record) => {
      if (record.id !== id) return record;
      const deliveries = (record.deliveries ?? []).map((delivery) =>
        delivery.channel === channel
          ? { ...delivery, ...patch, updatedAt: nowIso() }
          : delivery,
      );
      const attempted = deliveries.filter((delivery) => delivery.state !== "skipped");
      return {
        ...record,
        deliveries,
        // "dispatched" means every attempted channel reported success.
        dispatched: attempted.length > 0 && attempted.every((d) => d.state === "sent"),
      };
    }),
  );
}

/** Attempt one channel. Never throws, never awaited by product code. */
async function deliver(record: NotificationRecord, channel: NotificationChannel): Promise<void> {
  const provider = getNotificationProvider(channel);
  if (!provider) return;

  const current = (record.deliveries ?? []).find((d) => d.channel === channel);
  const attempts = (current?.attempts ?? 0) + 1;

  try {
    const result = await provider.send({
      notificationId: record.id,
      channel,
      type: record.type,
      title: record.title,
      body: record.body,
      bookingReference: record.bookingReference ?? null,
      supportRequestId: record.supportRequestId ?? null,
    });

    if (result.ok) {
      updateDelivery(record.id, channel, { state: "sent", attempts, error: null });
      trackNotificationEvent("notification_delivered", {
        notification_type: record.type,
        channel,
        provider_mode: provider.mode,
      });
      return;
    }

    const retryable = attempts < MAX_ATTEMPTS;
    updateDelivery(record.id, channel, {
      state: retryable ? "retrying" : "failed",
      attempts,
      error: result.error ?? "Provider rejected the message",
    });
    trackNotificationEvent("notification_delivery_failed", {
      notification_type: record.type,
      channel,
      attempts,
      retrying: retryable,
    });
  } catch {
    const retryable = attempts < MAX_ATTEMPTS;
    updateDelivery(record.id, channel, {
      state: retryable ? "retrying" : "failed",
      attempts,
      error: "Delivery attempt failed",
    });
  }
}

/** Dispatch every queued channel. Fire-and-forget by design. */
function dispatch(record: NotificationRecord): void {
  const channels = (record.deliveries ?? [])
    .filter((delivery) => delivery.state === "queued" || delivery.state === "retrying")
    .map((delivery) => delivery.channel);
  channels.forEach((channel) => {
    void deliver(record, channel);
  });
}

export const notificationService = {
  /**
   * Record a notification and start delivery. Returns the record, or null when
   * it was a duplicate or something went wrong — callers ignore the result.
   */
  emit(input: NotificationEmitInput): NotificationRecord | null {
    try {
      const template = NOTIFICATION_TEMPLATES[input.type];
      const rendered = renderTemplate(input.type, input.bookingReference);
      const title = input.title ?? rendered.title;
      const body = input.body ?? rendered.body;
      const dedupeKey = input.dedupeKey ?? defaultDedupeKey(input, title);

      if (isDuplicate(dedupeKey)) {
        trackNotificationEvent("notification_suppressed_duplicate", {
          notification_type: input.type,
        });
        return null;
      }

      const channels = input.channels ?? template.channels;
      const record: NotificationRecord = {
        id: opsId("ntf"),
        type: input.type,
        title,
        body,
        createdAt: nowIso(),
        bookingReference: input.bookingReference ?? null,
        supportRequestId: input.supportRequestId ?? null,
        audience: input.audience ?? template.audience,
        channels,
        dispatched: false,
        readAt: null,
        dedupeKey,
        deliveries: initialDeliveries(channels),
      };

      writeRecords((records) => [...records, record]);
      trackNotificationEvent("notification_created", {
        notification_type: record.type,
        audience: record.audience,
        channel_count: channels.length,
      });
      dispatch(record);
      return record;
    } catch {
      return null;
    }
  },

  list(query: NotificationListQuery = {}): NotificationRecord[] {
    try {
      const { audience = "customer", unreadOnly = false, bookingReference, limit = 50 } = query;
      return readRecords()
        .filter((record) => record.audience === audience)
        .filter((record) => (unreadOnly ? !record.readAt : true))
        .filter((record) =>
          bookingReference ? record.bookingReference === bookingReference : true,
        )
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    } catch {
      return [];
    }
  },

  unreadCount(audience: NotificationRecord["audience"] = "customer"): number {
    try {
      return readRecords().filter((r) => r.audience === audience && !r.readAt).length;
    } catch {
      return 0;
    }
  },

  markRead(id: string): void {
    patchRecord(id, { readAt: nowIso() });
    trackNotificationEvent("notification_read", {});
  },

  markAllRead(audience: NotificationRecord["audience"] = "customer"): void {
    const stamp = nowIso();
    writeRecords((records) =>
      records.map((record) =>
        record.audience === audience && !record.readAt ? { ...record, readAt: stamp } : record,
      ),
    );
    trackNotificationEvent("notification_marked_all_read", { audience });
  },

  /**
   * Retry the failed channels of one notification (admin action).
   * Queue-ready: a future background worker calls exactly this.
   */
  retry(id: string): void {
    try {
      const record = readRecords().find((r) => r.id === id);
      if (!record) return;
      const deliveries = (record.deliveries ?? []).map((delivery) =>
        delivery.state === "failed" || delivery.state === "retrying"
          ? { ...delivery, state: "retrying" as const, updatedAt: nowIso() }
          : delivery,
      );
      patchRecord(id, { deliveries });
      dispatch({ ...record, deliveries });
      trackNotificationEvent("notification_retry_requested", {
        notification_type: record.type,
      });
    } catch {
      /* a retry that cannot start is not an application error */
    }
  },
};
