import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin/AdminShell";
import { AnalyticsFilters } from "@/components/admin/AnalyticsFilters";
import { useAdminSnapshot } from "@/lib/admin/admin-api";
import {
  defaultFilters,
  sessionJourney,
  sessionRows,
  type AnalyticsFilters as Filters,
} from "@/lib/analytics/admin-analytics";
import { eventLabel, pageLabel } from "@/lib/analytics/events";
import { cn } from "@/lib/utils";

const OUTCOME_LABEL: Record<string, string> = {
  booked: "Booked",
  payment_failed: "Payment / booking failed",
  abandoned: "Abandoned after search",
  browsing: "Browsing only",
};

/** Session list + the full step-by-step journey for one selected session. */
export const Route = createFileRoute("/admin/sessions")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    session: typeof search.session === "string" ? search.session : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sessions — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Visitor sessions and their journey through the platform." },
      { property: "og:title", content: "Sessions — Fly n Feel Admin" },
      {
        property: "og:description",
        content: "Visitor sessions and their journey through the platform.",
      },
    ],
  }),
  component: AdminSessionsPage,
});

function AdminSessionsPage() {
  const { session: selected } = Route.useSearch();
  const navigate = useNavigate();
  const { snapshot, revision } = useAdminSnapshot();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(7));

  const rows = useMemo(() => sessionRows(snapshot, filters), [snapshot, filters, revision]);
  const journey = useMemo(
    () => (selected ? sessionJourney(snapshot, selected) : null),
    [snapshot, selected, revision],
  );

  const select = (sessionId: string | undefined) =>
    void navigate({ to: "/admin/sessions", search: { session: sessionId }, replace: true });

  return (
    <AdminShell
      title="Sessions"
      description="Each row is one visit. Open a session to see the exact path it took through the site."
      permission="activity.view"
    >
      <AnalyticsFilters value={filters} onChange={setFilters} showEventType={false} />

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Visitor</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Steps</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-muted-foreground">
                    No sessions in this range yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.sessionId}
                    onClick={() => select(row.sessionId)}
                    className={cn(
                      "cursor-pointer border-b border-border/60 last:border-0 hover:bg-accent/50",
                      selected === row.sessionId && "bg-primary/5",
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground">{row.identity}</span>
                      <span className="ml-2 text-xs text-muted-foreground capitalize">
                        {row.device}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {new Date(row.startedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {row.eventCount}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          row.outcome === "booked" && "text-emerald-600",
                          row.outcome === "payment_failed" && "text-destructive",
                          (row.outcome === "abandoned" || row.outcome === "browsing") &&
                            "text-muted-foreground",
                        )}
                      >
                        {OUTCOME_LABEL[row.outcome]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <aside className="rounded-lg border border-border bg-background p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Session journey</h2>
            {selected ? (
              <button
                type="button"
                onClick={() => select(undefined)}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>

          {!journey || !selected ? (
            <p className="text-sm text-muted-foreground">
              Select a session on the left to see every step it took, in order.
            </p>
          ) : journey.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No steps recorded for this session.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-border pl-4">
              {journey.steps.map((step, index) => (
                <li key={`${step.name}-${step.occurredAt}-${index}`} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/50"
                  />
                  <p className="text-sm font-medium text-foreground">{eventLabel(step.name)}</p>
                  <p className="text-xs text-muted-foreground">
                    {pageLabel(step.page)} · {new Date(step.occurredAt).toLocaleTimeString()}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </AdminShell>
  );
}
