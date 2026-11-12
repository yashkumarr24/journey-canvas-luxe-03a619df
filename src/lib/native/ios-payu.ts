/** Native iOS only. Persist a reference, never a handoff token or signed form. */
export const IOS_PAYU_HANDOFF_ENABLED = import.meta.env.VITE_IOS_PAYU_HANDOFF_ENABLED === "true";
const KEY = "fnf.iosPaymentRecovery";
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const REF = /^FNFH[0-9A-F]{6}$/;

export function isIosPayment(platform?: { isNativePlatform?: () => boolean; getPlatform?: () => string }): boolean {
  return Boolean(platform?.isNativePlatform?.() && platform.getPlatform?.() === "ios");
}

export function iosPaymentAvailable(enabled = IOS_PAYU_HANDOFF_ENABLED): boolean {
  return enabled;
}

export function rememberIosPayment(ref: string, store: Storage, now = Date.now()): void {
  if (!REF.test(ref)) throw new Error("App payment is unavailable.");
  store.setItem(KEY, JSON.stringify({ ref, expiresAt: now + MAX_AGE_MS }));
}

/** Dismissal/resume/cold start only open status. Retain through app closure
 * while pending; expiry removes the reference without restarting payment. */
export function takeIosPaymentRecovery(store: Storage, now = Date.now()): string | null {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { ref?: unknown; expiresAt?: unknown };
    if (typeof value.ref !== "string" || !REF.test(value.ref) ||
        typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) ||
        value.expiresAt <= now || value.expiresAt > now + MAX_AGE_MS) {
      store.removeItem(KEY);
      return null;
    }
    return `/hotels/confirmation?ref=${encodeURIComponent(value.ref)}`;
  } catch {
    try { store.removeItem(KEY); } catch { /* Storage unavailable. */ }
    return null;
  }
}

export function validateIosHandoffUrl(raw: string, origin: string): string {
  const url = new URL(raw);
  const site = new URL(origin);
  if (url.origin !== site.origin || url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/api/public/payu-handoff" || url.search ||
      !/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)) throw new Error("App payment is unavailable.");
  return url.href;
}

/** No retries/fallbacks. Dependencies keep this controller testable offline. */
export async function beginIosPayment(options: {
  enabled: boolean;
  ref: string;
  store: Storage;
  request: () => Promise<{ bookingReference: string; handoffUrl: string }>;
  open: (url: string, ref: string) => Promise<void>;
}): Promise<void> {
  if (!options.enabled) throw new Error("App payment is unavailable.");
  rememberIosPayment(options.ref, options.store);
  const handoff = await options.request();
  if (handoff.bookingReference !== options.ref) throw new Error("App payment is unavailable.");
  await options.open(handoff.handoffUrl, options.ref);
}

export async function openIosPayment(url: string, ref: string): Promise<void> {
  if (!iosPaymentAvailable()) throw new Error("App payment is unavailable.");
  const { Capacitor } = await import("@capacitor/core");
  if (!isIosPayment(Capacitor)) throw new Error("App payment is unavailable.");
  const safeUrl = validateIosHandoffUrl(url, window.location.origin);
  rememberIosPayment(ref, window.localStorage);
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: safeUrl, presentationStyle: "popover" });
}