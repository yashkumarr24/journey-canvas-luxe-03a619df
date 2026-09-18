import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock, ShieldCheck } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SectionTitle } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { FareBreakdown } from "@/components/booking/FareBreakdown";
import { HotelStaySummary } from "@/components/booking/HotelStaySummary";
import { HotelGuestForm } from "@/components/booking/HotelGuestForm";
import { hotelApi, isHotelSessionExpired } from "@/lib/hotel-api";
import {
  readHotelGuestToken,
  rememberHotelBookingGuestToken,
  saveHotelSnapshot,
} from "@/lib/hotel-session";
import { newIdempotencyKey } from "@/lib/review-session";
import { occupancyLabel } from "@/lib/hotel-search";
import { toBookingError } from "@/lib/booking-api";
import { useAnalytics, useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { HotelContactInput, HotelGuestInput } from "@/types/booking";

/**
 * Hotel review + guest details.
 *
 * The total shown is the server's re-priced amount for this review session. The
 * form posts guest details and, if the price moved, a consent flag — never an
 * amount. `?token=` is opaque; the guest secret lives in sessionStorage.
 */

type Search = { token?: string };

export const Route = createFileRoute("/hotels/review")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    token: typeof search.token === "string" ? search.token.slice(0, 128) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Review Your Stay — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Confirm your room, meal plan, cancellation policy and final total, then add guest details before payment.",
      },
      { property: "og:title", content: "Review Your Stay — Fly n Feel Holidays" },
      { property: "og:description", content: "Confirm your room and guest details before payment." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HotelReviewPage,
});

function HotelReviewPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [idempotencyKey] = useState(newIdempotencyKey);

  const guestToken = useMemo(() => (token ? readHotelGuestToken(token) : null), [token]);

  const review = useQuery({
    queryKey: ["hotel-review", token],
    enabled: Boolean(token),
    // Short-lived and server-authoritative: never serve it from a stale cache.
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => hotelApi.getReview(token as string, guestToken, { signal }),
  });

  const { track } = useAnalytics();
  useTrackOnce(ANALYTICS_EVENTS.hotelReviewStarted, Boolean(review.data));
  useTrackOnce(ANALYTICS_EVENTS.hotelGuestDetailsStarted, Boolean(review.data));

  const submit = useMutation({
    mutationFn: (values: {
      guests: HotelGuestInput[];
      contact: HotelContactInput;
      specialRequests?: string;
      acceptPriceChange: boolean;
    }) =>
      hotelApi
        .submitGuests({
          reviewToken: token as string,
          guestToken: guestToken ?? undefined,
          guests: values.guests,
          contact: values.contact,
          specialRequests: values.specialRequests,
          acceptPriceChange: values.acceptPriceChange,
          idempotencyKey,
        })
        .then((result) => ({ result, values })),
    onSuccess: ({ result, values }) => {
      rememberHotelBookingGuestToken(result.bookingReference, guestToken);
      track(ANALYTICS_EVENTS.hotelGuestDetailsCompleted, { guestCount: values.guests.length });
      if (review.data) {
        // Presentation-only carry-forward; the payable amount still comes from
        // the server on the checkout page.
        saveHotelSnapshot({
          bookingReference: result.bookingReference,
          hotel: review.data.hotel,
          room: review.data.room,
          stay: review.data.stay,
          breakdown: review.data.breakdown,
          totalPayable: review.data.totalPayable,
          guests: values.guests,
          contact: values.contact,
          specialRequests: values.specialRequests,
          priceChange: review.data.priceChange,
          expiresAt: result.expiresAt,
        });
      }
      navigate({ to: "/hotels/checkout", search: { ref: result.bookingReference } });
    },
  });

  if (!token) {
    return (
      <Shell>
        <EmptyState
          title="No room selected"
          body="Search for a stay and pick a room to see the final total."
        />
      </Shell>
    );
  }

  if (review.isPending) {
    return (
      <Shell>
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Skeleton className="h-52 w-full rounded-3xl" />
            <Skeleton className="h-72 w-full rounded-3xl" />
          </div>
          <Skeleton className="h-80 w-full rounded-3xl" />
        </div>
      </Shell>
    );
  }

  if (review.isError || !review.data) {
    const error = toBookingError(review.error);
    const expired = isHotelSessionExpired(review.error);
    return (
      <Shell>
        <Alert variant={expired ? "default" : "destructive"} role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>{expired ? "This room is no longer held" : "We couldn't open this room"}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error.message}</p>
            <div className="flex flex-wrap gap-3">
              {!expired && (
                <Button type="button" variant="outline" size="sm" onClick={() => review.refetch()}>
                  Try again
                </Button>
              )}
              <Button asChild size="sm">
                <Link to="/hotels">Search hotels</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const data = review.data;
  const submitError = submit.isError ? toBookingError(submit.error) : null;

  return (
    <Shell>
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-8">
          <section className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
            <HotelStaySummary hotel={data.hotel} room={data.room} stay={data.stay} />
          </section>

          <HotelGuestForm
            stay={data.stay}
            requirements={data.requirements}
            priceChange={data.priceChange}
            submitting={submit.isPending}
            errorMessage={submitError?.message ?? null}
            onSubmit={(values) => submit.mutate(values)}
          />
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border border-foreground/10 bg-card p-6">
            <FareBreakdown
              breakdown={data.breakdown}
              totalPayable={data.totalPayable}
              title="Price for your stay"
              occupancy={{ label: "Rooms & guests", value: occupancyLabel(data.stay.rooms) }}
              footnote="You'll pay on the next step"
            />

            <p className="mt-5 flex items-start gap-2 text-xs text-muted-foreground">
              <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              This price is held until {new Date(data.expiresAt).toLocaleString("en-IN")}. After that we'll
              re-check it with the hotel.
            </p>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {data.room.cancellation?.summary ??
                (data.room.cancellation?.refundable ? "Free cancellation applies." : "Non-refundable rate.")}
            </p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
      <p className="font-display text-2xl">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <Button asChild className="mt-6">
        <Link to="/hotels">Search hotels</Link>
      </Button>
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
              Your room, <span className="italic gold-gradient">confirmed by the hotel.</span>
            </>
          }
          subtitle="We've just re-checked the rate and availability. Add the guest details and you're one step from booked."
        />
        <div className="mt-10">{children}</div>
      </section>
      <Footer />
    </main>
  );
}
