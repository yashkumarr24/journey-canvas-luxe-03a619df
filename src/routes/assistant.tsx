import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Info } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FlightResultCard } from "@/components/booking/FlightResultCard";
import { FlightResultsSkeleton } from "@/components/booking/FlightResultsSkeleton";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { TravelSummaryCard } from "@/components/assistant/TravelSummaryCard";
import { RecommendationList } from "@/components/assistant/RecommendationList";
import { SUGGESTED_PROMPTS, useAssistant } from "@/lib/assistant/use-assistant";
import { toValidatedSearchRequest } from "@/lib/assistant/requirements";
import { applyPreferenceFilters, buildRecommendations } from "@/lib/assistant/recommendations";
import { flightSearchQueryOptions } from "@/lib/flight-search";
import { bookingApi, toBookingError } from "@/lib/booking-api";
import { newIdempotencyKey, rememberGuestToken } from "@/lib/review-session";
import { useAnalytics, useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { FlightResult, FlightSearchRequest } from "@/types/booking";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "Travel Assistant — Plan your flight in a sentence | Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Describe your trip in your own words and the Fly n Feel travel assistant turns it into a live flight search, then explains the best options from the real results.",
      },
      { property: "og:title", content: "Travel Assistant | Fly n Feel Holidays" },
      {
        property: "og:description",
        content:
          "Tell us where and when you want to fly. The assistant builds the search and recommends from real flight results.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssistantPage,
});

function AssistantPage() {
  const assistant = useAssistant();
  const { track } = useAnalytics();
  const navigate = useNavigate();

  const [request, setRequest] = useState<FlightSearchRequest | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  useTrackOnce(ANALYTICS_EVENTS.assistantOpened, true, { mode: assistant.isDemo ? "demo" : "ai" });

  // Assistant output is validated with the shared flight-search schema before a
  // request object exists at all.
  const validation = useMemo(
    () => toValidatedSearchRequest(assistant.requirements),
    [assistant.requirements],
  );

  // Same query options the flight search page uses — one search system only.
  const query = useQuery(flightSearchQueryOptions(request));

  const results = query.data?.results ?? [];
  const preferred = useMemo(
    () => applyPreferenceFilters(results, assistant.requirements),
    [results, assistant.requirements],
  );
  const recommendations = useMemo(
    () => buildRecommendations(preferred, assistant.requirements),
    [preferred, assistant.requirements],
  );

  useTrackOnce(ANALYTICS_EVENTS.assistantRecommendationsShown, recommendations.length > 0, {
    recommendationCount: recommendations.length,
    resultCount: results.length,
  });

  const runSearch = () => {
    if (!validation.ok || !validation.request) return;
    setRequest(validation.request);
    track(ANALYTICS_EVENTS.assistantSearchStarted, {
      tripType: validation.request.tripType,
      cabinClass: validation.request.cabinClass,
      nonStopOnly: assistant.requirements.nonStopOnly ?? false,
    });
  };

  // Identical to the flight results page: only the search id and the opaque
  // fare handle are sent — never a price, and never anything AI-generated.
  const select = useMutation({
    mutationFn: (result: FlightResult) =>
      bookingApi.selectFlight({
        searchId: query.data?.searchId as string,
        fareId: result.fare?.fareId ?? result.id,
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: (review) => {
      rememberGuestToken(review.reviewToken, review.guestToken);
      track(ANALYTICS_EVENTS.assistantFlightSelected);
      track(ANALYTICS_EVENTS.flightSelected);
      track(ANALYTICS_EVENTS.assistantHandoffToBooking, { step: "review" });
      navigate({ to: "/flights/review", search: { token: review.reviewToken } });
    },
    onSettled: () => setSelectingId(null),
  });

  const handleSelect = (result: FlightResult) => {
    if (!query.data?.searchId || select.isPending) return;
    setSelectingId(result.id);
    select.mutate(result);
  };

  const searchError = query.isError ? toBookingError(query.error) : null;
  const selectError = select.isError ? toBookingError(select.error) : null;

  return (
    <main className="min-h-screen bg-background">
      <Nav />

      <section className="px-4 pb-20 pt-32 md:pt-40">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Travel assistant</p>
          <h1 className="mt-3 max-w-2xl font-display text-4xl leading-tight md:text-5xl">
            Describe your trip. We'll build the search.
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
            Tell the assistant where you're going in your own words. It confirms what it understood,
            then runs a real flight search — every fare, timing and baggage rule shown comes from the
            search results, not from the assistant.
          </p>

          {assistant.isDemo && (
            <Alert className="mt-6">
              <Info className="size-4" />
              <AlertTitle>Demo mode</AlertTitle>
              <AlertDescription>
                The assistant is running in demo mode: it understands common phrasing using built-in
                rules and prepares a genuine flight search. Live flight results appear once the
                booking service is connected.
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="h-[560px] lg:h-[640px]">
              <AssistantChat
                messages={assistant.messages}
                pending={assistant.pending}
                error={assistant.error}
                suggestions={assistant.suggestions}
                suggestedPrompts={SUGGESTED_PROMPTS}
                isDemo={assistant.isDemo}
                onSend={assistant.send}
                onRetry={assistant.retry}
                onReset={assistant.reset}
              />
            </div>

            <div className="space-y-6">
              <TravelSummaryCard
                requirements={assistant.requirements}
                missing={assistant.missing}
                issues={assistant.missing.length === 0 ? validation.issues : []}
                canSearch={validation.ok}
                searching={query.isFetching}
                onSearch={runSearch}
              />
            </div>
          </div>

          {/* ---- results from the existing flight-search boundary ---- */}
          {request && (
            <div className="mt-12 space-y-6">
              <h2 className="font-display text-2xl">Flight results</h2>

              {selectError && (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Couldn't continue with that fare</AlertTitle>
                  <AlertDescription>{selectError.message}</AlertDescription>
                </Alert>
              )}

              {searchError && (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Flight search unavailable</AlertTitle>
                  <AlertDescription>{searchError.message}</AlertDescription>
                </Alert>
              )}

              {query.isFetching && <FlightResultsSkeleton />}

              {!query.isFetching && !searchError && results.length === 0 && query.isSuccess && (
                <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
                  <p className="font-display text-2xl">No flights returned for this search</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Ask the assistant to try different dates, a nearby airport, or a different cabin.
                  </p>
                </div>
              )}

              {!query.isFetching && preferred.length > 0 && (
                <>
                  <RecommendationList
                    recommendations={recommendations}
                    results={preferred}
                    selectingId={selectingId}
                    disabled={select.isPending}
                    onSelect={handleSelect}
                  />

                  <div className="space-y-4">
                    {preferred.map((result) => (
                      <FlightResultCard
                        key={result.id}
                        result={result}
                        onSelect={query.data?.searchId ? handleSelect : undefined}
                        selecting={selectingId === result.id}
                        disabled={select.isPending}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}
