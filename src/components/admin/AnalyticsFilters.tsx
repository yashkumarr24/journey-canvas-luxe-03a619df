/**
 * Shared analytics filter bar: date range, vertical, audience, event type and
 * booking status. Filtering happens on the data the dashboard already holds, so
 * changing a filter never triggers a full reload.
 */

import { ANALYTICS_EVENTS, eventLabel } from "@/lib/analytics/events";
import type { AnalyticsFilters as Filters } from "@/lib/analytics/admin-analytics";

const EVENT_OPTIONS = Object.values(ANALYTICS_EVENTS);

export function AnalyticsFilters({
  value,
  onChange,
  showEventType = true,
  showBookingStatus = true,
}: {
  value: Filters;
  onChange: (next: Filters) => void;
  showEventType?: boolean;
  showBookingStatus?: boolean;
}) {
  const patch = (next: Partial<Filters>) => onChange({ ...value, ...next });
  const field =
    "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground";

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 rounded-lg border border-border bg-background p-4 lg:grid-cols-6">
      <label className="text-xs text-muted-foreground">
        From
        <input
          type="date"
          className={field}
          value={value.from}
          max={value.to}
          onChange={(event) => patch({ from: event.target.value })}
        />
      </label>
      <label className="text-xs text-muted-foreground">
        To
        <input
          type="date"
          className={field}
          value={value.to}
          min={value.from}
          onChange={(event) => patch({ to: event.target.value })}
        />
      </label>
      <label className="text-xs text-muted-foreground">
        Product
        <select
          className={field}
          value={value.vertical}
          onChange={(event) => patch({ vertical: event.target.value as Filters["vertical"] })}
        >
          <option value="all">Flights + hotels</option>
          <option value="flight">Flights</option>
          <option value="hotel">Hotels</option>
        </select>
      </label>
      <label className="text-xs text-muted-foreground">
        Visitor
        <select
          className={field}
          value={value.audience}
          onChange={(event) => patch({ audience: event.target.value as Filters["audience"] })}
        >
          <option value="all">Guests + signed in</option>
          <option value="guest">Guests only</option>
          <option value="authenticated">Signed in only</option>
        </select>
      </label>
      {showEventType ? (
        <label className="text-xs text-muted-foreground">
          Event
          <select
            className={field}
            value={value.eventType}
            onChange={(event) => patch({ eventType: event.target.value })}
          >
            <option value="all">All events</option>
            {EVENT_OPTIONS.map((name) => (
              <option key={name} value={name}>
                {eventLabel(name)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {showBookingStatus ? (
        <label className="text-xs text-muted-foreground">
          Booking status
          <select
            className={field}
            value={value.bookingStatus}
            onChange={(event) =>
              patch({ bookingStatus: event.target.value as Filters["bookingStatus"] })
            }
          >
            <option value="all">Any</option>
            <option value="completed">Completed only</option>
            <option value="failed">Failed only</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}
