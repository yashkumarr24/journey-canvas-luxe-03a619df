import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Info, SlidersHorizontal } from "lucide-react";
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
import { FlightSearchForm } from "@/components/booking/FlightSearchForm";
import { FlightResultCard } from "@/components/booking/FlightResultCard";
import { FlightResultsSkeleton } from "@/components/booking/FlightResultsSkeleton";
import { FlightFiltersPanel } from "@/components/booking/FlightFiltersPanel";
import {
  flightSearchQueryOptions,
  toSearchRequest,
  type FlightSearchFormValues,
} from "@/lib/flight-search";
import { applyFlightFilters, collectAirlines, priceRange, sortFlightResults, sortOptions } from "@/lib/flight-filters";
import { toBookingError } from "@/lib/booking-api";
import {
  defaultFlightFilters,
  type FlightFilters,
  type FlightSearchRequest,
  type FlightSortKey,
} from "@/types/booking";

export const Route = createFileRoute("/flights")({
  head: () => ({
    meta: [
      { title: "Flight Search — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Search one-way and round-trip flights with Fly n Feel Holidays and get fares quoted from your departure city by our travel desk.",
      },
      { property: "og:title", content: "Flight Search — Fly n Feel Holidays" },
      {
        property: "og:description",
        content: "Compare one-way and round-trip fares and let our desk build the full journey around you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FlightsPage,
});

function FlightsPage() {
  const [request, setRequest] = useState<FlightSearchRequest | null>(null);
  const [filters, setFilters] = useState<FlightFilters>(defaultFlightFilters);
  const [sort, setSort] = useState<FlightSortKey>("recommended");

  // The query is disabled until a valid search is submitted, so nothing runs
  // on page load. Each submitted request has its own key, and TanStack Query
  // aborts the in-flight request via the signal we forward to the API client,
  // so an older search can never overwrite a newer one.
  const query = useQuery(flightSearchQueryOptions(request));

  const results = query.data?.results ?? [];
  const currency = query.data?.currency ?? "INR";

  const airlines = useMemo(() => collectAirlines(results), [results]);
  const bounds = useMemo(() => priceRange(results), [results]);
  const visible = useMemo(
    () => sortFlightResults(applyFlightFilters(results, filters), sort),
    [results, filters, sort],
  );

  const handleSearch = (values: FlightSearchFormValues) => {
    setFilters(defaultFlightFilters);
    setRequest(toSearchRequest(values));
  };

  const error = query.isError ? toBookingError(query.error) : null;
  const notConfigured = error?.kind === "not_implemented";

  const filtersPanel = (
    <FlightFiltersPanel
      filters={filters}
      onChange={setFilters}
      airlines={airlines}
      priceBounds={bounds}
      currency={currency}
    />
  );

  return (
    <main className="relative min-h-svh bg-background text-foreground">
      <Nav />

      <section className="mx-auto max-w-7xl px-6 pb-16 pt-36 sm:pt-40 lg:pt-44">
        <SectionTitle
          eyebrow="Flights"
          title={
            <>
              Search flights, <span className="italic gold-gradient">book with people.</span>
            </>
          }
          subtitle="Tell us where you're headed. Our desk quotes the fare, the routing and the extras — so the journey is handled end to end."
        />

        <div className="mt-10">
          <FlightSearchForm onSearch={handleSearch} isSearching={query.isFetching} />
        </div>

        <div className="mt-12">
          {query.isFetching && <FlightResultsSkeleton />}

          {!query.isFetching && error && (
            <Alert variant={notConfigured ? "default" : "destructive"} role="alert">
              {notConfigured ? (
                <Info className="size-4" aria-hidden="true" />
              ) : (
                <AlertCircle className="size-4" aria-hidden="true" />
              )}
              <AlertTitle>
                {notConfigured ? "Flight search service is being configured" : "We couldn't complete that search"}
              </AlertTitle>
              <AlertDescription>
                <p>{error.message}</p>
                {notConfigured && (
                  <p className="mt-2">
                    Live fares aren't switched on yet. In the meantime, our travel desk can quote
                    your route directly — call or write to us and we'll come back with options.
                  </p>
                )}
                {!notConfigured && error.retryable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => query.refetch()}
                  >
                    Try again
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {!query.isFetching && !error && query.isSuccess && (
            <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
              <aside className="hidden lg:block">{filtersPanel}</aside>

              <div>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    {visible.length} of {results.length} result{results.length === 1 ? "" : "s"}
                  </p>

                  <div className="flex items-center gap-3">
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="lg:hidden">
                          <SlidersHorizontal className="size-4" aria-hidden="true" />
                          Filters
                        </Button>
                      </SheetTrigger>
                      <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto">
                        <SheetHeader>
                          <SheetTitle>Filter flights</SheetTitle>
                        </SheetHeader>
                        <div className="px-4 pb-8">{filtersPanel}</div>
                      </SheetContent>
                    </Sheet>

                    <Select value={sort} onValueChange={(value) => setSort(value as FlightSortKey)}>
                      <SelectTrigger className="w-44" aria-label="Sort results">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sortOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {visible.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
                    <p className="font-display text-2xl">No flights match this search</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Try different dates, nearby airports, or clear a few filters.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {visible.map((result) => (
                      <FlightResultCard key={result.id} result={result} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {!query.isFetching && !error && !query.isSuccess && (
            <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
              <p className="font-display text-2xl">Where would you like to fly?</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Enter your route and dates above to see available fares.
              </p>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
