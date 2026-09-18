/**
 * Local analytics store — the TEST/MOCK sink.
 *
 * Used while the FastAPI analytics endpoints do not exist yet. It keeps
 * sessions and events in localStorage and broadcasts changes to other tabs so
 * the admin dashboard can update in real time exactly as it will with Supabase
 * Realtime / WebSockets later.
 *
 * Nothing here is authoritative business data: it is capped, best-effort and
 * every operation swallows its own errors so analytics can never break a
 * booking flow.
 */

import type { AnalyticsEvent, AnalyticsSessionInfo } from "./events";
import { IDLE_AFTER_MS } from "./session";

const STORE_KEY = "ffh.analytics.store.v1";
const CHANNEL_NAME = "ffh-analytics";
const MAX_EVENTS = 4000;
const MAX_SESSIONS = 500;

export interface AnalyticsSnapshot {
  sessions: AnalyticsSessionInfo[];
  events: AnalyticsEvent[];
}

const EMPTY: AnalyticsSnapshot = { sessions: [], events: [] };

type Listener = (snapshot: AnalyticsSnapshot) => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => notify();
    } catch {
      channel = null;
    }
  }
  return channel;
}

function notify(): void {
  const snapshot = readStore();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      /* a broken dashboard listener must not break tracking */
    }
  });
}

export function readStore(): AnalyticsSnapshot {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as AnalyticsSnapshot;
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return EMPTY;
  }
}

function writeStore(snapshot: AnalyticsSnapshot, broadcast = true): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed: AnalyticsSnapshot = {
      sessions: snapshot.sessions.slice(-MAX_SESSIONS),
      events: snapshot.events.slice(-MAX_EVENTS),
    };
    window.localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota — drop silently */
  }
  notify();
  if (broadcast) {
    try {
      getChannel()?.postMessage({ type: "changed" });
    } catch {
      /* ignore */
    }
  }
}

/** Subscribe to store changes (same tab + other tabs). */
export function subscribeStore(listener: Listener): () => void {
  listeners.add(listener);
  getChannel();
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORE_KEY) notify();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function upsertSession(session: AnalyticsSessionInfo): void {
  const snapshot = readStore();
  const index = snapshot.sessions.findIndex((item) => item.sessionId === session.sessionId);
  if (index === -1) {
    snapshot.sessions = [...snapshot.sessions, session];
  } else {
    snapshot.sessions = snapshot.sessions.map((item, i) =>
      i === index ? { ...item, ...session } : item,
    );
  }
  writeStore(snapshot);
}

export function patchSession(
  sessionId: string,
  patch: Partial<AnalyticsSessionInfo>,
): void {
  const snapshot = readStore();
  if (!snapshot.sessions.some((item) => item.sessionId === sessionId)) return;
  snapshot.sessions = snapshot.sessions.map((item) =>
    item.sessionId === sessionId ? { ...item, ...patch } : item,
  );
  writeStore(snapshot);
}

export function appendEvents(events: AnalyticsEvent[]): void {
  if (events.length === 0) return;
  const snapshot = readStore();
  const known = new Set(snapshot.events.map((event) => event.id));
  const fresh = events.filter((event) => !known.has(event.id));
  if (fresh.length === 0) return;
  snapshot.events = [...snapshot.events, ...fresh];

  // Keep session "last activity" and "current page" in step with the events.
  const last = fresh[fresh.length - 1];
  snapshot.sessions = snapshot.sessions.map((session) =>
    session.sessionId === last.sessionId
      ? {
          ...session,
          lastActivityAt: last.occurredAt,
          currentPage: last.page || session.currentPage,
          userId: last.userId ?? session.userId,
          status: session.status === "ended" ? "ended" : "active",
        }
      : session,
  );
  writeStore(snapshot);
}

export function endSession(sessionId: string): void {
  patchSession(sessionId, { status: "ended", lastActivityAt: new Date().toISOString() });
}

export function resetStore(): void {
  writeStore({ sessions: [], events: [] });
}

/** Replace the whole store (used by the demo seeder). */
export function replaceStore(snapshot: AnalyticsSnapshot): void {
  writeStore(snapshot);
}

/** Sessions whose last activity is inside the idle window. */
export function isSessionActive(session: AnalyticsSessionInfo, now = Date.now()): boolean {
  if (session.status === "ended") return false;
  const last = Date.parse(session.lastActivityAt);
  return Number.isFinite(last) && now - last < IDLE_AFTER_MS;
}
