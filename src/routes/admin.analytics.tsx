import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AdminShell } from "@/components/admin/AdminShell";
import { AnalyticsFilters } from "@/components/admin/AnalyticsFilters";
import { MetricCard, MetricGrid } from "@/components/admin/MetricCard";
import { useAdminSnapshot } from "@/lib/admin/admin-api";
import {
  dailySeries,
  defaultFilters,
  overview,
  type AnalyticsFilters as Filters,
} from "@/lib/analytics/admin-analytics";

/** Charted analytics: searches over time, product split, sessions and bookings. */
export const Route = createFileRoute("/admin/analytics")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Analytics — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Search, session and booking trends for Fly n Feel." },
      { property: "og:title", content: "Analytics — Fly n Feel Admin" },
      { property: "og:description", content: "Search, session and booking trends for Fly n Feel." },
    ],
  }),
  component: AdminAnalyticsPage,
});

const CHART_HEIGHT = 260;

function ChartCard({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{note}</p>
      <div style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as never}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function AdminAnalyticsPage() {
  const { snapshot, revision } = useAdminSnapshot();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(14));

  const series = useMemo(() => dailySeries(snapshot, filters), [snapshot, filters, revision]);
  const metrics = useMemo(() => overview(snapshot, filters), [snapshot, filters, revision]);

  const split = [
    { name: "Flight searches", value: metrics.flightSearches, fill: "hsl(var(--primary))" },
    { name: "Hotel searches", value: metrics.hotelSearches, fill: "hsl(var(--muted-foreground))" },
  ];
  const outcome = [
    { name: "Completed", value: metrics.bookingsCompleted },
    { name: "Failed", value: metrics.bookingsFailed },
  ];
  const axis = { fontSize: 11, stroke: "currentColor", opacity: 0.6 } as const;

  return (
    <AdminShell
      title="Analytics"
      description="Trends over the selected range. Numbers are labelled so counts of events, sessions and users are never mixed up."
      permission="analytics.view"
    >
      <AnalyticsFilters value={filters} onChange={setFilters} />

      <MetricGrid>
        <MetricCard
          label="Events recorded"
          value={metrics.totalEvents}
          hint="Every tracked action in range."
        />
        <MetricCard
          label="Sessions"
          value={metrics.totalSessions}
          hint="Distinct visits in range."
        />
        <MetricCard
          label="Conversion"
          value={metrics.conversionRate}
          suffix="%"
          hint="Sessions that booked ÷ sessions that searched."
        />
        <MetricCard
          label="Abandonment"
          value={metrics.abandonmentRate}
          suffix="%"
          hint="Searched but never booked."
        />
      </MetricGrid>

      <div className="mt-5 grid gap-5 2xl:grid-cols-2">
        <ChartCard title="Searches over time" note="Daily count of flight and hotel search events.">
          <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="day" tick={axis} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis tick={axis} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="flightSearches"
              name="Flights"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="hotelSearches"
              name="Hotels"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartCard>

        <ChartCard title="Sessions and bookings" note="Distinct visits per day and bookings confirmed.">
          <BarChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="day" tick={axis} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis tick={axis} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="sessions" name="Sessions" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            <Bar
              dataKey="bookings"
              name="Bookings"
              fill="hsl(var(--muted-foreground))"
              radius={[3, 3, 0, 0]}
            />
          </BarChart>
        </ChartCard>

        <ChartCard title="Flights vs hotels" note="Share of search events by product in range.">
          <PieChart>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Pie data={split} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>
              {split.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartCard>

        <ChartCard
          title="Completed vs failed bookings"
          note="Booking attempts by final result in range."
        >
          <BarChart data={outcome} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="name" tick={axis} />
            <YAxis tick={axis} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="value" name="Bookings" radius={[3, 3, 0, 0]}>
              <Cell fill="hsl(var(--primary))" />
              <Cell fill="hsl(var(--destructive))" />
            </Bar>
          </BarChart>
        </ChartCard>
      </div>
    </AdminShell>
  );
}
