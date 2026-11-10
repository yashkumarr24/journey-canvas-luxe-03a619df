import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HotelResultCard } from "@/components/booking/HotelResultCard";
import { pickFeaturedCity } from "@/components/home/featured-cities";
import { DealsSkeleton } from "@/components/home/DealsSkeleton";
import { blankRoom, hotelSearchQueryOptions, stayLabel, toHotelSearchRequest, type HotelSearchFormValues } from "@/lib/hotel-search";

/**
 * "Luxury stays in <city>": a live hotel search (existing TripJack-backed
 * search) for a destination picked per visitor, showing the most expensive
 * properties it returns. Hidden entirely when there are no live results.
 */
const KEY = "fnf-featured-city";

function isoInDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function FeaturedStays() {
  const [values, setValues] = useState<HotelSearchFormValues | null>(null);
  useEffect(() => {
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(KEY); } catch { /* ignore */ }
    const city = pickFeaturedCity(stored);
    try { window.localStorage.setItem(KEY, city); } catch { /* ignore */ }
    setValues({ destination: city, checkIn: isoInDays(21), checkOut: isoInDays(22), rooms: [blankRoom()], nationality: "IN", currency: "INR" });
  }, []);
  const request = useMemo(() => (values ? toHotelSearchRequest(values) : null), [values]);
  const query = useQuery({ ...hotelSearchQueryOptions(request), refetchOnWindowFocus: false, refetchOnReconnect: false });

  const stays = useMemo(() => {
    const priced = (query.data?.results ?? []).filter((r) => r.rate?.totalPrice);
    return [...priced].sort((a, b) => b.rate!.totalPrice.amount - a.rate!.totalPrice.amount).slice(0, 4);
  }, [query.data?.results]);

  if (!values) return null;
  if (!query.isFetching && stays.length === 0) return null;

  return (
    <section aria-labelledby="featured-stays-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-gold">Hotels</p>
          <h2 id="featured-stays-heading" className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-4xl">
            Luxury stays in {values.destination}
          </h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">Our most premium live rates · {stayLabel(values.checkIn, values.checkOut)} · 2 adults</p>
        </div>
        {stays.length > 0 && (
          <Button asChild variant="outline" className="shrink-0">
            <Link to="/hotels" search={values}>See all<ArrowRight className="size-4" aria-hidden="true" /></Link>
          </Button>
        )}
      </div>
      <div className="mt-6" aria-live="polite">
        {query.isFetching ? (
          <DealsSkeleton />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stays.map((result) => (
              <HotelResultCard key={result.id} result={result} nights={query.data?.nights ?? 1} roomCount={1} searchId={query.data?.searchId} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
