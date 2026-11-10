import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { BedDouble, ChevronRight, MapPin, ShieldCheck, Star, Utensils } from "lucide-react";
import { formatMoney } from "@/lib/flight-search";
import type { HotelResult } from "@/types/booking";

/**
 * One hotel in the results list. Every figure comes from the search response;
 * nothing is calculated in the browser.
 */

export interface HotelResultCardProps {
  result: HotelResult;
  nights: number;
  roomCount: number;
  /** Server search session; when set, the whole card links to the hotel's detail page. */
  searchId?: string;
  /** Called just before navigating, e.g. to remember the scroll position. */
  onOpen?: (result: HotelResult) => void;
}

export function StarRating({ rating }: { rating?: number }) {
  if (!rating) return null;
  return (
    <span className="flex items-center gap-0.5" aria-label={`${rating} star property`}>
      {Array.from({ length: Math.round(rating) }, (_, index) => (
        <Star key={index} className="size-3.5 fill-gold text-gold" aria-hidden="true" />
      ))}
    </span>
  );
}

function reviewWord(score: number) {
  if (score >= 9) return "Exceptional";
  if (score >= 8) return "Wonderful";
  if (score >= 7) return "Very good";
  if (score >= 6) return "Good";
  return "Rated";
}

const cardClass =
  "hotel-result-card group flex h-full flex-col overflow-hidden rounded-xl border border-foreground/10 bg-card text-foreground shadow-sm transition-all hover:border-gold/40 hover:shadow-[var(--shadow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2";

function CardShell({ result, searchId, onOpen, children }: { result: HotelResult; searchId?: string; onOpen?: (result: HotelResult) => void; children: ReactNode }) {
  if (!searchId) return <article className={cardClass}>{children}</article>;
  return (
    <Link to="/hotels/detail" search={{ searchId, hotelId: result.id }} onClick={() => onOpen?.(result)} className={cardClass}>
      {children}
      <span className="sr-only">View rooms and rates</span>
    </Link>
  );
}

/** Grid-style result card: photo, name + stars, location, rate notes, amenities, price. */
export function HotelResultCard({ result, nights, roomCount, searchId, onOpen }: HotelResultCardProps) {
  const rate = result.rate;
  const location = result.location;
  const photoCount = result.images?.length ?? (result.thumbnailUrl ? 1 : 0);
  const freeUntil = rate?.freeCancellationUntil ? new Date(rate.freeCancellationUntil) : null;
  return (
    <CardShell result={result} searchId={searchId} onOpen={onOpen}>
      <div className="hotel-result-photo relative aspect-[16/10] shrink-0 overflow-hidden p-2 pb-0">
        {result.thumbnailUrl ? (
          <img src={result.thumbnailUrl} alt={result.name} loading="lazy" className="size-full rounded-lg object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex size-full items-center justify-center rounded-lg bg-foreground/5 text-sm text-muted-foreground">No photo</div>
        )}
        {result.propertyType && (
          <span className="absolute left-4 top-4 rounded-sm bg-background/90 px-2.5 py-1 text-xs">{result.propertyType}</span>
        )}
        {photoCount > 1 && (
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-foreground/75 px-2.5 py-0.5 text-[11px] font-medium text-background">
            1 / {photoCount}
          </span>
        )}
      </div>

      <div className="hotel-result-body flex min-w-0 flex-1 flex-col p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <h3 className="line-clamp-2 font-display text-lg font-semibold leading-snug transition-colors group-hover:text-gold">{result.name}</h3>
          <StarRating rating={result.starRating} />
        </div>
        {location && (
          <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span className="line-clamp-1">{[location.area, location.city, location.country].filter(Boolean).join(", ")}</span>
          </p>
        )}

        <ul className="mt-3 space-y-1 border-t border-foreground/10 pt-3 text-xs">
          {rate?.roomName && <li className="flex items-center gap-1.5 text-muted-foreground"><BedDouble className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{rate.roomName}</span></li>}
          {rate?.mealPlan && <li className="flex items-center gap-1.5 text-muted-foreground"><Utensils className="size-3.5 shrink-0" aria-hidden="true" />{rate.mealPlan}</li>}
          {rate?.refundable && (
            <li className="flex items-center gap-1.5 font-medium text-gold">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              {freeUntil && !Number.isNaN(freeUntil.getTime())
                ? `Free cancellation till ${freeUntil.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
                : "Free cancellation available"}
            </li>
          )}
        </ul>

        {result.amenities && result.amenities.length > 0 && (
          <p className="mt-2 line-clamp-2 text-xs text-foreground/80">
            {result.amenities.slice(0, 4).join(" · ")}
            {result.amenities.length > 4 && <span className="text-muted-foreground"> +{result.amenities.length - 4} more</span>}
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div className="min-w-0">
            {result.reviewScore !== undefined && (
              <p className="flex items-center gap-1.5 text-xs">
                <span className="rounded-md bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground">{result.reviewScore.toFixed(1)}</span>
                <span className="font-medium">{reviewWord(result.reviewScore)}</span>
                {result.reviewCount ? <span className="text-muted-foreground">({result.reviewCount})</span> : null}
              </p>
            )}
            {rate?.roomsAvailable !== undefined && rate.roomsAvailable <= 3 && (
              <p className="mt-1 text-xs text-destructive">Only {rate.roomsAvailable} left</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            {rate ? (
              <>
                <p className="font-display text-xl font-semibold leading-none">{formatMoney(rate.totalPrice.amount, rate.totalPrice.currency)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {roomCount} room{roomCount > 1 ? "s" : ""} · {nights} night{nights > 1 ? "s" : ""} · incl. taxes
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Price on request</p>
            )}
            {searchId && (
              <span aria-hidden="true" className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-gold">
                See rooms <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            )}
          </div>
        </div>
      </div>
    </CardShell>
  );
}
