/**
 * Anonymous / authenticated session identity for analytics.
 *
 * The session id is an OPAQUE random string. It is not derived from the user,
 * carries no PII and is stored in sessionStorage so it dies with the tab.
 * A logged-in user id is attached separately (server-verified later), so a
 * guest session simply has `userId: null`.
 */

import type { AnalyticsSessionInfo, DeviceCategory } from "./events";

const SESSION_KEY = "ffh.analytics.session.v1";
/** A session goes idle after this long without activity. */
export const IDLE_AFTER_MS = 30 * 60 * 1000;

function randomId(prefix: string): string {
  const bytes =
    typeof crypto !== "undefined" && "getRandomValues" in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(12)))
      : Array.from({ length: 12 }, () => Math.floor(Math.random() * 256));
  return `${prefix}_${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function newSessionId(): string {
  return randomId("ses");
}

export function newEventId(): string {
  return randomId("evt");
}

export function detectDevice(): DeviceCategory {
  if (typeof window === "undefined") return "desktop";
  const ua = navigator.userAgent;
  const width = window.innerWidth;
  if (/iPad|Tablet/i.test(ua) || (width >= 640 && width < 1024)) return "tablet";
  if (/Mobi|Android|iPhone/i.test(ua) || width < 640) return "mobile";
  return "desktop";
}

/** Coarse browser family only — never the full user-agent string. */
export function detectBrowser(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  if (/Firefox\//.test(ua)) return "Firefox";
  return "Other";
}

/** Coarse platform family only. */
export function detectPlatform(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iOS/i.test(ua)) return "iOS";
  if (/Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Other";
}

interface StoredSession {
  sessionId: string;
  startedAt: string;
  lastActivityAt: string;
}

function read(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(value: StoredSession): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    /* private mode / quota — analytics must never break the app */
  }
}

export interface EnsuredSession {
  sessionId: string;
  startedAt: string;
  /** True when this call created the session (emit `session_started`). */
  created: boolean;
}

/**
 * Returns the current session, creating one when absent or after the idle
 * window has elapsed. Safe to call on every navigation.
 */
export function ensureSession(): EnsuredSession {
  const now = new Date();
  const existing = read();
  if (existing) {
    const last = Date.parse(existing.lastActivityAt);
    if (Number.isFinite(last) && now.getTime() - last < IDLE_AFTER_MS) {
      write({ ...existing, lastActivityAt: now.toISOString() });
      return { sessionId: existing.sessionId, startedAt: existing.startedAt, created: false };
    }
  }
  const created: StoredSession = {
    sessionId: newSessionId(),
    startedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
  };
  write(created);
  return { sessionId: created.sessionId, startedAt: created.startedAt, created: true };
}

export function touchSession(): void {
  const existing = read();
  if (existing) write({ ...existing, lastActivityAt: new Date().toISOString() });
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function describeSession(
  sessionId: string,
  startedAt: string,
  userId: string | null,
  currentPage: string,
): AnalyticsSessionInfo {
  const nowIso = new Date().toISOString();
  return {
    sessionId,
    userId,
    startedAt,
    lastActivityAt: nowIso,
    currentPage,
    device: detectDevice(),
    browser: detectBrowser(),
    platform: detectPlatform(),
    status: "active",
  };
}
