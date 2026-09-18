/**
 * Booking timeline.
 *
 * Only events that actually exist on the booking record are rendered — the
 * component never fills in a step that did not happen.
 */

import type { BookingTimelineEvent } from "@/types/operations";

const NEGATIVE = new Set(["payment_failed", "provider_booking_failed", "refund_required"]);
const POSITIVE = new Set(["payment_confirmed", "booking_confirmed", "document_generated"]);

function dot(type: string): string {
  if (NEGATIVE.has(type)) return "bg-red-600";
  if (POSITIVE.has(type)) return "bg-emerald-600";
  return "bg-foreground/30";
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BookingTimeline({ events }: { events: BookingTimelineEvent[] }) {
  if (!events.length) {
    return <p className="text-sm text-muted-foreground">No events recorded for this booking yet.</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-foreground/12 pl-5">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden
            className={`absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full ring-2 ring-background ${dot(event.type)}`}
          />
          <p className="text-sm font-medium text-foreground">{event.label}</p>
          <p className="text-xs text-muted-foreground">
            {when(event.at)} · {event.actor}
          </p>
          {event.detail ? <p className="mt-1 text-xs text-muted-foreground">{event.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}
