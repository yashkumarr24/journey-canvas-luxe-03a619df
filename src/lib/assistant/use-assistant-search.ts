import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAnalytics, useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { bookingApi, toBookingError } from "@/lib/booking-api";
import { flightSearchQueryOptions } from "@/lib/flight-search";
import { hotelSearchQueryOptions } from "@/lib/hotel-search";
import { newIdempotencyKey, rememberGuestToken } from "@/lib/review-session";
import type {
  FlightResult,
  FlightSearchRequest,
  HotelResult,
  HotelSearchRequest,
} from "@/types/booking";
import { applyPreferenceFilters, buildRecommendations } from "./recommendations";
import {
  toValidatedHotelSearchRequest,
  toValidatedSearchRequest,
  wantsHotels,
} from "./requirements";
import { useAssistant } from "./use-assistant";

export function useAssistantSearch({ active = true }: { active?: boolean } = {}) {
  const assistant = useAssistant();
  const navigate = useNavigate();
  const { track } = useAnalytics();
  const [flightRequest, setFlightRequest] = useState<FlightSearchRequest | null>(null);
  const [hotelRequest, setHotelRequest] = useState<HotelSearchRequest | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const flightValidation = useMemo(
    () => toValidatedSearchRequest(assistant.requirements),
    [assistant.requirements],
  );
  const hotelValidation = useMemo(
    () => toValidatedHotelSearchRequest(assistant.requirements),
    [assistant.requirements],
  );
  const needsHotel = wantsHotels(assistant.requirements);
  const canSearch =
    assistant.guidedStep === null && flightValidation.ok && (!needsHotel || hotelValidation.ok);

  const flightQuery = useQuery(flightSearchQueryOptions(flightRequest));
  const hotelQuery = useQuery(hotelSearchQueryOptions(hotelRequest));
  const flightResults = flightQuery.data?.results ?? [];
  const hotelResults = hotelQuery.data?.results ?? [];

  let preferredFlights = useMemo(
    () => applyPreferenceFilters(flightResults, assistant.requirements),
    [flightResults, assistant.requirements],
  );
  if (assistant.requirements.resultSort === "cheapest") {
    preferredFlights = [...preferredFlights].sort(
      (a, b) => a.fare.totalPrice.amount - b.fare.totalPrice.amount,
    );
  }
  const recommendations = useMemo(
    () => buildRecommendations(preferredFlights, assistant.requirements),
    [preferredFlights, assistant.requirements],
  );
  const visibleHotels = useMemo(() => {
    const area = assistant.requirements.hotelLocationPreference?.toLowerCase();
    const filtered = area
      ? hotelResults.filter((hotel) =>
          [hotel.location?.area, hotel.location?.landmark, hotel.location?.city].some((value) =>
            value?.toLowerCase().includes(area),
          ),
        )
      : hotelResults;
    return assistant.requirements.resultSort === "cheapest"
      ? [...filtered].sort(
          (a, b) =>
            (a.rate?.totalPrice.amount ?? Infinity) - (b.rate?.totalPrice.amount ?? Infinity),
        )
      : filtered;
  }, [
    hotelResults,
    assistant.requirements.hotelLocationPreference,
    assistant.requirements.resultSort,
  ]);

  useTrackOnce(
    ANALYTICS_EVENTS.assistantRecommendationsShown,
    active && recommendations.length > 0,
    {
      recommendationCount: recommendations.length,
      resultCount: flightResults.length,
    },
  );
  useTrackOnce(ANALYTICS_EVENTS.assistantFlightResultsShown, active && flightResults.length > 0, {
    resultCount: flightResults.length,
  });
  useTrackOnce(ANALYTICS_EVENTS.assistantHotelResultsShown, active && hotelResults.length > 0, {
    resultCount: hotelResults.length,
  });

  const runSearch = useCallback(() => {
    if (!active || !canSearch || !flightValidation.ok || !flightValidation.request) return;
    setFlightRequest(flightValidation.request);
    setHotelRequest(
      needsHotel && hotelValidation.ok && hotelValidation.request ? hotelValidation.request : null,
    );
    track(ANALYTICS_EVENTS.assistantSearchStarted, {
      tripType: flightValidation.request.tripType,
      cabinClass: flightValidation.request.cabinClass,
      nonStopOnly: assistant.requirements.nonStopOnly ?? false,
    });
    if (needsHotel && hotelValidation.request) {
      track(ANALYTICS_EVENTS.assistantHotelSearchStarted, {
        nights: assistant.requirements.durationNights ?? 0,
      });
    }
  }, [
    active,
    assistant.requirements,
    canSearch,
    flightValidation,
    hotelValidation,
    needsHotel,
    track,
  ]);

  const searchKey = canSearch
    ? JSON.stringify([flightValidation.request, needsHotel ? hotelValidation.request : null])
    : null;
  const lastSearchKey = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !searchKey || searchKey === lastSearchKey.current) return;
    lastSearchKey.current = searchKey;
    runSearch();
  }, [active, runSearch, searchKey]);

  const selectFlight = useMutation({
    mutationFn: (result: FlightResult) =>
      bookingApi.selectFlight({
        searchId: flightQuery.data?.searchId as string,
        fareId: result.fare?.fareId ?? result.id,
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: (review) => {
      rememberGuestToken(review.reviewToken, review.guestToken);
      track(ANALYTICS_EVENTS.assistantFlightSelected);
      track(ANALYTICS_EVENTS.flightSelected);
      track(ANALYTICS_EVENTS.assistantHandoffToBooking, { step: "flight_review" });
      navigate({ to: "/flights/review", search: { token: review.reviewToken } });
    },
    onSettled: () => setSelectingId(null),
  });

  const handleFlightSelect = useCallback(
    (result: FlightResult) => {
      if (!flightQuery.data?.searchId || selectFlight.isPending) return;
      setSelectingId(result.id);
      selectFlight.mutate(result);
    },
    [flightQuery.data?.searchId, selectFlight],
  );

  const handleHotelSelect = useCallback(
    (hotel: HotelResult) => {
      if (!hotelQuery.data?.searchId) return;
      track(ANALYTICS_EVENTS.assistantHotelSelected);
      track(ANALYTICS_EVENTS.assistantHandoffToBooking, { step: "hotel_detail" });
      navigate({
        to: "/hotels/detail",
        search: { searchId: hotelQuery.data.searchId, hotelId: hotel.id },
      });
    },
    [hotelQuery.data?.searchId, navigate, track],
  );

  const clearSearch = useCallback(() => {
    setFlightRequest(null);
    setHotelRequest(null);
    setSelectingId(null);
    lastSearchKey.current = null;
  }, []);

  return {
    assistant,
    canSearch,
    issues:
      assistant.missing.length === 0
        ? [...flightValidation.issues, ...(needsHotel ? hotelValidation.issues : [])]
        : [],
    runSearch,
    clearSearch,
    hasSearch: flightRequest !== null,
    searching: flightQuery.isFetching || (hotelRequest !== null && hotelQuery.isFetching),
    flightQuery,
    hotelQuery,
    hotelRequest,
    preferredFlights,
    recommendations,
    visibleHotels,
    selectingId,
    selectFlightPending: selectFlight.isPending,
    selectError: selectFlight.isError ? toBookingError(selectFlight.error) : null,
    handleFlightSelect,
    handleHotelSelect,
  };
}

export type AssistantSearchController = ReturnType<typeof useAssistantSearch>;
