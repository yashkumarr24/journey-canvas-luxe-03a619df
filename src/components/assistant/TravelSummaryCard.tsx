import { AlertCircle, BedDouble, CalendarDays, CheckCircle2, Pencil, Plane, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cabinClassOptions } from "@/lib/flight-search";
import { formatRequirementDate, timeWindowLabel, wantsHotels } from "@/lib/assistant/requirements";
import type { MissingRequirement, TravelRequirements } from "@/types/assistant";

export interface TravelSummaryCardProps {
  requirements: TravelRequirements;
  missing: MissingRequirement[];
  issues: string[];
  canSearch: boolean;
  searching: boolean;
  onSearch: () => void;
  onChange: () => void;
}

export function TravelSummaryCard({ requirements, missing, issues, canSearch, searching, onSearch, onChange }: TravelSummaryCardProps) {
  const cabin = cabinClassOptions.find((item) => item.value === (requirements.cabinClass ?? "economy"))?.label ?? "Economy";
  const travellers = (requirements.adults ?? 1) + (requirements.children ?? 0) + (requirements.infants ?? 0);
  const stay = wantsHotels(requirements);
  const detailRows = [
    { icon: CalendarDays, value: [formatRequirementDate(requirements.departureDate), formatRequirementDate(requirements.returnDate)].filter(Boolean).join(" — ") },
    { icon: Users, value: `${travellers} traveller${travellers === 1 ? "" : "s"} · ${cabin}` },
    stay ? { icon: BedDouble, value: `${requirements.durationNights ?? 0} night${requirements.durationNights === 1 ? "" : "s"} in ${requirements.hotelDestination ?? requirements.destinationLabel ?? "destination"}` } : null,
    timeWindowLabel(requirements.preferredDepartureWindow) ? { icon: Plane, value: `Outbound: ${timeWindowLabel(requirements.preferredDepartureWindow)}` } : null,
    timeWindowLabel(requirements.preferredReturnWindow) ? { icon: Plane, value: `Return: ${timeWindowLabel(requirements.preferredReturnWindow)}` } : null,
  ].filter((row): row is { icon: typeof CalendarDays; value: string } => Boolean(row?.value));

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-soft)] sm:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{canSearch ? <CheckCircle2 className="size-4 text-primary" /> : <AlertCircle className="size-4 text-primary" />}Trip understood</p><h2 className="mt-2 truncate font-display text-2xl">{requirements.origin ?? "From"} <span className="text-primary">→</span> {requirements.destination ?? "To"}</h2></div>
        <Button variant="ghost" size="sm" onClick={onChange}><Pencil />Change</Button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{detailRows.map(({ icon: Icon, value }) => <div key={value} className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4 shrink-0 text-foreground" /><span className="truncate">{value}</span></div>)}</div>
      {missing.length > 0 || issues.length > 0 ? <div className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">{missing[0]?.prompt ?? issues[0]}</div> : null}
      <Button onClick={onSearch} disabled={!canSearch || searching} className="mt-4 w-full"><Search />{searching ? "Searching your trip…" : stay ? "Search flights & hotels" : "Search flights"}</Button>
    </section>
  );
}