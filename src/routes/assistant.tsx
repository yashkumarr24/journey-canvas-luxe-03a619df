import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, BedDouble, ChevronLeft, ChevronRight, Info, Plane } from "lucide-react";
import { Nav } from "@/components/Nav";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { AssistantFlightCard, AssistantHotelCard, ResultLoading } from "@/components/assistant/AssistantResultCards";
import { TravelSummaryCard } from "@/components/assistant/TravelSummaryCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SUGGESTED_PROMPTS, useAssistant } from "@/lib/assistant/use-assistant";
import { toValidatedHotelSearchRequest, toValidatedSearchRequest, wantsHotels } from "@/lib/assistant/requirements";
import { applyPreferenceFilters, buildRecommendations } from "@/lib/assistant/recommendations";
import { flightSearchQueryOptions } from "@/lib/flight-search";
import { hotelSearchQueryOptions } from "@/lib/hotel-search";
import { bookingApi, toBookingError } from "@/lib/booking-api";
import { newIdempotencyKey, rememberGuestToken } from "@/lib/review-session";
import { useAnalytics, useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { FlightResult, FlightSearchRequest, HotelResult, HotelSearchRequest } from "@/types/booking";

export const Route = createFileRoute("/assistant")({
  head: () => ({ meta: [
    { title: "AI Flight & Hotel Search | Fly n Feel Holidays" },
    { name: "description", content: "Describe one trip and search available flights and hotels through Fly n Feel Holidays." },
    { property: "og:title", content: "AI Flight & Hotel Search | Fly n Feel Holidays" },
    { property: "og:description", content: "Turn natural travel plans into validated flight and hotel searches." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AssistantPage,
});

function AssistantPage() {
  const assistant = useAssistant();
  const { track } = useAnalytics();
  const navigate = useNavigate();
  const chatInputAnchor = useRef<HTMLDivElement | null>(null);
  const [flightRequest, setFlightRequest] = useState<FlightSearchRequest | null>(null);
  const [hotelRequest, setHotelRequest] = useState<HotelSearchRequest | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [panelCompact, setPanelCompact] = useState(false);

  useTrackOnce(ANALYTICS_EVENTS.assistantOpened, true, { mode: assistant.isDemo ? "demo" : "ai" });
  const flightValidation = useMemo(() => toValidatedSearchRequest(assistant.requirements), [assistant.requirements]);
  const hotelValidation = useMemo(() => toValidatedHotelSearchRequest(assistant.requirements), [assistant.requirements]);
  const needsHotel = wantsHotels(assistant.requirements);
  const canSearch = flightValidation.ok && (!needsHotel || hotelValidation.ok);
  const flightQuery = useQuery(flightSearchQueryOptions(flightRequest));
  const hotelQuery = useQuery(hotelSearchQueryOptions(hotelRequest));
  const flightResults = flightQuery.data?.results ?? [];
  const hotelResults = hotelQuery.data?.results ?? [];
  let preferredFlights = useMemo(() => applyPreferenceFilters(flightResults, assistant.requirements), [flightResults, assistant.requirements]);
  if (assistant.requirements.resultSort === "cheapest") preferredFlights = [...preferredFlights].sort((a, b) => a.fare.totalPrice.amount - b.fare.totalPrice.amount);
  const recommendations = useMemo(() => buildRecommendations(preferredFlights, assistant.requirements), [preferredFlights, assistant.requirements]);
  const visibleHotels = useMemo(() => {
    const area = assistant.requirements.hotelLocationPreference?.toLowerCase();
    const filtered = area ? hotelResults.filter((hotel) => [hotel.location?.area, hotel.location?.landmark, hotel.location?.city].some((value) => value?.toLowerCase().includes(area))) : hotelResults;
    return assistant.requirements.resultSort === "cheapest" ? [...filtered].sort((a, b) => (a.rate?.totalPrice.amount ?? Infinity) - (b.rate?.totalPrice.amount ?? Infinity)) : filtered;
  }, [hotelResults, assistant.requirements.hotelLocationPreference, assistant.requirements.resultSort]);

  useTrackOnce(ANALYTICS_EVENTS.assistantRecommendationsShown, recommendations.length > 0, { recommendationCount: recommendations.length, resultCount: flightResults.length });
  useTrackOnce(ANALYTICS_EVENTS.assistantFlightResultsShown, flightResults.length > 0, { resultCount: flightResults.length });
  useTrackOnce(ANALYTICS_EVENTS.assistantHotelResultsShown, hotelResults.length > 0, { resultCount: hotelResults.length });

  const runSearch = () => {
    if (!flightValidation.ok || !flightValidation.request) return;
    setFlightRequest(flightValidation.request);
    setHotelRequest(needsHotel && hotelValidation.ok && hotelValidation.request ? hotelValidation.request : null);
    track(ANALYTICS_EVENTS.assistantSearchStarted, { tripType: flightValidation.request.tripType, cabinClass: flightValidation.request.cabinClass, nonStopOnly: assistant.requirements.nonStopOnly ?? false });
    if (needsHotel && hotelValidation.request) track(ANALYTICS_EVENTS.assistantHotelSearchStarted, { nights: assistant.requirements.durationNights ?? 0 });
  };

  const selectFlight = useMutation({
    mutationFn: (result: FlightResult) => bookingApi.selectFlight({ searchId: flightQuery.data?.searchId as string, fareId: result.fare?.fareId ?? result.id, idempotencyKey: newIdempotencyKey() }),
    onSuccess: (review) => { rememberGuestToken(review.reviewToken, review.guestToken); track(ANALYTICS_EVENTS.assistantFlightSelected); track(ANALYTICS_EVENTS.flightSelected); track(ANALYTICS_EVENTS.assistantHandoffToBooking, { step: "flight_review" }); navigate({ to: "/flights/review", search: { token: review.reviewToken } }); },
    onSettled: () => setSelectingId(null),
  });
  const handleFlightSelect = (result: FlightResult) => { if (!flightQuery.data?.searchId || selectFlight.isPending) return; setSelectingId(result.id); selectFlight.mutate(result); };
  const handleHotelSelect = (hotel: HotelResult) => { if (!hotelQuery.data?.searchId) return; track(ANALYTICS_EVENTS.assistantHotelSelected); track(ANALYTICS_EVENTS.assistantHandoffToBooking, { step: "hotel_detail" }); navigate({ to: "/hotels/detail", search: { searchId: hotelQuery.data.searchId, hotelId: hotel.id } }); };

  useEffect(() => { if (assistant.pending) setPanelCompact(false); }, [assistant.pending]);
  const hasSearch = Boolean(flightRequest);
  const searching = flightQuery.isFetching || hotelQuery.isFetching;
  const issues = assistant.missing.length === 0 ? [...flightValidation.issues, ...(needsHotel ? hotelValidation.issues : [])] : [];
  const selectError = selectFlight.isError ? toBookingError(selectFlight.error) : null;

  return (
    <main className="min-h-screen bg-muted/40">
      <Nav />
      <div className="mx-auto flex min-h-screen max-w-[1600px] pt-20 lg:h-screen lg:overflow-hidden">
        <aside className={`${panelCompact ? "lg:w-20" : "lg:w-[390px] xl:w-[430px]"} relative flex min-h-[calc(100vh-5rem)] w-full shrink-0 flex-col border-r border-border bg-background transition-[width] duration-300 lg:min-h-0`}>
          <div ref={chatInputAnchor} className={panelCompact ? "hidden lg:block lg:flex-1" : "min-h-0 flex-1"}>{panelCompact ? <div className="flex h-full flex-col items-center gap-4 py-6"><Plane className="size-5 text-primary" /><span className="[writing-mode:vertical-rl] text-xs uppercase tracking-[0.18em] text-muted-foreground">Trip finder</span></div> : <AssistantChat messages={assistant.messages} pending={assistant.pending} error={assistant.error} suggestions={assistant.suggestions} suggestedPrompts={SUGGESTED_PROMPTS} isDemo={assistant.isDemo} onSend={assistant.send} onRetry={assistant.retry} onReset={() => { assistant.reset(); setFlightRequest(null); setHotelRequest(null); }} />}</div>
          <Button variant="outline" size="icon-sm" onClick={() => setPanelCompact((value) => !value)} className="absolute -right-4 top-5 z-10 hidden rounded-full bg-background lg:inline-flex" title={panelCompact ? "Expand assistant" : "Collapse assistant"}>{panelCompact ? <ChevronRight /> : <ChevronLeft />}</Button>
        </aside>

        <section className={`${panelCompact ? "lg:pl-12" : ""} hidden min-w-0 flex-1 overflow-y-auto px-5 py-7 transition-[padding] sm:px-8 lg:block lg:px-10`}>
          <div className="mx-auto max-w-5xl">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">AI travel search</p><h1 className="mt-2 font-display text-4xl">Your Trip</h1><p className="mt-2 text-sm text-muted-foreground">One request, actual flight and hotel results, existing secure booking flow.</p></div>{assistant.isDemo ? <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">Demo mode</span> : null}</div>
            <div className="mt-6"><TravelSummaryCard requirements={assistant.requirements} missing={assistant.missing} issues={issues} canSearch={canSearch} searching={searching} onSearch={runSearch} onChange={() => { setPanelCompact(false); chatInputAnchor.current?.scrollIntoView({ behavior: "smooth" }); }} /></div>
            {!hasSearch ? <div className="mt-8 grid min-h-72 place-items-center rounded-lg border border-dashed border-border bg-background/70 p-8 text-center"><div><div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><Plane /></div><h2 className="mt-4 font-display text-2xl">Ready when your trip is</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Once the route and dates are understood, available flights and stays appear here.</p></div></div> : <Results />}
          </div>
        </section>

        <section className="w-full px-4 py-5 lg:hidden">
          <div className="space-y-5"><TravelSummaryCard requirements={assistant.requirements} missing={assistant.missing} issues={issues} canSearch={canSearch} searching={searching} onSearch={runSearch} onChange={() => chatInputAnchor.current?.scrollIntoView({ behavior: "smooth" })} />{hasSearch ? <Results /> : null}</div>
        </section>
      </div>
    </main>
  );

  function Results() {
    return <div className="mt-8 space-y-10">
      {selectError ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Couldn’t continue with that fare</AlertTitle><AlertDescription>{selectError.message}</AlertDescription></Alert> : null}
      <section><div className="mb-4 flex items-center gap-2"><Plane className="size-5 text-primary" /><h2 className="font-display text-2xl">Flights</h2>{flightQuery.isSuccess ? <span className="text-xs text-muted-foreground">{preferredFlights.length} available</span> : null}</div>{flightQuery.isFetching ? <ResultLoading>Finding the best available flights…</ResultLoading> : flightQuery.isError ? <SearchError title="Flight search unavailable" error={flightQuery.error} /> : preferredFlights.length ? <div className="space-y-4">{preferredFlights.slice(0, 8).map((result) => <AssistantFlightCard key={result.id} result={result} recommendations={recommendations} selecting={selectingId === result.id} disabled={selectFlight.isPending} onSelect={handleFlightSelect} />)}</div> : flightQuery.isSuccess ? <Empty text="No flights matched this trip. Ask to change dates, timing, or stops." /> : null}</section>
      {needsHotel ? <section><div className="mb-4 flex items-center gap-2"><BedDouble className="size-5 text-primary" /><h2 className="font-display text-2xl">Hotels</h2>{hotelQuery.isSuccess ? <span className="text-xs text-muted-foreground">{visibleHotels.length} available</span> : null}</div>{hotelQuery.isFetching ? <ResultLoading>Finding stays in {assistant.requirements.destinationLabel ?? "your destination"}…</ResultLoading> : hotelQuery.isError ? <SearchError title="Hotel search unavailable" error={hotelQuery.error} /> : visibleHotels.length ? <div className="space-y-4">{visibleHotels.slice(0, 8).map((hotel) => <AssistantHotelCard key={hotel.id} hotel={hotel} nights={hotelQuery.data?.nights ?? assistant.requirements.durationNights ?? 0} onSelect={handleHotelSelect} />)}</div> : hotelQuery.isSuccess ? <Empty text="No stays matched this trip. Ask to change the area or dates." /> : null}</section> : null}
      <Alert><Info /><AlertTitle>Result integrity</AlertTitle><AlertDescription>Prices, availability, schedules, property details, and images shown here come only from the existing search result data.</AlertDescription></Alert>
    </div>;
  }
}

function Empty({ text }: { text: string }) { return <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{text}</div>; }
function SearchError({ title, error }: { title: string; error: unknown }) { const normalized = toBookingError(error); return <Alert variant="destructive"><AlertCircle /><AlertTitle>{title}</AlertTitle><AlertDescription>{normalized.message}</AlertDescription></Alert>; }