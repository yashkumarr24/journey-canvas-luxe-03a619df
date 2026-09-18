import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { formatMoney } from "@/lib/flight-search";
import { defaultHotelFilters, type HotelFilters } from "@/types/booking";

/** Client-side narrowing of results already returned by the server. */

export interface HotelFiltersPanelProps {
  filters: HotelFilters;
  onChange: (filters: HotelFilters) => void;
  amenities: string[];
  propertyTypes: string[];
  priceBounds?: [number, number];
  currency: string;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function HotelFiltersPanel({
  filters,
  onChange,
  amenities,
  propertyTypes,
  priceBounds,
  currency,
}: HotelFiltersPanelProps) {
  const maxPrice = filters.maxPrice ?? priceBounds?.[1];

  return (
    <div className="space-y-7 rounded-3xl border border-foreground/10 bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Filters</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(defaultHotelFilters)}>
          Clear all
        </Button>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Star rating</legend>
        <div className="mt-3 space-y-2">
          {[5, 4, 3].map((stars) => (
            <label key={stars} className="flex items-center gap-3 text-sm text-muted-foreground">
              <Checkbox
                checked={filters.starRatings.includes(stars)}
                onCheckedChange={() => onChange({ ...filters, starRatings: toggle(filters.starRatings, stars) })}
              />
              {stars} star{stars > 1 ? "s" : ""}
            </label>
          ))}
        </div>
      </fieldset>

      {priceBounds && priceBounds[1] > priceBounds[0] && (
        <fieldset>
          <legend className="text-sm font-medium">Total price</legend>
          <p className="mt-2 text-xs text-muted-foreground">
            Up to {formatMoney(maxPrice, currency)} for the whole stay
          </p>
          <Slider
            className="mt-4"
            min={priceBounds[0]}
            max={priceBounds[1]}
            step={Math.max(1, Math.round((priceBounds[1] - priceBounds[0]) / 40))}
            value={[maxPrice ?? priceBounds[1]]}
            onValueChange={([value]) => onChange({ ...filters, maxPrice: value })}
            aria-label="Maximum total price"
          />
        </fieldset>
      )}

      <fieldset>
        <legend className="text-sm font-medium">Cancellation</legend>
        <label className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
          <Checkbox
            checked={filters.freeCancellationOnly}
            onCheckedChange={(checked) => onChange({ ...filters, freeCancellationOnly: checked === true })}
          />
          Free cancellation only
        </label>
      </fieldset>

      {propertyTypes.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium">Property type</legend>
          <div className="mt-3 space-y-2">
            {propertyTypes.map((type) => (
              <label key={type} className="flex items-center gap-3 text-sm text-muted-foreground">
                <Checkbox
                  checked={filters.propertyTypes.includes(type)}
                  onCheckedChange={() =>
                    onChange({ ...filters, propertyTypes: toggle(filters.propertyTypes, type) })
                  }
                />
                {type}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {amenities.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium">Amenities</legend>
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
            {amenities.map((amenity) => {
              const id = `amenity-${amenity.replace(/\s+/g, "-").toLowerCase()}`;
              return (
                <div key={amenity} className="flex items-center gap-3">
                  <Checkbox
                    id={id}
                    checked={filters.amenities.includes(amenity)}
                    onCheckedChange={() => onChange({ ...filters, amenities: toggle(filters.amenities, amenity) })}
                  />
                  <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">
                    {amenity}
                  </Label>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
