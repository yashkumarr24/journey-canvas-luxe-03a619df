import { formatDuration, formatTime } from "@/lib/flight-search";
import type { FlightItinerary } from "@/types/booking";

/**
 * Read-only itinerary rows shared by checkout and confirmation.
 * Renders only what the server sent — no derived times, no invented airlines.
 */

function dateLabel(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function Leg({ itinerary }: { itinerary: FlightItinerary }) {
  const first = itinerary.segments[0];
  const last = itinerary.segments[itinerary.segments.length - 1];
  const stops =
    typeof itinerary.stops === "number"
      ? itinerary.stops
      : itinerary.segments.length > 0
        ? itinerary.segments.length - 1
        : undefined;
  const airlines = [
    ...new Set(itinerary.segments.map((s) => s.airline?.name ?? s.airline?.code).filter(Boolean)),
  ];

  return (
    <div className="border-b border-foreground/10 py-5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="min-w-36">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {itinerary.direction === "inbound" ? "Return" : "Outbound"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{dateLabel(first?.departureAt)}</p>
        </div>

        <div className="flex items-center gap-4">
          <div>
            <p className="font-display text-2xl leading-none">{formatTime(first?.departureAt)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{first?.origin?.code ?? "—"}</p>
          </div>
          <div className="flex min-w-24 flex-col items-center">
            <span className="text-xs text-muted-foreground">{formatDuration(itinerary.durationMinutes)}</span>
            <span className="my-1 block h-px w-full bg-foreground/15" />
            <span className="text-xs text-muted-foreground">
              {stops === 0 ? "Non-stop" : stops === undefined ? "Stops on request" : `${stops} stop${stops > 1 ? "s" : ""}`}
            </span>
          </div>
          <div>
            <p className="font-display text-2xl leading-none">{formatTime(last?.arrivalAt)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{last?.destination?.code ?? "—"}</p>
          </div>
        </div>

        <p className="w-full min-w-0 truncate text-sm text-muted-foreground sm:w-auto sm:flex-1">
          {airlines.join(", ") || "Airline not available"}
          {first?.flightNumber ? ` · ${first.flightNumber}` : ""}
        </p>
      </div>
    </div>
  );
}

export function ItinerarySummary({ itineraries }: { itineraries: FlightItinerary[] }) {
  if (itineraries.length === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Flight details aren't available for this booking yet.
      </p>
    );
  }
  return (
    <div>
      {itineraries.map((itinerary, index) => (
        <Leg key={`${itinerary.direction}-${index}`} itinerary={itinerary} />
      ))}
    </div>
  );
}
