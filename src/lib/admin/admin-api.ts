/**
 * Admin analytics data access.
 *
 * Local test mode (today): reads the mock analytics store and subscribes to its
 * change notifications, so the dashboard updates incrementally the moment an
 * event is tracked in any tab.
 *
 * Backend mode (later): the same hook polls / listens to FastAPI:
 *   GET       /api/v1/admin/analytics/overview
 *   GET       /api/v1/admin/analytics/activity
 *   GET       /api/v1/admin/analytics/funnel
 *   GET       /api/v1/admin/analytics/sessions
 *   WebSocket /api/v1/admin/analytics/live
 * Every one of those is authorised server-side by `require_admin(level)`.
 */

import { useEffect, useState } from "react";

import { bookingApiBaseUrl, isBookingApiConfigured } from "@/lib/booking-api";
import { useMockAnalytics } from "@/lib/analytics/analytics-api";
import { readStore, subscribeStore, type AnalyticsSnapshot } from "@/lib/analytics/analytics-store";

const EMPTY: AnalyticsSnapshot = { sessions: [], events: [] };
const POLL_MS = 15_000;

async function fetchSnapshot(): Promise<AnalyticsSnapshot> {
  const response = await fetch(`${bookingApiBaseUrl}/api/v1/admin/analytics/sessions`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("admin_analytics_unavailable");
  const data = (await response.json()) as Partial<AnalyticsSnapshot>;
  return {
    sessions: data.sessions ?? [],
    events: data.events ?? [],
  };
}

export interface AdminSnapshotState {
  snapshot: AnalyticsSnapshot;
  /** Set when the live feed could not be reached (dashboard still renders). */
  error: string | null;
  /** True while the very first read is in flight. */
  loading: boolean;
  /** Increments on every incremental update — used for "live" indicators. */
  revision: number;
}

/**
 * Live analytics snapshot. Updates incrementally: no full dashboard reload, no
 * refetch storm — the store notifies, the components re-derive.
 */
export function useAdminSnapshot(): AdminSnapshotState {
  const [state, setState] = useState<AdminSnapshotState>({
    snapshot: EMPTY,
    error: null,
    loading: true,
    revision: 0,
  });

  useEffect(() => {
    let cancelled = false;

    if (useMockAnalytics || !isBookingApiConfigured) {
      const apply = (snapshot: AnalyticsSnapshot) => {
        if (cancelled) return;
        setState((prev) => ({
          snapshot,
          error: null,
          loading: false,
          revision: prev.revision + 1,
        }));
      };
      apply(readStore());
      const unsubscribe = subscribeStore(apply);
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }

    const load = async () => {
      try {
        const snapshot = await fetchSnapshot();
        if (cancelled) return;
        setState((prev) => ({
          snapshot,
          error: null,
          loading: false,
          revision: prev.revision + 1,
        }));
      } catch {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: "Live analytics feed is unavailable.",
        }));
      }
    };

    void load();

    // WebSocket pushes a tiny "changed" hint; the snapshot is re-read once.
    let socket: WebSocket | null = null;
    try {
      const url = `${bookingApiBaseUrl.replace(/^http/, "ws")}/api/v1/admin/analytics/live`;
      socket = new WebSocket(url);
      socket.onmessage = () => void load();
    } catch {
      socket = null;
    }
    const timer = window.setInterval(() => void load(), POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      socket?.close();
    };
  }, []);

  return state;
}
