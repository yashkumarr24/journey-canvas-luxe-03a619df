/**
 * PHASE 13 — notification presentation helpers.
 *
 * Wording is deliberately careful: a "sent" demo delivery means our service
 * recorded an attempt through a demo provider, not that a real email, SMS or
 * WhatsApp message reached anyone. No provider is connected yet.
 */

import { CHANNEL_LABEL } from "@/lib/notifications/providers";
import type {
  NotificationDelivery,
  NotificationDeliveryState,
} from "@/types/notifications";

type Tone = "neutral" | "positive" | "warning" | "negative" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-foreground/15 bg-foreground/5 text-foreground/70",
  positive: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-700",
  negative: "border-red-600/30 bg-red-600/10 text-red-700",
  info: "border-sky-600/30 bg-sky-600/10 text-sky-700",
};

const STATE: Record<NotificationDeliveryState, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "warning" },
  sent: { label: "Sent", tone: "positive" },
  failed: { label: "Failed", tone: "negative" },
  retrying: { label: "Retrying", tone: "info" },
  skipped: { label: "Not configured", tone: "neutral" },
};

export function DeliveryBadge({ delivery }: { delivery: NotificationDelivery }) {
  const state = STATE[delivery.state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium tracking-wide ${TONE_CLASS[state.tone]}`}
      title={delivery.error ?? undefined}
    >
      {CHANNEL_LABEL[delivery.channel]} · {state.label}
      {delivery.mode === "demo" ? " (demo)" : ""}
    </span>
  );
}

export function formatNotificationTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
