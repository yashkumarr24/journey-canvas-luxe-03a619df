/**
 * Activity tracking provider — the ONLY place the app emits analytics from.
 *
 * Guarantees:
 *   * Non-blocking. Events are queued in memory and flushed in the background.
 *     A failed flush is dropped, never retried forever, never shown to a user.
 *   * No duplicate page views. Route changes are de-duplicated by
 *     path + search string, so React re-renders cannot double count.
 *   * Batched. Flush happens on a timer, on queue size, and on page hide, so a
 *     search never waits on an analytics request.
 *   * Safe. Every property passes through `sanitizeProps`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";

import { useAuth } from "@/lib/auth/auth-context";

import { analyticsApi } from "./analytics-api";
import {
  ANALYTICS_EVENTS,
  pageKeyFromPath,
  sanitizeProps,
  type AnalyticsEvent,
  type AnalyticsEventInput,
  type AnalyticsEventName,
  type AnalyticsProps,
} from "./events";
import { describeSession, ensureSession, newEventId, touchSession } from "./session";

const FLUSH_INTERVAL_MS = 2500;
const FLUSH_AT_QUEUE = 8;
const MAX_QUEUE = 60;

interface AnalyticsContextValue {
  /** Fire-and-forget. Returns immediately. */
  track: (name: AnalyticsEventName, props?: AnalyticsProps) => void;
  /** Current opaque session id (empty string during SSR). */
  sessionId: string;
}

const AnalyticsContext = createContext<AnalyticsContextValue>({
  track: () => {},
  sessionId: "",
});

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { userId } = useAuth();

  const queue = useRef<AnalyticsEvent[]>([]);
  const sessionId = useRef<string>("");
  const currentPage = useRef<string>("");
  const lastPageKey = useRef<string>("");
  const userIdRef = useRef<string | null>(userId);

  userIdRef.current = userId;

  const flush = useCallback(() => {
    if (queue.current.length === 0) return;
    const batch = queue.current;
    queue.current = [];
    // Deliberately not awaited: the caller must never wait on analytics.
    void analyticsApi.trackEvents(batch);
  }, []);

  const enqueue = useCallback(
    (input: AnalyticsEventInput) => {
      if (typeof window === "undefined") return;
      try {
        if (!sessionId.current) sessionId.current = ensureSession().sessionId;
        const event: AnalyticsEvent = {
          id: newEventId(),
          sessionId: sessionId.current,
          userId: userIdRef.current ?? null,
          name: input.name,
          page: input.page ?? currentPage.current,
          props: sanitizeProps(input.props),
          occurredAt: new Date().toISOString(),
        };
        queue.current.push(event);
        if (queue.current.length > MAX_QUEUE) {
          queue.current = queue.current.slice(-MAX_QUEUE);
        }
        touchSession();
        if (queue.current.length >= FLUSH_AT_QUEUE) flush();
      } catch {
        /* tracking must never throw into product code */
      }
    },
    [flush],
  );

  const track = useCallback<AnalyticsContextValue["track"]>(
    (name, props) => enqueue({ name, props }),
    [enqueue],
  );

  /* --- session bootstrap ------------------------------------------------ */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const location = router.state.location;
    const pageKey = pageKeyFromPath(location.pathname);
    currentPage.current = pageKey;

    const { sessionId: id, startedAt, created } = ensureSession();
    sessionId.current = id;
    void analyticsApi.startSession(
      describeSession(id, startedAt, userIdRef.current, pageKey),
    );
    if (created) enqueue({ name: ANALYTICS_EVENTS.sessionStarted, page: pageKey });
    // First page view (route subscription below only fires on changes).
    lastPageKey.current = `${location.pathname}?${location.searchStr ?? ""}`;
    enqueue({ name: ANALYTICS_EVENTS.pageViewed, page: pageKey });
    flush();
    // Intentionally runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- keep the session's user id in step with sign in / sign out ------- */
  useEffect(() => {
    if (!sessionId.current) return;
    void analyticsApi.touchSession(sessionId.current, currentPage.current, userId ?? null);
  }, [userId]);

  /* --- page views on route change (de-duplicated) ----------------------- */
  useEffect(() => {
    const unsubscribe = router.subscribe("onResolved", ({ toLocation }) => {
      const signature = `${toLocation.pathname}?${toLocation.searchStr ?? ""}`;
      if (signature === lastPageKey.current) return;
      lastPageKey.current = signature;
      const pageKey = pageKeyFromPath(toLocation.pathname);
      currentPage.current = pageKey;
      enqueue({ name: ANALYTICS_EVENTS.pageViewed, page: pageKey });
      if (sessionId.current) {
        void analyticsApi.touchSession(sessionId.current, pageKey, userIdRef.current);
      }
    });
    return () => unsubscribe();
  }, [router, enqueue]);

  /* --- periodic flush + heartbeat + end of session ---------------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flushTimer = window.setInterval(flush, FLUSH_INTERVAL_MS);
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !sessionId.current) return;
      void analyticsApi.touchSession(
        sessionId.current,
        currentPage.current,
        userIdRef.current,
      );
    }, 30_000);

    const onHide = () => {
      flush();
      if (document.visibilityState === "hidden" && sessionId.current) {
        // Session end is recorded on unload; a returning tab simply reopens it.
        analyticsApi.endSession(sessionId.current);
      }
    };
    window.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);

    return () => {
      window.clearInterval(flushTimer);
      window.clearInterval(heartbeat);
      window.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);

  const value = useMemo<AnalyticsContextValue>(
    () => ({ track, sessionId: sessionId.current }),
    [track],
  );

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

/**
 * Access tracking from any component. Safe outside the provider (no-op), so a
 * component can never crash because analytics is missing.
 */
export function useAnalytics(): AnalyticsContextValue {
  return useContext(AnalyticsContext);
}

/** Fires `name` once when `enabled` becomes true (funnel step markers). */
export function useTrackOnce(
  name: AnalyticsEventName,
  enabled: boolean,
  props?: AnalyticsProps,
): void {
  const { track } = useAnalytics();
  const fired = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!enabled || fired.current) return;
    fired.current = true;
    track(name, propsRef.current);
  }, [enabled, name, track]);
}
