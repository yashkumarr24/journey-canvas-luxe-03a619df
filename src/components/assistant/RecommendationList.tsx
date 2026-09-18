import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration, formatMoney, totalDurationMinutes, totalStops } from "@/lib/flight-search";
import type { FlightRecommendation } from "@/types/assistant";
import type { FlightResult } from "@/types/booking";

export interface RecommendationListProps {
  recommendations: FlightRecommendation[];
  results: FlightResult[];
  selectingId: string | null;
  disabled: boolean;
  onSelect: (result: FlightResult) => void;
}

/**
 * Explains the ACTUAL search results. Every number rendered here comes from the
 * flight-search response; nothing is generated.
 */
export function RecommendationList({
  recommendations,
  results,
  selectingId,
  disabled,
  onSelect,
}: RecommendationListProps) {
  if (recommendations.length === 0) return null;

  return (
    <div className="rounded-3xl border border-foreground/10 bg-background p-5 shadow-[var(--shadow-soft)] sm:p-6">
      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
        <Lightbulb className="size-4 text-[#d62828]" /> Assistant picks from these results
      </p>

      <div className="mt-4 space-y-3">
        {recommendations.map((recommendation) => {
          const result = results.find((item) => item.id === recommendation.resultId);
          if (!result) return null;
          const stops = totalStops(result);
          const duration = totalDurationMinutes(result);
          return (
            <div
              key={`${recommendation.key}-${recommendation.resultId}`}
              className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{recommendation.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{recommendation.reason}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatMoney(result.fare?.totalPrice?.amount, result.fare?.totalPrice?.currency)}
                    {duration !== undefined ? ` · ${formatDuration(duration)}` : ""}
                    {stops !== undefined ? ` · ${stops === 0 ? "Non-stop" : `${stops} stop${stops > 1 ? "s" : ""}`}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => onSelect(result)}
                  disabled={disabled}
                  className="shrink-0"
                >
                  {selectingId === result.id ? "Checking…" : "Book this flight"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
