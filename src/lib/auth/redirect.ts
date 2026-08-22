/**
 * Open-redirect protection.
 *
 * The login page accepts a `redirect` search param so a user who was bounced
 * off a protected page returns there after signing in. An attacker must not be
 * able to turn that into `?redirect=https://evil.example`, a protocol-relative
 * `//evil.example`, or a `javascript:` URL.
 *
 * Rule: only same-origin, absolute application PATHS are allowed.
 */

const FALLBACK = "/account";

/** Paths a signed-in user should never be sent "back" to. */
const DENIED_PREFIXES = ["/auth"];

export function sanitizeRedirect(value: unknown, fallback: string = FALLBACK): string {
  if (typeof value !== "string") return fallback;

  const raw = value.trim();
  if (!raw) return fallback;

  // Must be a rooted path, not an absolute URL and not protocol-relative.
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;

  // Reject anything that still parses as an absolute URL (e.g. "/\evil").
  let path: string;
  try {
    const parsed = new URL(raw, "http://internal.invalid");
    if (parsed.origin !== "http://internal.invalid") return fallback;
    path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }

  // Control characters / encoded scheme tricks.
  if (/[\u0000-\u001f\u007f]/.test(path)) return fallback;
  if (/^\/+\w+:/i.test(path)) return fallback;

  if (DENIED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return fallback;

  return path;
}

export const defaultAfterLogin = FALLBACK;
