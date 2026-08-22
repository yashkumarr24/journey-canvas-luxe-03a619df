import { ArrowRight } from "lucide-react";
import type { FlightItinerary, FlightResult } from "@/types/booking";
import { formatDuration, formatMoney, formatTime, totalStops } from "@/lib/flight-search";

function stopsLabel(stops?: number): string {
  if (stops === undefined) return "Stops not available";
  if (stops === 0) return "Non-stop";
  return `${stops} stop${stops > 1 ? "s" : ""}`;
}

function Leg({ itinerary }: { itinerary: FlightItinerary }) {
  const segments = itinerary.segments;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const stops =
    typeof itinerary.stops === "number"
      ? itinerary.stops
      : segments.length > 0
        ? segments.length - 1
        : undefined;

  const airlines = [...new Set(segments.map((s) => s.airline?.name ?? s.airline?.code).filter(Boolean))];

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {itinerary.direction === "inbound" ? "Return" : "Outbound"}
        </p>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {airlines.join(", ") || "Airline not available"}
          {first?.flightNumber ? ` · ${first.flightNumber}` : ""}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <p className="font-display text-2xl leading-none">{formatTime(first?.departureAt)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{first?.origin?.code ?? "—"}</p>
        </div>
        <div className="flex min-w-24 flex-col items-center">
          <span className="text-xs text-muted-foreground">
            {formatDuration(itinerary.durationMinutes)}
          </span>
          <span className="my-1 block h-px w-full bg-foreground/15" />
          <span className="text-xs text-muted-foreground">{stopsLabel(stops)}</span>
        </div>
        <div>
          <p className="font-display text-2xl leading-none">{formatTime(last?.arrivalAt)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{last?.destination?.code ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}

export interface FlightResultCardProps {
  result: FlightResult;
  /** Starts server-side re-pricing for this fare. */
  onSelect?: (result: FlightResult) => void;
  /** True while this specific fare is being revalidated. */
  selecting?: boolean;
  /** True while any fare on the page is being revalidated. */
  disabled?: boolean;
}

export function FlightResultCard({ result, onSelect, selecting, disabled }: FlightResultCardProps) {
  const price = result.fare?.totalPrice;
  const stops = totalStops(result);

  return (
    <article className="rounded-3xl border border-foreground/10 bg-card p-5 shadow-[var(--shadow-soft)] transition-colors hover:border-gold/40 sm:p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1 space-y-5">
          {result.itineraries.map((itinerary, index) => (
            <Leg key={`${itinerary.direction}-${index}`} itinerary={itinerary} />
          ))}
        </div>

        <div className="flex items-end justify-between gap-4 border-t border-foreground/10 pt-4 lg:w-56 lg:flex-col lg:items-end lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div className="text-right">
            <p className="font-display text-3xl leading-none">
              {formatMoney(price?.amount, price?.currency ?? "INR")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {result.fare?.refundable === true
                ? "Refundable"
                : result.fare?.refundable === false
                  ? "Non-refundable"
                  : "Fare conditions on request"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelect?.(result)}
            disabled={disabled || selecting || !onSelect}
            className="inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-sm text-primary-foreground transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={`Select flight for ${formatMoney(price?.amount, price?.currency ?? "INR")}, ${stopsLabel(stops)}`}
          >
            {selecting ? "Checking…" : "Select"} <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {result.fare?.conditions && result.fare.conditions.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {result.fare.conditions.map((condition) => (
            <li
              key={condition}
              className="rounded-full border border-foreground/10 px-3 py-1 text-xs text-muted-foreground"
            >
              {condition}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
