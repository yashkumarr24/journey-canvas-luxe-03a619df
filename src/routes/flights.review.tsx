import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Clock, Luggage, ShieldCheck } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SectionTitle } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { TravellerForm } from "@/components/booking/TravellerForm";
import { bookingApi, toBookingError } from "@/lib/booking-api";
import { useAnalytics, useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { newIdempotencyKey, readGuestToken } from "@/lib/review-session";
import { rememberBookingGuestToken, saveCheckoutSnapshot } from "@/lib/checkout-session";
import { formatDuration, formatMoney, formatTime } from "@/lib/flight-search";
import type {
  ContactInput,
  FlightItinerary,
  TravellerDetailsResponse,
  TravellerInput,
} from "@/types/booking";

/**
 * Fare review + traveller details.
 *
 * The page renders ONLY what the server returned for this review session: the
 * price shown here is the server's re-priced amount, and the form posts no
 * amount back. `?token=` is an opaque review handle; the guest secret that
 * authorises it lives in sessionStorage, never in the URL.
 */

type Search = { token?: string };

export const Route = createFileRoute("/flights/review")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    token: typeof search.token === "string" ? search.token.slice(0, 128) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Review Your Flight — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Confirm your selected fare, add traveller details and check the final total before payment with Fly n Feel Holidays.",
      },
      { property: "og:title", content: "Review Your Flight — Fly n Feel Holidays" },
      {
        property: "og:description",
        content: "Confirm your fare and traveller details before payment.",
      },
      { property: "og:type", content: "website" },
      // A private booking step should never be indexed or previewed.
      { name: "robots", content: "noindex, nofollow" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReviewPage,
});

