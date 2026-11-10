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

export function HotelResultCard({ result, nights, roomCount, searchId, onOpen }: HotelResultCardProps) {
  const rate = result.rate;
  const location = result.location;
  const cardClass =
    "hotel-result-card group block overflow-hidden rounded-xl border border-foreground/10 bg-card text-foreground transition-all hover:border-gold/40 hover:shadow-[var(--shadow-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 sm:flex";
  const Wrapper = ({ children }: { children: ReactNode }) =>
    searchId ? (
      <Link
        to="/hotels/detail"
        search={{ searchId, hotelId: result.id }}
        onClick={() => onOpen?.(result)}
        className={cardClass}
      >
        {children}
        <span className="sr-only">View rooms and rates</span>
      </Link>
    ) : (
      <article className={cardClass}>{children}</article>
    );

  return (
    <Wrapper>
      <div className="hotel-result-photo relative aspect-[16/10] shrink-0 overflow-hidden sm:aspect-auto sm:min-h-56 sm:w-72">
        {result.thumbnailUrl ? (
          <img
            src={result.thumbnailUrl}
            alt={result.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-foreground/5 text-sm text-muted-foreground">
            No photo
          </div>
        )}
        {result.propertyType && (
          <span className="absolute left-3 top-3 rounded-sm bg-background/90 px-3 py-1 text-xs">
            {result.propertyType}
          </span>
        )}
      </div>

      <div className="hotel-result-body flex min-w-0 flex-1 flex-col gap-4 p-5 sm:flex-row sm:items-stretch sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-display text-2xl font-semibold leading-tight transition-colors group-hover:text-gold">{result.name}</h3>
            <StarRating rating={result.starRating} />
          </div>

          {location && (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {[location.area, location.city, location.country].filter(Boolean).join(", ")}
                {location.landmark && <span className="block text-xs">{location.landmark}</span>}
              </span>
            </p>
          )}

          {result.amenities && result.amenities.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {result.amenities.slice(0, 5).map((amenity) => (
                <li
                  key={amenity}
                  className="rounded-sm border border-foreground/10 px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {amenity}
                </li>
              ))}
              {result.amenities.length > 5 && (
                <li className="px-1 py-1 text-xs text-muted-foreground">
                  +{result.amenities.length - 5} more
                </li>
              )}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {rate?.roomName && (
              <span className="flex items-center gap-1.5">
                <BedDouble className="size-3.5" aria-hidden="true" />
                {rate.roomName}
              </span>
            )}
            {rate?.mealPlan && (
              <span className="flex items-center gap-1.5">
                <Utensils className="size-3.5" aria-hidden="true" />
                {rate.mealPlan}
              </span>
            )}
            {rate?.refundable && (
              <span className="flex items-center gap-1.5 text-gold">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Free cancellation available
              </span>
            )}
          </div>
        </div>

        <div className="hotel-result-price shrink-0 border-t border-foreground/10 pt-4 sm:w-44 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 sm:text-right">
          {result.reviewScore !== undefined && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground sm:justify-end">
              <span className="rounded-md bg-primary px-1.5 py-0.5 text-sm font-semibold text-primary-foreground">{result.reviewScore.toFixed(1)}</span>
              <span>
                <span className="block font-medium text-foreground">{reviewWord(result.reviewScore)}</span>
                {result.reviewCount ? `${result.reviewCount} reviews` : null}
              </span>
            </p>
          )}

          {rate ? (
            <>
              <p className="mt-3 font-display text-3xl font-semibold leading-none">
                {formatMoney(rate.totalPrice.amount, rate.totalPrice.currency)}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                total for {roomCount} room{roomCount > 1 ? "s" : ""} · {nights} night{nights > 1 ? "s" : ""}
              </p>
              {rate.perNightPrice && (
                <p className="text-xs text-muted-foreground">
                  {formatMoney(rate.perNightPrice.amount, rate.perNightPrice.currency)} per room / night
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">Includes taxes & fees</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Price on request</p>
          )}

          {searchId && (
            <span aria-hidden="true" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-gold">
              See rooms <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          )}
          {rate?.roomsAvailable !== undefined && rate.roomsAvailable <= 3 && (
            <p className="mt-2 text-xs text-destructive">Only {rate.roomsAvailable} left</p>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
