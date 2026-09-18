import { AlertCircle, ArrowRight, CheckCircle2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cabinClassOptions } from "@/lib/flight-search";
import { formatRequirementDate, timeWindowLabel } from "@/lib/assistant/requirements";
import type { MissingRequirement, TravelRequirements } from "@/types/assistant";

export interface TravelSummaryCardProps {
  requirements: TravelRequirements;
  missing: MissingRequirement[];
  /** Schema/date problems, shown verbatim. */
  issues: string[];
  canSearch: boolean;
  searching: boolean;
  onSearch: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-foreground/5 py-2 last:border-0">
      <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

export function TravelSummaryCard({
  requirements,
  missing,
  issues,
  canSearch,
  searching,
  onSearch,
}: TravelSummaryCardProps) {
  const cabin = cabinClassOptions.find((option) => option.value === (requirements.cabinClass ?? "economy"));
  const route =
    requirements.origin || requirements.destination
      ? `${requirements.originLabel ?? requirements.origin ?? "—"} → ${
          requirements.destinationLabel ?? requirements.destination ?? "—"
        }`
      : null;

  const passengers = [
    `${requirements.adults ?? 1} adult${(requirements.adults ?? 1) > 1 ? "s" : ""}`,
    requirements.children ? `${requirements.children} child${requirements.children > 1 ? "ren" : ""}` : null,
    requirements.infants ? `${requirements.infants} infant${requirements.infants > 1 ? "s" : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const preferences = [
    requirements.nonStopOnly ? "Non-stop only" : null,
    timeWindowLabel(requirements.preferredDepartureWindow)
      ? `Depart: ${timeWindowLabel(requirements.preferredDepartureWindow)}`
      : null,
    timeWindowLabel(requirements.preferredArrivalWindow)
      ? `Arrive: ${timeWindowLabel(requirements.preferredArrivalWindow)}`
      : null,
    requirements.baggagePreference === "checked_baggage"
      ? "Check-in baggage preferred"
      : requirements.baggagePreference === "cabin_only"
        ? "Cabin baggage only"
        : null,
    requirements.preferredAirlines?.length ? `Airline: ${requirements.preferredAirlines.join(", ")}` : null,
    ...(requirements.notes ?? []),
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-3xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">What I understood</p>
          <p className="mt-1 font-display text-xl">Your travel requirements</p>
        </div>
        {missing.length === 0 && issues.length === 0 && (
          <CheckCircle2 className="size-5 shrink-0 text-[#d62828]" aria-hidden />
        )}
      </div>

      <div className="mt-4">
        {route ? <Row label="Route" value={route} /> : null}
        {requirements.tripType ? (
          <Row label="Trip" value={requirements.tripType === "roundtrip" ? "Round trip" : "One way"} />
        ) : null}
        {formatRequirementDate(requirements.departureDate) ? (
          <Row label="Departure" value={formatRequirementDate(requirements.departureDate)!} />
        ) : null}
        {formatRequirementDate(requirements.returnDate) ? (
          <Row label="Return" value={formatRequirementDate(requirements.returnDate)!} />
        ) : null}
        <Row label="Travellers" value={passengers} />
        <Row label="Cabin" value={cabin?.label ?? "Economy"} />
      </div>

      {preferences.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {preferences.map((preference) => (
            <span
              key={preference}
              className="rounded-full border border-foreground/15 bg-background px-3 py-1 text-xs text-muted-foreground"
            >
              {preference}
            </span>
          ))}
        </div>
      )}

      {missing.length > 0 && (
        <div className="mt-4 rounded-2xl border border-foreground/10 bg-background p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertCircle className="size-4 text-[#d62828]" /> Still needed
          </p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {missing.map((item) => (
              <li key={item.field}>• {item.prompt}</li>
            ))}
          </ul>
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">Please adjust these details</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {issues.map((issue) => (
              <li key={issue}>• {issue}</li>
            ))}
          </ul>
        </div>
      )}

      <Button onClick={onSearch} disabled={!canSearch || searching} className="mt-5 w-full gap-2">
        <Search className="size-4" />
        {searching ? "Searching flights…" : "Search flights"}
        {!searching && <ArrowRight className="size-4" />}
      </Button>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Fares, timings and availability come from the live flight search — never from the assistant.
      </p>
    </div>
  );
}
