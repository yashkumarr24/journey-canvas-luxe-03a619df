import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BedDouble } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HotelResultCard } from "@/components/booking/HotelResultCard";
import { HotelResultsSkeleton } from "@/components/booking/HotelResultsSkeleton";
import { readRecentHotelSearch } from "@/lib/hotel-results-state";
import { hotelSearchQueryOptions, occupancyLabel, stayLabel, toHotelSearchRequest, type HotelSearchFormValues } from "@/lib/hotel-search";

/**
 * "Top deals for your recent search": re-runs the visitor's last hotel search
 * through the existing hotel search (live TripJack rates via our server) and
 * shows the best-priced stays it returns. Nothing is invented — with no recent
 * search, or no results, an honest prompt is shown instead.
 */
export function TopDeals() {
  const [recent, setRecent] = useState<HotelSearchFormValues | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setRecent(readRecentHotelSearch());
    setReady(true);
  }, []);
  const request = useMemo(() => (recent ? toHotelSearchRequest(recent) : null), [recent]);
  const query = useQuery({ ...hotelSearchQueryOptions(request), refetchOnWindowFocus: false, refetchOnReconnect: false });

  const deals = useMemo(() => {
    const priced = (query.data?.results ?? []).filter((result) => result.rate?.totalPrice);
    return [...priced].sort((a, b) => (a.rate!.totalPrice.amount - b.rate!.totalPrice.amount)).slice(0, 4);
  }, [query.data?.results]);

  if (!ready) return null;

  return (
    <section aria-labelledby="top-deals-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.25em] text-gold">Hotels</p>
          <h2 id="top-deals-heading" className="mt-2 font-display text-3xl leading-tight sm:text-4xl">
            Top deals for your recent search
          </h2>
          {recent && (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {recent.destination} · {stayLabel(recent.checkIn, recent.checkOut)} · {occupancyLabel(recent.rooms)}
            </p>
          )}
        </div>
        {recent && deals.length > 0 && (
          <Button asChild variant="outline" className="shrink-0">
            <Link to="/hotels" search={recent}>See all<ArrowRight className="size-4" aria-hidden="true" /></Link>
          </Button>
        )}
      </div>

      <div className="mt-6" aria-live="polite">
        {!recent && (
          <EmptyDeals text="Search for a hotel and we'll show the best-priced stays for your destination and dates here." />
        )}
        {recent && query.isFetching && <HotelResultsSkeleton />}
        {recent && !query.isFetching && query.isError && (
          <EmptyDeals text="We couldn't load live rates for your recent search just now. Try searching again." />
        )}
        {recent && !query.isFetching && query.data && deals.length === 0 && (
          <EmptyDeals text={`No stays are available in ${recent.destination} for those dates. Try different dates.`} />
        )}
        {deals.length > 0 && !query.isFetching && (
          <div className="grid gap-4 lg:grid-cols-2">
            {deals.map((result) => (
              <HotelResultCard
                key={result.id}
                result={result}
                nights={query.data?.nights ?? 0}
                roomCount={request?.rooms.length ?? 1}
                searchId={query.data?.searchId}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyDeals({ text }: { text: string }) {
  return (
    <div className="grid gap-4 rounded-xl border border-dashed border-foreground/15 bg-card p-6 sm:flex sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-3 text-sm text-muted-foreground">
        <BedDouble className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden="true" />
        {text}
      </p>
      <Button asChild className="shrink-0 bg-gold text-primary-foreground hover:bg-primary">
        <Link to="/hotels">Search hotels</Link>
      </Button>
    </div>
  );
}
