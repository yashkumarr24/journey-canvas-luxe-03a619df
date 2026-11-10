import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AlertCircle, FlaskConical, History, Info, Loader2, SlidersHorizontal } from "lucide-react";
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
  hotelSearchKey,
  hotelSearchQueryOptions,
  hotelSearchRestoreQueryOptions,
  hotelSortOptions,
  occupancyLabel,
  sortHotelResults,
  stayLabel,
  toHotelSearchRequest,
  type HotelSearchFormValues,
} from "@/lib/hotel-search";
import { bookingApi, toBookingError } from "@/lib/booking-api";
import {
  readHotelResultsView,
  rememberLastResults,
  rememberRecentHotelSearch,
  saveHotelResultsView,
} from "@/lib/hotel-results-state";
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
    /** Server search session, so a refresh can reopen the same results. */
    sid: z.string().max(128).optional(),
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
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<HotelSearchRequest | null>(() => initialValues ? toHotelSearchRequest(initialValues) : null);
  const [filters, setFilters] = useState<HotelFilters>(defaultHotelFilters);
  const [sort, setSort] = useState<HotelSortKey>("recommended");
  const { track } = useAnalytics();

  // Back/refresh: reuse cached results when present (Back), otherwise reopen
  // the server session named in the URL (refresh). A fresh search only runs
  // when the visitor asks for one.
  const [restoreId, setRestoreId] = useState<string | null>(() => {
    if (!search.sid || !request || useMockHotels) return null;
    return queryClient.getQueryData(hotelSearchKey(request)) ? null : search.sid;
  });
  const searchQuery = useQuery({ ...hotelSearchQueryOptions(restoreId ? null : request), refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const restoreQuery = useQuery({ ...hotelSearchRestoreQueryOptions(restoreId, request), refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const query = restoreId ? restoreQuery : searchQuery;
  const restoreExpired = Boolean(restoreId && restoreQuery.isError);

  // Progressive search: while the server reports `loading`, poll the
  // progress endpoint and append new stays (deduplicated by id) until the
  // search is complete or partially failed.
  const [appended, setAppended] = useState<HotelResult[]>([]);
  const [progress, setProgress] = useState<HotelSearchProgress | null>(null);
  const searchId = query.data?.searchId;
  const loadingMore = query.data?.loading === true && progress?.status !== "complete" && progress?.status !== "partial";

  useEffect(() => {
    setAppended([]);
    setProgress(null);
    if (!query.data?.loading || !searchId) return;
    let cancelled = false;
    let offset = query.data.results.length;
    const seen = new Set(query.data.results.map((result) => result.id));
    const poll = async () => {
      try {
        const chunk = await bookingApi.hotelSearchProgress(searchId, offset);
        if (cancelled) return;
        offset = chunk.nextOffset;
        const fresh = chunk.results.filter((result) => !seen.has(result.id));
        fresh.forEach((result) => seen.add(result.id));
        if (fresh.length > 0) setAppended((prev) => [...prev, ...fresh]);
        setProgress(chunk);
        return chunk.status === "loading";
      } catch {
        // A failed poll never loses the search; try again next tick.
        return true;
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const keepGoing = await poll();
      if (!cancelled && keepGoing) timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 1200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [searchId, query.data?.loading, query.data?.results]);

  // Put the server session id in the URL once results arrive (replace, so Back
  // still goes to the previous page) and remember it for the detail page.
  useEffect(() => {
    if (!searchId || !request) return;
    const next = { ...search, sid: searchId };
    if (search.sid !== searchId) void navigate({ to: "/hotels", search: next, replace: true });
    rememberLastResults(next);
  }, [searchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore this visitor's filters, sort and scroll for the same session.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!searchId || restoredFor.current === searchId || query.isFetching) return;
    restoredFor.current = searchId;
    const view = readHotelResultsView(searchId);
    if (!view) return;
    setFilters({ ...defaultHotelFilters, ...view.filters });
    setSort(view.sort);
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: view.scrollY })));
  }, [searchId, query.isFetching]);

  useEffect(() => {
    if (!searchId || restoredFor.current !== searchId) return;
    saveHotelResultsView(searchId, { filters, sort, scrollY: readHotelResultsView(searchId)?.scrollY ?? 0 });
  }, [searchId, filters, sort]);

  const rememberScroll = () => {
    if (searchId) saveHotelResultsView(searchId, { filters, sort, scrollY: window.scrollY });
  };

  const results = useMemo(
    () => [...(query.data?.results ?? []), ...appended],
    [query.data?.results, appended],
  );
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
    setAppended([]);
    setProgress(null);
    const request = toHotelSearchRequest(values);
    rememberRecentHotelSearch(values);
    setRestoreId(null);
    setRequest(request);
    restoredFor.current = null;
    void navigate({ to: "/hotels", search: { ...values } });
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

  const error = query.isError && !restoreExpired ? toBookingError(query.error) : null;
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
                <h1 className="font-display text-3xl font-semibold leading-tight">{request.destination}</h1>
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
                {query.data?.partial && !query.data.loading && <Alert className="mb-4" role="status"><AlertTitle>Incomplete hotel search</AlertTitle><AlertDescription className="space-y-2"><p>Results from {query.data.completedBatches} of {(query.data.completedBatches ?? 0) + (query.data.failedBatches ?? 0)} batches are shown. Other properties could not be checked.</p><Button type="button" variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry hotel search</Button></AlertDescription></Alert>}
                {loadingMore && (
                  <div className="mb-4 flex items-center gap-2 rounded-sm border border-foreground/10 px-4 py-3 text-sm text-muted-foreground" role="status" aria-live="polite">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Loading more stays… {results.length} found so far. Rates are provisional until you open a hotel.</span>
                  </div>
                )}
                {progress?.status === "partial" && <Alert className="mb-4" role="status"><AlertTitle>Incomplete hotel search</AlertTitle><AlertDescription className="space-y-2"><p>Results from {progress.completedBatches} of {progress.totalBatches} batches are shown. Other properties could not be checked.</p><Button type="button" variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry hotel search</Button></AlertDescription></Alert>}
                {query.isFetching && <HotelResultsSkeleton />}

                {restoreExpired && (
                  <div className="rounded-xl border border-foreground/10 bg-card p-8 text-center" role="alert">
                    <History className="mx-auto size-6 text-gold" aria-hidden="true" />
                    <p className="mt-3 font-display text-2xl font-semibold">This search has expired</p>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                      Hotel rates change quickly, so we don't show results from an expired search. Search again for current prices.
                    </p>
                    <Button
                      type="button"
                      className="mt-5"
                      onClick={() => {
                        setRestoreId(null);
                        void navigate({ to: "/hotels", search: { ...search, sid: undefined }, replace: true });
                      }}
                    >
                      Search again
                    </Button>
                  </div>
                )}

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

                {!query.isFetching && !error && !restoreExpired && !loadingMore && results.length === 0 && (
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
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map((result) => (
                      <HotelResultCard
                        key={result.id}
                        result={result}
                        nights={nights}
                        roomCount={roomCount}
                        searchId={searchId}
                        onOpen={rememberScroll}
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
