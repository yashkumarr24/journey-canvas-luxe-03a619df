import { formatMoney } from "@/lib/flight-search";
import type { FareBreakdownLine, Money, PassengerCounts } from "@/types/booking";

/**
 * Fare breakdown and total payable.
 * Every figure comes from the server response; nothing is summed client-side.
 */

function travellersLabel(passengers: PassengerCounts): string {
  const parts: string[] = [];
  if (passengers.adults) parts.push(`${passengers.adults} adult${passengers.adults > 1 ? "s" : ""}`);
  if (passengers.children) parts.push(`${passengers.children} child${passengers.children > 1 ? "ren" : ""}`);
  if (passengers.infants) parts.push(`${passengers.infants} infant${passengers.infants > 1 ? "s" : ""}`);
  return parts.join(", ") || "—";
}

export interface FareBreakdownProps {
  breakdown: FareBreakdownLine[];
  totalPayable: Money;
  /** Flight bookings pass passenger counts. */
  passengers?: PassengerCounts;
  /** Hotel bookings pass a room/guest line instead. */
  occupancy?: { label: string; value: string };
  /** Heading above the lines. */
  title?: string;
  /** Rendered under the total, e.g. how long the price is held. */
  footnote?: string;
}

export function FareBreakdown({
  breakdown,
  totalPayable,
  passengers,
  occupancy,
  title = "Fare breakdown",
  footnote,
}: FareBreakdownProps) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</p>

      <dl className="mt-4 space-y-3 text-sm">
        {breakdown.map((line) => (
          <div key={`${line.label}-${line.amount.amount}`} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">
              {line.label}
              {line.note && <span className="block text-xs opacity-80">{line.note}</span>}
            </dt>
            <dd className={line.kind === "discount" ? "text-gold" : undefined}>
              {line.kind === "discount" ? "−" : ""}
              {formatMoney(Math.abs(line.amount.amount), line.amount.currency)}
            </dd>
          </div>
        ))}
        {passengers && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Travellers</dt>
            <dd>{travellersLabel(passengers)}</dd>
          </div>
        )}
        {occupancy && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{occupancy.label}</dt>
            <dd className="text-right">{occupancy.value}</dd>
          </div>
        )}
      </dl>

      <div className="mt-5 flex items-end justify-between gap-4 border-t border-foreground/10 pt-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Total payable</p>
          {footnote && <p className="mt-1 text-xs text-muted-foreground">{footnote}</p>}
        </div>
        <p className="font-display text-3xl leading-none sm:text-4xl">
          {formatMoney(totalPayable.amount, totalPayable.currency)}
        </p>
      </div>
    </div>
  );
}
