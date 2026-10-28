import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { AlertCircle, FlaskConical, Info, Loader2, SlidersHorizontal } from "lucide-react";
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
import { ResultsSearchPanel } from "@/components/booking/ResultsSearchPanel";
import { HotelResultCard } from "@/components/booking/HotelResultCard";
import { HotelResultsSkeleton } from "@/components/booking/HotelResultsSkeleton";
import { HotelFiltersPanel } from "@/components/booking/HotelFiltersPanel";
import { useMockHotels } from "@/lib/hotel-api";
import {
  applyHotelFilters,
  collectAmenities,
  collectPropertyTypes,
  defaultHotelSearchValues,
  hotelSearchSchema,
  hotelPriceRange,
  hotelSearchQueryOptions,
  hotelSortOptions,
  occupancyLabel,
  sortHotelResults,
  stayLabel,
  toHotelSearchRequest,
  type HotelSearchFormValues,
} from "@/lib/hotel-search";
import { bookingApi, toBookingError } from "@/lib/booking-api";
import { useAnalytics, useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import {
  defaultHotelFilters,
  type HotelFilters,
  type HotelResult,
  type HotelSearchProgress,
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
  // Optional hand-off from the homepage search; re-validated below.
  validateSearch: z.object({
    destination: z.string().optional(),
    destinationKind: z.enum(['hotel', 'city']).optional(),
    destinationId: z.string().optional(),
    checkIn: z.string().optional(),
    checkOut: z.string().optional(),
    rooms: z.unknown().optional(),
    nationality: z.string().optional(),
    currency: z.string().optional(),
  }),
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
  const search = Route.useSearch();
  const initialParsed = hotelSearchSchema.safeParse({ ...defaultHotelSearchValues, ...search, rooms: search.rooms ?? defaultHotelSearchValues.rooms });
  const initialValues = search.destination && initialParsed.success ? initialParsed.data : undefined;
  const [request, setRequest] = useState<HotelSearchRequest | null>(() => initialValues ? toHotelSearchRequest(initialValues) : null);
  const [filters, setFilters] = useState<HotelFilters>(defaultHotelFilters);
  const [sort, setSort] = useState<HotelSortKey>("recommended");
  const { track } = useAnalytics();

  // refetchOnMount: false keeps results handed over from the homepage.
  const query = useQuery({ ...hotelSearchQueryOptions(request), refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false });

  const results = query.data?.results ?? [];
  const currency = query.data?.currency ?? request?.currency ?? "INR";
  const nights = query.data?.nights ?? 0;
  const roomCount = request?.rooms.length ?? 1;

  useTrackOnce(ANALYTICS_EVENTS.hotelResultsViewed, results.length > 0, {
    resultCount: results.length,
  });

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
  const unsupported = error?.code === "HOTEL_DESTINATION_UNSUPPORTED";

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
    <main className="results-page relative min-h-svh bg-background text-foreground">
      <Nav />

      <section className="mx-auto max-w-7xl px-3 pb-16 pt-28 sm:px-6 sm:pt-32 lg:pt-44">
        {!request && <SectionTitle
          eyebrow="Hotels"
          title={
            <>
              Stay somewhere <span className="italic gold-gradient">worth the journey.</span>
            </>
          }
          subtitle="Tell us the city and the dates. We show the room, the meal plan and the cancellation terms before you commit to anything."
        />}

        <ResultsSearchPanel active={!!request} title={request?.destination ?? "Hotels"} detail={request ? `${stayLabel(request.checkIn, request.checkOut)} · ${occupancyLabel(request.rooms)}` : ""}>
          <HotelSearchForm compact onSearch={handleSearch} isSearching={query.isFetching} initialValues={initialValues} />
        </ResultsSearchPanel>

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
          <div className="mt-4 lg:mt-10">
            <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-end lg:justify-between">
              <div className="hidden min-w-0 lg:block">
                <p className="font-display text-2xl leading-tight">{request.destination}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {stayLabel(request.checkIn, request.checkOut)} · {occupancyLabel(request.rooms)}
                  {query.data ? ` · ${results.length} stays found` : ""}
                </p>
              </div>

              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 lg:flex">
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
                  <SelectTrigger className="w-full min-w-0 lg:w-48" aria-label="Sort results">
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
                {query.data?.partial && <Alert className="mb-4" role="status"><AlertTitle>Incomplete hotel search</AlertTitle><AlertDescription className="space-y-2"><p>Results from {query.data.completedBatches} of {(query.data.completedBatches ?? 0) + (query.data.failedBatches ?? 0)} batches are shown. Other properties could not be checked.</p><Button type="button" variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry hotel search</Button></AlertDescription></Alert>}
                {query.isFetching && <HotelResultsSkeleton />}

                {!query.isFetching && error && (
                  <Alert variant={notConfigured ? "default" : "destructive"} role="alert">
                    {notConfigured ? (
                      <Info className="size-4" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="size-4" aria-hidden="true" />
                    )}
                    <AlertTitle>
                      {unsupported ? "Destination not supported" : notConfigured ? "Live hotel rates aren't connected yet" : "Hotel search is temporarily unavailable"}
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
                   <div className="rounded-sm border border-dashed border-foreground/15 p-10 text-center">
                    <p className="font-display text-2xl">No stays for these dates</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Try nearby dates, a different area, or fewer rooms — or let our desk find something for you.
                    </p>
                  </div>
                )}

                {!query.isFetching && !error && results.length > 0 && visible.length === 0 && (
                   <div className="rounded-sm border border-dashed border-foreground/15 p-10 text-center">
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
