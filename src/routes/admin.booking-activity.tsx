import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin/AdminShell";
import { AnalyticsFilters } from "@/components/admin/AnalyticsFilters";
import { useAdminAuth } from "@/lib/admin/admin-context";
import { useAdminSnapshot } from "@/lib/admin/admin-api";
import {
  defaultFilters,
  filterEvents,
  type AnalyticsFilters as Filters,
} from "@/lib/analytics/admin-analytics";
import { ANALYTICS_EVENTS, eventLabel, eventVertical } from "@/lib/analytics/events";
import { cn } from "@/lib/utils";

const BOOKING_EVENTS = new Set<string>([
  ANALYTICS_EVENTS.flightBookingCompleted,
  ANALYTICS_EVENTS.flightBookingFailed,
  ANALYTICS_EVENTS.hotelBookingCompleted,
  ANALYTICS_EVENTS.hotelBookingFailed,
]);

/**
 * Booking activity.
 *
 * Level 1 (Staff) sees the basic list. Payment-level detail is Level 2+.
 * Customer names, contact details and amounts are deliberately not tracked in
 * analytics — the full booking record arrives from the booking API once the
 * live backend is connected.
 */
export const Route = createFileRoute("/admin/booking-activity")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Bookings — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Flight and hotel booking activity for Fly n Feel staff." },
      { property: "og:title", content: "Bookings — Fly n Feel Admin" },
      {
        property: "og:description",
        content: "Flight and hotel booking activity for Fly n Feel staff.",
      },
    ],
  }),
  component: AdminBookingsPage,
});

function AdminBookingsPage() {
  const { can } = useAdminAuth();
  const { snapshot, revision } = useAdminSnapshot();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(30));

  const rows = useMemo(() => {
    const scoped = filterEvents(snapshot, { ...filters, eventType: "all" });
    return scoped
      .filter((event) => BOOKING_EVENTS.has(event.name))
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
      .slice(0, 200);
  }, [snapshot, filters, revision]);

  return (
    <AdminShell
      title="Bookings"
      description="Booking attempts recorded across flights and hotels, newest first."
      permission="bookings.view"
    >
      <AnalyticsFilters value={filters} onChange={setFilters} showEventType={false} />

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Reference</th>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="px-4 py-3 font-medium">Visitor</th>
              <th className="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                  No booking activity in this range.
                </td>
              </tr>
            ) : (
              rows.map((event, index) => {
                const reference =
                  typeof event.props?.reference === "string" ? event.props.reference : "—";
                const completed = event.name.endsWith("booking_completed");
                return (
                  <tr
                    key={`${event.id}-${index}`}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{reference}</td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">
                      {eventVertical(event.name)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-xs font-medium",
                        completed ? "text-emerald-600" : "text-destructive",
                      )}
                    >
                      {eventLabel(event.name)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {event.userId ? "Signed in" : "Guest"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {new Date(event.occurredAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        {can("payments.view")
          ? "Payment status, amounts, refunds and booking management open up here once the live booking service is connected — they are read from the booking records, never from the visitor's browser."
          : "Payment details and booking changes are available to Manager and Owner levels."}
      </p>
    </AdminShell>
  );
}