function Leg({ itinerary }: { itinerary: FlightItinerary }) {
  const first = itinerary.segments[0];
  const last = itinerary.segments[itinerary.segments.length - 1];
  const airlines = [
    ...new Set(itinerary.segments.map((s) => s.airline?.name ?? s.airline?.code).filter(Boolean)),
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-foreground/10 py-5 last:border-b-0">
      <div className="min-w-40">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {itinerary.direction === "inbound" ? "Return" : "Outbound"}
        </p>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {airlines.join(", ") || "Airline not available"}
          {first?.flightNumber ? ` · ${first.flightNumber}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div>
          <p className="font-display text-2xl leading-none">{formatTime(first?.departureAt)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{first?.origin?.code ?? "—"}</p>
        </div>
        <div className="flex min-w-24 flex-col items-center">
          <span className="text-xs text-muted-foreground">{formatDuration(itinerary.durationMinutes)}</span>
          <span className="my-1 block h-px w-full bg-foreground/15" />
          <span className="text-xs text-muted-foreground">
            {itinerary.stops === 0 ? "Non-stop" : `${itinerary.stops ?? itinerary.segments.length - 1} stop(s)`}
          </span>
        </div>
        <div>
          <p className="font-display text-2xl leading-none">{formatTime(last?.arrivalAt)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{last?.destination?.code ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}

function ReviewPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<TravellerDetailsResponse | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const guestToken = useMemo(() => (token ? readGuestToken(token) : null), [token]);

  const review = useQuery({
    queryKey: ["flight-review", token],
    enabled: Boolean(token),
    // A review session is server-authoritative and short-lived; never serve it
    // from a stale cache after the customer comes back to the tab.
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => bookingApi.getReview(token as string, guestToken, { signal }),
  });

  const { track } = useAnalytics();
  useTrackOnce(ANALYTICS_EVENTS.flightReviewStarted, Boolean(review.data));
  useTrackOnce(ANALYTICS_EVENTS.travellerDetailsStarted, Boolean(review.data));

  const submit = useMutation({
    mutationFn: async (values: {
      travellers: TravellerInput[];
      contact: ContactInput;
      acceptPriceChange: boolean;
    }) => {
      const result = await bookingApi.submitTravellers({
        reviewToken: token as string,
        guestToken: guestToken ?? undefined,
        travellers: values.travellers,
        contact: values.contact,
        acceptPriceChange: values.acceptPriceChange,
        idempotencyKey,
      });
      return { result, values };
    },
    onSuccess: ({ result, values }) => {
      setDraft(result);
      track(ANALYTICS_EVENTS.travellerDetailsCompleted, {
        travellerCount: values.travellers.length,
      });
      // Carry the reviewed journey forward so checkout can render it, and keep
      // the guest secret with the booking reference (never in the URL).
      rememberBookingGuestToken(result.bookingReference, guestToken);
      if (review.data) {
        saveCheckoutSnapshot({
          bookingReference: result.bookingReference,
          itineraries: review.data.itineraries,
          fare: review.data.fare,
          passengers: review.data.passengers,
          travellers: values.travellers,
          contact: values.contact,
          priceChange: review.data.priceChange,
          expiresAt: result.expiresAt,
        });
      }
      navigate({ to: "/flights/checkout", search: { ref: result.bookingReference } });
    },
  });

  if (!token) {
    return (
      <Shell>
        <Alert role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>No flight selected</AlertTitle>
          <AlertDescription>
            Start a new search to pick a fare.{" "}
            <Link to="/flights" className="underline">
              Search flights
            </Link>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (review.isPending) {
    return (
      <Shell>
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-3xl" />
          <Skeleton className="h-64 w-full rounded-3xl" />
        </div>
      </Shell>
    );
  }

  if (review.isError) {
    const error = toBookingError(review.error);
    return (
      <Shell>
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>We couldn't load this fare</AlertTitle>
          <AlertDescription>
            {error.message}{" "}
            <Link to="/flights" className="underline">
              Search again
            </Link>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const data = review.data;
  const price = data.fare.totalPrice;
  const submitError = submit.isError ? toBookingError(submit.error) : null;

  if (draft) {
    return (
      <Shell>
        <div className="rounded-3xl border border-foreground/10 bg-card p-8 text-center">
          <ShieldCheck className="mx-auto size-8 text-gold" aria-hidden="true" />
          <h2 className="mt-4 font-display text-3xl">Details saved</h2>
          <p className="mt-2 text-muted-foreground">
            Booking reference <span className="font-medium text-foreground">{draft.bookingReference}</span> is
            held as a draft for {draft.travellerCount} traveller
            {draft.travellerCount > 1 ? "s" : ""}. We've sent a copy to {draft.contactEmail}.
          </p>
          <p className="mt-4 font-display text-4xl">
            {formatMoney(draft.totalPrice.amount, draft.totalPrice.currency)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            No payment has been taken and no seat is ticketed yet — secure payment is the next step.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button variant="outline" onClick={() => navigate({ to: "/flights" })}>
              Back to search
            </Button>
            <Button asChild>
              <Link to="/flights/checkout" search={{ ref: draft.bookingReference }}>
                Continue to payment
              </Link>
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {data.priceChange?.direction === "increase" && (
        <Alert className="mb-6" role="status">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>The airline re-priced this fare</AlertTitle>
          <AlertDescription>
            The total is now {formatMoney(data.priceChange.current.amount, data.priceChange.current.currency)} —{" "}
            {formatMoney(data.priceChange.difference.amount, data.priceChange.difference.currency)} more than the
            search result.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <section className="rounded-3xl border border-foreground/10 bg-card px-5 sm:px-6">
            {data.itineraries.map((itinerary, index) => (
              <Leg key={`${itinerary.direction}-${index}`} itinerary={itinerary} />
            ))}
          </section>

          <h2 className="mt-10 font-display text-2xl">Traveller details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Names must match the photo ID each traveller will carry.
          </p>

          {submitError && (
            <Alert variant="destructive" className="mt-4" role="alert">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertDescription>{submitError.message}</AlertDescription>
            </Alert>
          )}

          <div className="mt-6">
            <TravellerForm
              passengers={data.passengers}
              requirements={data.requirements}
              submitting={submit.isPending}
              priceChangeNotice={
                data.priceChange?.direction === "increase"
                  ? `I accept the updated total of ${formatMoney(price.amount, price.currency)}.`
                  : undefined
              }
              onSubmit={(values) => submit.mutate(values)}
            />
          </div>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border border-foreground/10 bg-card p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Fare summary</p>
            <p className="mt-3 font-display text-4xl leading-none">
              {formatMoney(price.amount, price.currency)}
            </p>

            <dl className="mt-5 space-y-2 text-sm">
              {data.fare.basePrice && (
                <Row label="Base fare" value={formatMoney(data.fare.basePrice.amount, price.currency)} />
              )}
              {data.fare.taxes && (
                <Row label="Taxes & fees" value={formatMoney(data.fare.taxes.amount, price.currency)} />
              )}
              <Row
                label="Travellers"
                value={`${data.passengers.adults} adult${data.passengers.adults > 1 ? "s" : ""}${
                  data.passengers.children ? `, ${data.passengers.children} child` : ""
                }${data.passengers.infants ? `, ${data.passengers.infants} infant` : ""}`}
              />
            </dl>

            <ul className="mt-5 space-y-2 text-xs text-muted-foreground">
              {data.fare.baggageCheckIn && (
                <li className="flex items-center gap-2">
                  <Luggage className="size-3.5" aria-hidden="true" /> Check-in {data.fare.baggageCheckIn}
                </li>
              )}
              {data.fare.baggageCabin && (
                <li className="flex items-center gap-2">
                  <Luggage className="size-3.5" aria-hidden="true" /> Cabin {data.fare.baggageCabin}
                </li>
              )}
              <li className="flex items-center gap-2">
                <Clock className="size-3.5" aria-hidden="true" />
                {data.validForSeconds > 0
                  ? `Price held for about ${Math.max(1, Math.round(data.validForSeconds / 60))} min`
                  : "This quote has expired"}
              </li>
              {data.fare.seatsAvailable !== undefined && (
                <li className="flex items-center gap-2">
                  <ArrowRight className="size-3.5" aria-hidden="true" /> {data.fare.seatsAvailable} seats left at
                  this fare
                </li>
              )}
            </ul>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-svh bg-background text-foreground">
      <Nav />
      <section className="mx-auto max-w-7xl px-6 pb-20 pt-36 sm:pt-40 lg:pt-44">
        <SectionTitle
          eyebrow="Review"
          title={
            <>
              Confirm your fare, <span className="italic gold-gradient">then the details.</span>
            </>
          }
          subtitle="We re-check the price and seats with the airline before anything is booked."
        />
        <div className="mt-10">{children}</div>
      </section>
      <Footer />
    </main>
  );
}
