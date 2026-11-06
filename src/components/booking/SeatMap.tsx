import { useMemo } from "react";
import { AlertCircle, Armchair } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/flight-search";
import type { FlightSeat, FlightSeatMapResponse, FlightSeatMapSegment } from "@/types/booking";

/**
 * Optional seat map for the reviewed fare.
 *
 * Rendered only when the Review response's conditions.isa is exactly true.
 * A seat is selectable ONLY when the provider literally marked it available
 * AND returned both a seat code and an amount. Selections live in page state
 * only — nothing here holds, books or prices a seat.
 */

export interface SeatSelection {
  segmentId: string;
  seatNo: string;
  code: string;
  amount: number;
  currency?: string;
}

export type SeatSelections = Record<string, SeatSelection>;

function seatKey(segmentId: string, seat: FlightSeat): string {
  return `${segmentId}:${seat.seatNo ?? `${seat.seatPosition.row}-${seat.seatPosition.column}`}`;
}

function isSelectable(seat: FlightSeat): boolean {
  return (
    seat.available === true &&
    typeof seat.code === "string" &&
    seat.code.length > 0 &&
    typeof seat.amount === "number"
  );
}

function seatFlags(seat: FlightSeat): string[] {
  const flags: string[] = [];
  if (seat.aisle === true) flags.push("aisle");
  if (seat.legroom === true) flags.push("extra legroom");
  if (seat.exitRow === true) flags.push("exit row");
  return flags;
}

function SeatButton({
  segment,
  seat,
  selected,
  onToggle,
}: {
  segment: FlightSeatMapSegment;
  seat: FlightSeat;
  selected: boolean;
  onToggle: (segment: FlightSeatMapSegment, seat: FlightSeat) => void;
}) {
  const selectable = isSelectable(seat);
  const flags = seatFlags(seat);
  const label = seat.seatNo ?? "—";
  const amount =
    typeof seat.amount === "number" ? formatMoney(seat.amount, seat.currency ?? "INR") : null;
  const description = [
    `Seat ${label}`,
    selectable ? (amount ? `${amount}` : "available") : "not available",
    flags.length ? `(${flags.join(", ")})` : "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      disabled={!selectable}
      aria-pressed={selected}
      aria-label={description}
      title={description}
      onClick={() => onToggle(segment, seat)}
      style={{ gridRow: seat.seatPosition.row, gridColumn: seat.seatPosition.column }}
      className={
        "flex min-h-11 min-w-11 flex-col items-center justify-center rounded-lg border text-[11px] leading-tight transition-colors " +
        (selected
          ? "border-gold bg-gold/20 text-foreground"
          : selectable
            ? "border-foreground/20 bg-card text-foreground hover:border-gold/60"
            : "cursor-not-allowed border-foreground/10 bg-foreground/5 text-muted-foreground/50")
      }
    >
      <span className="font-medium">{label}</span>
      {selectable && amount && <span className="text-[9px] text-muted-foreground">{amount}</span>}
      {flags.length > 0 && (
        <span className="sr-only">{flags.join(", ")}</span>
      )}
    </button>
  );
}

function SegmentMap({
  segment,
  selections,
  onToggle,
}: {
  segment: FlightSeatMapSegment;
  selections: SeatSelections;
  onToggle: (segment: FlightSeatMapSegment, seat: FlightSeat) => void;
}) {
  const occupied = segment.seats.length - segment.seats.filter((s) => s.available === true).length;
  return (
    <div className="rounded-2xl border border-foreground/10 bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Segment {segment.segmentId}
        </h3>
        <p className="text-xs text-muted-foreground">
          {segment.seats.length} seats · {occupied} occupied
        </p>
      </div>
      {segment.nt && <p className="mt-2 text-xs text-muted-foreground">{segment.nt}</p>}
      <div
        role="group"
        aria-label={`Seat map for segment ${segment.segmentId}`}
        className="mt-4 grid w-fit max-w-full gap-1.5 overflow-x-auto"
        style={{
          gridTemplateRows: `repeat(${segment.rows}, minmax(0, auto))`,
          gridTemplateColumns: `repeat(${segment.columns}, minmax(2.75rem, auto))`,
        }}
      >
        {segment.seats.map((seat) => (
          <SeatButton
            key={seatKey(segment.segmentId, seat)}
            segment={segment}
            seat={seat}
            selected={Boolean(selections[seatKey(segment.segmentId, seat)])}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

export function SeatMap({
  seatMap,
  isPending,
  isError,
  error,
  selections,
  onSelectionsChange,
}: {
  seatMap?: FlightSeatMapResponse;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  selections: SeatSelections;
  onSelectionsChange: (next: SeatSelections) => void;
}) {
  const selectedList = useMemo(() => Object.values(selections), [selections]);

  const toggle = (segment: FlightSeatMapSegment, seat: FlightSeat) => {
    if (!isSelectable(seat)) return;
    const key = seatKey(segment.segmentId, seat);
    const next = { ...selections };
    if (next[key]) {
      delete next[key];
    } else {
      next[key] = {
        segmentId: segment.segmentId,
        seatNo: seat.seatNo ?? key,
        code: seat.code as string,
        amount: seat.amount as number,
        currency: seat.currency,
      };
    }
    onSelectionsChange(next);
  };

  return (
    <section aria-labelledby="seat-map-heading" className="mt-10">
      <h2 id="seat-map-heading" className="font-display text-2xl">
        Choose your seats <span className="text-base font-normal text-muted-foreground">(optional)</span>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Picking a seat here does not hold or confirm it — the airline confirms seat availability
        again before anything is booked.
      </p>

      {isPending ? (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading seat map">
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : isError ? (
        <Alert className="mt-4" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>Seat map unavailable</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "The seat map couldn't be loaded."} You can
            still continue without choosing seats.
          </AlertDescription>
        </Alert>
      ) : !seatMap || seatMap.available !== true || seatMap.segments.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          A seat map isn't available for this fare. You can still continue without choosing seats.
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-4">
            {seatMap.segments.map((segment) => (
              <SegmentMap
                key={segment.segmentId}
                segment={segment}
                selections={selections}
                onToggle={toggle}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded border border-foreground/20 bg-card" aria-hidden="true" />
              Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded border border-foreground/10 bg-foreground/5" aria-hidden="true" />
              Occupied or unknown
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded border border-gold bg-gold/20" aria-hidden="true" />
              Selected
            </span>
          </div>

          {selectedList.length > 0 && (
            <div className="mt-4 rounded-2xl border border-foreground/10 bg-card p-4" role="status">
              <p className="flex items-center gap-2 text-sm">
                <Armchair className="size-4 text-gold" aria-hidden="true" />
                {selectedList.length} seat{selectedList.length > 1 ? "s" : ""} selected:{" "}
                {selectedList.map((s) => s.seatNo).join(", ")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Seat choices are a preference only and are not held or confirmed yet.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
