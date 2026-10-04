import { AlertCircle, BedDouble, Info, Plane } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toBookingError } from "@/lib/booking-api";
import type { AssistantSearchController } from "@/lib/assistant/use-assistant-search";
import { AssistantFlightCard, AssistantHotelCard, ResultLoading } from "./AssistantResultCards";

export function AssistantSearchResults({ search }: { search: AssistantSearchController }) {
  const { assistant, flightQuery, hotelQuery } = search;

  return (
    <div data-assistant-results className="scroll-mt-24 space-y-10">
      {search.selectError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Couldn’t continue with that fare</AlertTitle>
          <AlertDescription>{search.selectError.message}</AlertDescription>
        </Alert>
      ) : null}

      <section>
        <div className="mb-4 flex items-center gap-2">
          <Plane className="size-5 text-primary" />
          <h2 className="font-display text-2xl">Flights</h2>
          {flightQuery.isSuccess ? (
            <span className="text-xs text-muted-foreground">
              {search.preferredFlights.length} available
            </span>
          ) : null}
        </div>
        {flightQuery.isFetching ? (
          <ResultLoading>Finding the best available flights…</ResultLoading>
        ) : flightQuery.isError ? (
          <SearchError title="Flight search unavailable" error={flightQuery.error} />
        ) : search.preferredFlights.length ? (
          <div className="space-y-4">
            {search.preferredFlights.slice(0, 8).map((result) => (
              <AssistantFlightCard
                key={result.id}
                result={result}
                recommendations={search.recommendations}
                selecting={search.selectingId === result.id}
                disabled={search.selectFlightPending}
                onSelect={search.handleFlightSelect}
              />
            ))}
          </div>
        ) : flightQuery.isSuccess ? (
          <Empty text="No flights matched this trip. Ask to change dates, timing, or stops." />
        ) : null}
      </section>

      {search.hotelRequest ? (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <BedDouble className="size-5 text-primary" />
            <h2 className="font-display text-2xl">Hotels</h2>
            {hotelQuery.isSuccess ? (
              <span className="text-xs text-muted-foreground">
                {search.visibleHotels.length} available
              </span>
            ) : null}
          </div>
          {hotelQuery.isFetching ? (
            <ResultLoading>
              Finding stays in {assistant.requirements.destinationLabel ?? "your destination"}…
            </ResultLoading>
          ) : hotelQuery.isError ? (
            <SearchError title="Hotel search unavailable" error={hotelQuery.error} />
          ) : search.visibleHotels.length ? (
            <div className="space-y-4">
              {search.visibleHotels.slice(0, 8).map((hotel) => (
                <AssistantHotelCard
                  key={hotel.id}
                  hotel={hotel}
                  nights={hotelQuery.data?.nights ?? assistant.requirements.durationNights ?? 0}
                  onSelect={search.handleHotelSelect}
                />
              ))}
            </div>
          ) : hotelQuery.isSuccess ? (
            <Empty text="No stays matched this trip. Ask to change the area or dates." />
          ) : null}
        </section>
      ) : null}

      <Alert>
        <Info />
        <AlertTitle>Result integrity</AlertTitle>
        <AlertDescription>
          Prices, availability, schedules, property details, and images shown here come only from
          the existing search result data.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function SearchError({ title, error }: { title: string; error: unknown }) {
  const normalized = toBookingError(error);
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{normalized.message}</AlertDescription>
    </Alert>
  );
}
