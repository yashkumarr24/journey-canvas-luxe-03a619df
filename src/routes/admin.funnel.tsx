import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin/AdminShell";
import { AnalyticsFilters } from "@/components/admin/AnalyticsFilters";
import { useAdminSnapshot } from "@/lib/admin/admin-api";
import {
  defaultFilters,
  funnel,
  type AnalyticsFilters as Filters,
  type FunnelRow,
} from "@/lib/analytics/admin-analytics";

/** Separate flight and hotel funnels, so drop-off is visible per step. */
export const Route = createFileRoute("/admin/funnel")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Booking funnel — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Where visitors leave the flight and hotel booking journeys." },
      { property: "og:title", content: "Booking funnel — Fly n Feel Admin" },
      {
        property: "og:description",
        content: "Where visitors leave the flight and hotel booking journeys.",
      },
    ],
  }),
  component: AdminFunnelPage,
});

function FunnelTable({ title, rows }: { title: string; rows: FunnelRow[] }) {
  return (
    <section className="rounded-lg border border-border bg-background">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
        {title}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Step</th>
              <th className="px-4 py-3 font-medium">Sessions</th>
              <th className="px-4 py-3 font-medium">Users</th>
              <th className="px-4 py-3 font-medium">Events</th>
              <th className="px-4 py-3 font-medium">Reached</th>
              <th className="px-4 py-3 font-medium">Left here</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{row.label}</p>
                  <div
                    aria-hidden
                    className="mt-1.5 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.min(100, row.reachedPct)}%` }}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground">{row.uniqueSessions}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{row.uniqueUsers}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{row.eventCount}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{row.reachedPct}%</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {row.droppedSessions}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        “Sessions” counts distinct visits that reached the step; “Users” counts signed-in accounts
        only; “Events” counts every occurrence, so it can exceed sessions. “Reached” is measured
        against the first step.
      </p>
    </section>
  );
}

function AdminFunnelPage() {
  const { snapshot, revision } = useAdminSnapshot();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(7));

  const flightRows = useMemo(
    () => funnel(snapshot, "flight", filters),
    [snapshot, filters, revision],
  );
  const hotelRows = useMemo(() => funnel(snapshot, "hotel", filters), [snapshot, filters, revision]);

  return (
    <AdminShell
      title="Booking funnel"
      description="Flight and hotel journeys are measured separately. Each row shows how many visits reached that step."
      permission="analytics.view"
    >
      <AnalyticsFilters value={filters} onChange={setFilters} showEventType={false} />
      <div className="grid gap-5 2xl:grid-cols-2">
        <FunnelTable title="Flights" rows={flightRows} />
        <FunnelTable title="Hotels" rows={hotelRows} />
      </div>
    </AdminShell>
  );
}
