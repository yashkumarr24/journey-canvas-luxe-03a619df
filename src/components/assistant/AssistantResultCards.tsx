import { ArrowRight, Building2, Clock3, MapPin, Plane, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration, formatMoney, formatTime, totalDurationMinutes, totalStops } from "@/lib/flight-search";
import type { FlightRecommendation } from "@/types/assistant";
import type { FlightResult, HotelResult } from "@/types/booking";

function ResultBadge({ children }: { children: string }) {
  return <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground">{children}</span>;
}

export function AssistantFlightCard({
  result,
  recommendations,
  selecting,
  disabled,
  onSelect,
}: {
  result: FlightResult;
  recommendations: FlightRecommendation[];
  selecting: boolean;
  disabled: boolean;
  onSelect: (result: FlightResult) => void;
}) {
  const outbound = result.itineraries.find((leg) => leg.direction === "outbound") ?? result.itineraries[0];
  const first = outbound?.segments[0];
  const last = outbound?.segments.at(-1);
  const airline = result.validatingAirline?.name ?? first?.airline.name ?? first?.airline.code ?? "Airline";
  const logo = first?.airline.logoUrl;
  const stops = totalStops(result);
  const badges = recommendations.filter((item) => item.resultId === result.id).slice(0, 2);

  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-soft)] sm:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-background">
              {logo ? <img src={logo} alt="" className="size-full object-contain p-1.5" /> : <Plane className="size-5 text-primary" />}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold">{airline}</p>
              <p className="text-xs text-muted-foreground">{first?.flightNumber ?? first?.airline.code ?? "Flight"}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-[auto_minmax(70px,1fr)_auto] items-center gap-3">
            <div><p className="text-lg font-semibold">{formatTime(first?.departureAt)}</p><p className="text-xs text-muted-foreground">{first?.origin.code}</p></div>
            <div className="min-w-0 text-center">
              <p className="text-xs text-muted-foreground">{formatDuration(outbound?.durationMinutes ?? totalDurationMinutes(result))}</p>
              <div className="my-1 h-px bg-border" />
              <p className="text-xs">{stops === 0 ? "Non-stop" : typeof stops === "number" ? `${stops} stop${stops > 1 ? "s" : ""}` : "Stops unavailable"}</p>
            </div>
            <div className="text-right"><p className="text-lg font-semibold">{formatTime(last?.arrivalAt)}</p><p className="text-xs text-muted-foreground">{last?.destination.code}</p></div>
          </div>
        </div>
        <div className="flex min-w-28 flex-col items-end justify-between gap-3 border-l border-border pl-4">
          <div className="flex flex-wrap justify-end gap-1.5">{badges.map((badge) => <ResultBadge key={badge.key}>{badge.label}</ResultBadge>)}</div>
          <div className="text-right"><p className="text-xl font-semibold">{formatMoney(result.fare.totalPrice.amount, result.fare.totalPrice.currency)}</p><p className="text-xs capitalize text-muted-foreground">{first?.cabinClass?.replace("_", " ") ?? "Cabin from result"}</p></div>
          <Button size="sm" disabled={disabled} onClick={() => onSelect(result)}>{selecting ? "Checking…" : "Select"}<ArrowRight /></Button>
        </div>
      </div>
    </article>
  );
}

export function AssistantHotelCard({ hotel, nights, onSelect }: { hotel: HotelResult; nights: number; onSelect: (hotel: HotelResult) => void }) {
  const location = hotel.location?.area ?? hotel.location?.landmark ?? hotel.location?.city;
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-soft)]">
      <div className="grid min-h-44 grid-cols-[116px_minmax(0,1fr)] sm:grid-cols-[160px_minmax(0,1fr)_auto]">
        <div className="bg-muted">
          {hotel.thumbnailUrl ? <img src={hotel.thumbnailUrl} alt={hotel.name} className="size-full object-cover" /> : <div className="grid size-full place-items-center"><Building2 className="size-7 text-muted-foreground" /></div>}
        </div>
        <div className="min-w-0 p-4">
          <div className="flex items-start justify-between gap-2"><h3 className="font-display text-xl leading-tight">{hotel.name}</h3>{hotel.starRating ? <span className="flex shrink-0 items-center gap-1 text-xs"><Star className="size-3 fill-primary text-primary" />{hotel.starRating}</span> : null}</div>
          {location ? <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5" />{location}</p> : null}
          {hotel.rate?.roomName ? <p className="mt-4 text-sm">{hotel.rate.roomName}</p> : null}
          <div className="mt-3 flex flex-wrap gap-1.5">{hotel.amenities?.slice(0, 3).map((item) => <span key={item} className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">{item}</span>)}</div>
          {hotel.rate?.refundable !== undefined ? <p className="mt-3 text-xs text-muted-foreground">{hotel.rate.refundable ? "Refundable rate" : "Non-refundable rate"}</p> : null}
        </div>
        <div className="col-span-2 flex items-end justify-between gap-3 border-t border-border p-4 sm:col-span-1 sm:flex-col sm:items-end sm:border-l sm:border-t-0">
          <div className="text-left sm:text-right">{hotel.rate?.perNightPrice ? <p className="font-semibold">{formatMoney(hotel.rate.perNightPrice.amount, hotel.rate.perNightPrice.currency)} <span className="text-xs font-normal text-muted-foreground">/ night</span></p> : null}{hotel.rate?.totalPrice ? <p className="mt-1 text-xs text-muted-foreground">{formatMoney(hotel.rate.totalPrice.amount, hotel.rate.totalPrice.currency)} total · {nights} nights</p> : null}</div>
          <Button size="sm" onClick={() => onSelect(hotel)}>View rooms<ArrowRight /></Button>
        </div>
      </div>
    </article>
  );
}

export function ResultLoading({ children }: { children: string }) {
  return <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground"><Clock3 className="size-4 animate-pulse text-primary" />{children}</div>;
}