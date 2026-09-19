/**
 * PHASE 13 — channel provider registry (DEMO MODE).
 *
 * Every channel is behind the same `NotificationProvider` interface, so the
 * notification service never contains provider-specific logic and booking /
 * payment / support code never touches a provider at all.
 *
 * WHAT IS CONNECTED TODAY: nothing. These are demo providers that record an
 * attempt locally so the workflow, delivery states and admin desk can be walked
 * end to end without credentials.
 *
 * WHEN REAL PROVIDERS ARRIVE: they are implemented in the BACKEND
 * (`backend/app/services/notifications.py`) and their keys live in backend-only
 * environment variables. No provider key is ever read here, and no `VITE_`
 * variable may ever hold a secret. The browser keeps talking to our own API.
 */

import type {
  NotificationChannel,
  NotificationProvider,
  NotificationSendResult,
} from "@/types/notifications";

function demoProvider(channel: NotificationChannel, id: string): NotificationProvider {
  return {
    id,
    channel,
    mode: "demo",
    async send(): Promise<NotificationSendResult> {
      // A demo send is a local record of intent. It never leaves the browser.
      return { ok: true };
    },
  };
}

/** In-app is genuinely delivered locally: the record itself IS the delivery. */
const inAppProvider: NotificationProvider = {
  id: "in-app",
  channel: "in_app",
  mode: "live",
  async send(): Promise<NotificationSendResult> {
    return { ok: true };
  },
};

const REGISTRY: Partial<Record<NotificationChannel, NotificationProvider>> = {
  in_app: inAppProvider,
  email: demoProvider("email", "demo-email"),
  sms: demoProvider("sms", "demo-sms"),
  whatsapp: demoProvider("whatsapp", "demo-whatsapp"),
  // push: intentionally unregistered — deliveries are marked "skipped".
};

export function getNotificationProvider(
  channel: NotificationChannel,
): NotificationProvider | null {
  return REGISTRY[channel] ?? null;
}

/** True while no real Email/SMS/WhatsApp provider is connected. */
export const notificationsDemoMode = Object.values(REGISTRY).some(
  (provider) => provider?.mode === "demo",
);

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  in_app: "In-app",
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  push: "Push",
};
