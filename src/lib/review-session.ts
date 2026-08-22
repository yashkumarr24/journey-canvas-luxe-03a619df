/**
 * Guest continuity for a fare review session.
 *
 * The server issues a `guestToken` once, when a signed-out visitor selects a
 * fare. It is the ONLY thing that lets that browser resume the session, so it
 * is kept in `sessionStorage` (cleared when the tab closes) and never placed
 * in a URL, a query string or a shared link.
 *
 * It is not a credential for anything else: it grants access to one review
 * session and nothing beyond it.
 */

const KEY_PREFIX = "fnf.guestToken.";

function storage(): Storage | null {
  // SSR has no sessionStorage, and Safari private mode can throw on access.
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberGuestToken(reviewToken: string, guestToken?: string | null): void {
  if (!guestToken) return;
  storage()?.setItem(KEY_PREFIX + reviewToken, guestToken);
}

export function readGuestToken(reviewToken: string): string | null {
  return storage()?.getItem(KEY_PREFIX + reviewToken) ?? null;
}

export function forgetGuestToken(reviewToken: string): void {
  storage()?.removeItem(KEY_PREFIX + reviewToken);
}

/** Stable per-attempt key so a double-click cannot create two pre-bookings. */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  const raw =
    cryptoApi && typeof cryptoApi.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  // Backend accepts [A-Za-z0-9_-]{16,128}.
  return raw.replace(/[^A-Za-z0-9_-]/g, "").padEnd(16, "0").slice(0, 128);
}
