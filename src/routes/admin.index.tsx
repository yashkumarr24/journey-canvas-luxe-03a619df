import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin/AdminShell";
import { LiveActivityTable } from "@/components/admin/LiveActivityTable";
import { MetricCard, MetricGrid } from "@/components/admin/MetricCard";
import { DemoActivityControls } from "@/components/admin/DemoActivityControls";
import { useAdminSnapshot } from "@/lib/admin/admin-api";
import {
  defaultFilters,
  liveActivity,
  overview,
  type AnalyticsFilters as Filters,
} from "@/lib/analytics/admin-analytics";
import { AnalyticsFilters } from "@/components/admin/AnalyticsFilters";

/**
 * Admin dashboard: headline metrics + live activity.
 *
 * Updates are incremental — a tracked event notifies the store/socket and only
 * the derived numbers re-render. There is no full dashboard reload.
 */
export const Route = createFileRoute("/admin/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Dashboard — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Live sessions, searches, checkouts and bookings across Fly n Feel.",
      },
      { property: "og:title", content: "Fly n Feel Admin dashboard" },
      { property: "og:description", content: "Live platform activity and booking metrics." },
    ],
  }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const { snapshot, loading, error, revision } = useAdminSnapshot();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(7));

  const metrics = useMemo(() => overview(snapshot, filters), [snapshot, filters]);
  const rows = useMemo(() => liveActivity(snapshot, 12), [snapshot, revision]);

  return (
    <AdminShell
      title="Dashboard"
      description="What is happening across flights and hotels right now, and how the selected date range performed."
      permission="dashboard.view"
    >
      <AnalyticsFilters
        value={filters}
        onChange={setFilters}
        showEventType={false}
        showBookingStatus={false}
      />

      {error ? (
        <p className="mb-4 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
          {error} Numbers below may be incomplete.
        </p>
      ) : null}

      <MetricGrid>
        <MetricCard
          label="Active now"
          value={metrics.activeSessions}
          hint="Sessions with activity in the last 30 minutes."
        />
        <MetricCard
          label="Sessions"
          value={metrics.totalSessions}
          hint="Distinct sessions in the selected range."
        />
        <MetricCard
          label="Signed-in users"
          value={metrics.authenticatedUsers}
          hint="Distinct customer accounts seen in range."
        />
        <MetricCard
          label="Guest sessions"
          value={metrics.guestSessions}
          hint="Sessions with no signed-in account."
        />
        <MetricCard
          label="Flight searches"
          value={metrics.flightSearches}
          hint="Search events, not sessions."
        />
        <MetricCard
          label="Hotel searches"
          value={metrics.hotelSearches}
          hint="Search events, not sessions."
        />
        <MetricCard
          label="Checkouts started"
          value={metrics.checkoutsStarted}
          hint="Flights + hotels combined."
        />
        <MetricCard
          label="Payments started"
          value={metrics.paymentsStarted}
          hint="Payment attempts opened by a visitor."
        />
        <MetricCard
          label="Bookings completed"
          value={metrics.bookingsCompleted}
          tone="positive"
          hint="Confirmed bookings in range."
        />
        <MetricCard
          label="Bookings failed"
          value={metrics.bookingsFailed}
          tone="negative"
          hint="Booking attempts that ended in failure."
        />
        <MetricCard
          label="Abandoned"
          value={metrics.abandonedSessions}
          hint="Sessions that searched but never booked."
        />
        <MetricCard
          label="Conversion"
          value={metrics.conversionRate}
          suffix="%"
          hint="Booked sessions ÷ sessions that searched."
        />
      </MetricGrid>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Live activity</h2>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-emerald-500" />
            Live · {revision} updates
          </span>
        </div>
        {loading ? (
          <div className="h-24 animate-pulse rounded-lg border border-border bg-background" />
        ) : (
          <LiveActivityTable rows={rows} />
        )}
      </section>

      <DemoActivityControls />
    </AdminShell>
  );
}
