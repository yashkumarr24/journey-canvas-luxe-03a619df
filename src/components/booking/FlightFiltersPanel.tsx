import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import type { FlightFilters } from "@/types/booking";
import { formatMoney } from "@/lib/flight-search";

export interface FlightFiltersPanelProps {
  filters: FlightFilters;
  onChange: (filters: FlightFilters) => void;
  airlines: { code: string; name?: string }[];
  priceBounds: [number, number] | null;
  currency: string;
}

const stopBuckets = [
  { value: 0, label: "Non-stop" },
  { value: 1, label: "1 stop" },
  { value: 2, label: "2+ stops" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function FlightFiltersPanel({
  filters,
  onChange,
  airlines,
  priceBounds,
  currency,
}: FlightFiltersPanelProps) {
  const hasActive =
    filters.airlines.length > 0 ||
    filters.stops.length > 0 ||
    filters.maxPrice !== undefined ||
    filters.maxDurationMinutes !== undefined;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Filters</h2>
        {hasActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange({ airlines: [], stops: [] })}
          >
            Clear all
          </Button>
        )}
      </div>

      <fieldset>
        <legend className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Stops</legend>
        <div className="mt-3 space-y-3">
          {stopBuckets.map((bucket) => {
            const id = `stops-${bucket.value}`;
            return (
              <div key={bucket.value} className="flex items-center gap-3">
                <Checkbox
                  id={id}
                  checked={filters.stops.includes(bucket.value)}
                  onCheckedChange={() =>
                    onChange({ ...filters, stops: toggle(filters.stops, bucket.value) })
                  }
                />
                <Label htmlFor={id} className="text-sm font-normal">
                  {bucket.label}
                </Label>
              </div>
            );
          })}
        </div>
      </fieldset>

      {airlines.length > 0 && (
        <fieldset>
          <legend className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Airlines
          </legend>
          <div className="mt-3 max-h-60 space-y-3 overflow-y-auto pr-1">
            {airlines.map((airline) => {
              const id = `airline-${airline.code}`;
              return (
                <div key={airline.code} className="flex items-center gap-3">
                  <Checkbox
                    id={id}
                    checked={filters.airlines.includes(airline.code)}
                    onCheckedChange={() =>
                      onChange({ ...filters, airlines: toggle(filters.airlines, airline.code) })
                    }
                  />
                  <Label htmlFor={id} className="text-sm font-normal">
                    {airline.name ?? airline.code}
                  </Label>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      {priceBounds && priceBounds[0] !== priceBounds[1] && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Max price
            </span>
            <span className="text-sm">
              {formatMoney(filters.maxPrice ?? priceBounds[1], currency)}
            </span>
          </div>
          <Slider
            className="mt-4"
            aria-label="Maximum price"
            min={Math.floor(priceBounds[0])}
            max={Math.ceil(priceBounds[1])}
            step={Math.max(1, Math.round((priceBounds[1] - priceBounds[0]) / 50))}
            value={[filters.maxPrice ?? Math.ceil(priceBounds[1])]}
            onValueChange={([value]) => onChange({ ...filters, maxPrice: value })}
          />
        </div>
      )}
    </div>
  );
}
