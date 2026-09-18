import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FlaskConical, Info, SlidersHorizontal } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SectionTitle } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HotelSearchForm } from "@/components/booking/HotelSearchForm";
import { HotelResultCard } from "@/components/booking/HotelResultCard";
import { HotelResultsSkeleton } from "@/components/booking/HotelResultsSkeleton";
import { HotelFiltersPanel } from "@/components/booking/HotelFiltersPanel";
import { useMockHotels } from "@/lib/hotel-api";
import {
  applyHotelFilters,
  collectAmenities,
  collectPropertyTypes,
  hotelPriceRange,
  hotelSearchQueryOptions,
  hotelSortOptions,
  occupancyLabel,
  sortHotelResults,
  stayLabel,
  toHotelSearchRequest,
  type HotelSearchFormValues,
} from "@/lib/hotel-search";
import { toBookingError } from "@/lib/booking-api";
import { useAnalytics, useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import {
  defaultHotelFilters,
  type HotelFilters,
  type HotelResult,
  type HotelSearchRequest,
  type HotelSortKey,
} from "@/types/booking";

/**
 * Hotel search + results.
 *
 * Prices, availability and the search session all belong to the server. The
 * page holds only the opaque search id it was given, and passes it forward.
 */

export const Route = createFileRoute("/hotels/")({
  head: () => ({
    meta: [
      { title: "Hotel Search — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Search handpicked hotels, resorts and villas with Fly n Feel Holidays — live rates, meal plans and free-cancellation options for your dates.",
      },
      { property: "og:title", content: "Hotel Search — Fly n Feel Holidays" },
      {
        property: "og:description",
        content: "Find the right stay for your dates, with rates and cancellation terms shown upfront.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HotelsPage,
});

function HotelsPage() {
  const navigate = useNavigate();
  const [request, setRequest] = useState<HotelSearchRequest | null>(null);
  const [filters, setFilters] = useState<HotelFilters>(defaultHotelFilters);
  const [sort, setSort] = useState<HotelSortKey>("recommended");
  const { track } = useAnalytics();

  const query = useQuery(hotelSearchQueryOptions(request));

  const results = query.data?.results ?? [];
  const currency = query.data?.currency ?? request?.currency ?? "INR";
  const nights = query.data?.nights ?? 0;
  const roomCount = request?.rooms.length ?? 1;

  const amenities = useMemo(
    () => query.data?.amenities ?? collectAmenities(results),
    [query.data?.amenities, results],
  );
  const propertyTypes = useMemo(
    () => query.data?.propertyTypes ?? collectPropertyTypes(results),
    [query.data?.propertyTypes, results],
  );
  const bounds = useMemo(() => hotelPriceRange(results), [results]);
  const visible = useMemo(
    () => sortHotelResults(applyHotelFilters(results, filters), sort),
    [results, filters, sort],
  );

  const handleSearch = (values: HotelSearchFormValues) => {
    setFilters(defaultHotelFilters);
    setSort("recommended");
    const request = toHotelSearchRequest(values);
    setRequest(request);
    // Destination, dates and occupancy counts only — no guest identity.
    track(ANALYTICS_EVENTS.hotelSearch, {
      destination: request.destination,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      rooms: request.rooms.length,
      adults: request.rooms.reduce((sum, room) => sum + (room.adults ?? 0), 0),
      children: request.rooms.reduce((sum, room) => sum + (room.childAges?.length ?? 0), 0),
    });
  };

  const openHotel = (result: HotelResult) => {
    if (!query.data?.searchId) return;
    navigate({
      to: "/hotels/detail",
      search: { searchId: query.data.searchId, hotelId: result.id },
    });
  };

  const error = query.isError ? toBookingError(query.error) : null;
  const notConfigured = error?.kind === "not_implemented";

  const filtersPanel = (
    <HotelFiltersPanel
      filters={filters}
      onChange={(next) => {
        setFilters(next);
        track(ANALYTICS_EVENTS.hotelFilterUsed);
      }}
      amenities={amenities}
      propertyTypes={propertyTypes}
      priceBounds={bounds}
      currency={currency}
    />
  );

  return (
    <main className="relative min-h-svh bg-background text-foreground">
      <Nav />

      <section className="mx-auto max-w-7xl px-6 pb-16 pt-36 sm:pt-40 lg:pt-44">
        <SectionTitle
          eyebrow="Hotels"
          title={
            <>
              Stay somewhere <span className="italic gold-gradient">worth the journey.</span>
            </>
          }
          subtitle="Tell us the city and the dates. We show the room, the meal plan and the cancellation terms before you commit to anything."
        />

        <div className="mt-10">
          <HotelSearchForm onSearch={handleSearch} isSearching={query.isFetching} />
        </div>

        {useMockHotels && (
          <Alert className="mt-6" role="status">
            <FlaskConical className="size-4" aria-hidden="true" />
            <AlertTitle>Preview mode</AlertTitle>
            <AlertDescription>
              Live hotel rates aren't connected yet, so these results are sample stays used to rehearse the
              whole booking journey. No money moves and nothing is reserved.
            </AlertDescription>
          </Alert>
        )}

        {request && (
          <div className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-display text-2xl leading-tight">{request.destination}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {stayLabel(request.checkIn, request.checkOut)} · {occupancyLabel(request.rooms)}
                  {query.data ? ` · ${results.length} stays found` : ""}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" className="lg:hidden">
                      <SlidersHorizontal className="size-4" aria-hidden="true" />
                      Filters
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[90vw] max-w-sm overflow-y-auto p-4">
                    <SheetHeader>
                      <SheetTitle>Filter stays</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4">{filtersPanel}</div>
                  </SheetContent>
                </Sheet>

                <Select value={sort} onValueChange={(value) => setSort(value as HotelSortKey)}>
                  <SelectTrigger className="w-48" aria-label="Sort results">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hotelSortOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-6 grid gap-8 lg:grid-cols-[280px_1fr]">
              <aside className="hidden lg:block lg:sticky lg:top-28 lg:self-start">{filtersPanel}</aside>

              <div className="min-w-0">
                {query.isFetching && <HotelResultsSkeleton />}

                {!query.isFetching && error && (
                  <Alert variant={notConfigured ? "default" : "destructive"} role="alert">
                    {notConfigured ? (
                      <Info className="size-4" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="size-4" aria-hidden="true" />
                    )}
                    <AlertTitle>
                      {notConfigured ? "Live hotel rates aren't connected yet" : "We couldn't complete that search"}
                    </AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>{error.message}</p>
                      <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>
                        Try again
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {!query.isFetching && !error && results.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
                    <p className="font-display text-2xl">No stays for these dates</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Try nearby dates, a different area, or fewer rooms — or let our desk find something for you.
                    </p>
                  </div>
                )}

                {!query.isFetching && !error && results.length > 0 && visible.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
                    <p className="font-display text-2xl">No stays match your filters</p>
                    <Button type="button" variant="outline" className="mt-4" onClick={() => setFilters(defaultHotelFilters)}>
                      Clear filters
                    </Button>
                  </div>
                )}

                {!query.isFetching && visible.length > 0 && (
                  <div className="space-y-4">
                    {visible.map((result) => (
                      <HotelResultCard
                        key={result.id}
                        result={result}
                        nights={nights}
                        roomCount={roomCount}
                        onSelect={openHotel}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
