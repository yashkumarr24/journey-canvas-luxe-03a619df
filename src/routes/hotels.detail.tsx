import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, BedDouble, CalendarDays, Check, Clock, MapPin, Moon, ShieldCheck, Utensils } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { HotelGallery } from "@/components/booking/HotelGallery";
import { HotelRoomCard } from "@/components/booking/HotelRoomCard";
import { StarRating } from "@/components/booking/HotelResultCard";
import { hotelApi } from "@/lib/hotel-api";
import { hotelDetailQueryOptions, stayLabel } from "@/lib/hotel-search";
import { readLastResults } from "@/lib/hotel-results-state";
import { rememberHotelGuestToken } from "@/lib/hotel-session";
import { newIdempotencyKey } from "@/lib/review-session";
import { toBookingError } from "@/lib/booking-api";
import { formatMoney } from "@/lib/flight-search";
import { useAnalytics, useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { HotelRoomOption } from "@/types/booking";

/**
 * Hotel detail + room selection.
 *
 * Rooms, prices and policies are requested fresh from the server for this
 * search session — none of it is stored in the frontend. Selecting a room sends
 * back only the opaque rate handle and receives an opaque review token.
 */

type Search = { searchId?: string; hotelId?: string };

export const Route = createFileRoute("/hotels/detail")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    searchId: typeof search.searchId === "string" ? search.searchId.slice(0, 128) : undefined,
    hotelId: typeof search.hotelId === "string" ? search.hotelId.slice(0, 128) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Hotel Details & Rooms — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "See photos, amenities, room options, meal plans and cancellation policies before choosing your room with Fly n Feel Holidays.",
      },
      { property: "og:title", content: "Hotel Details & Rooms — Fly n Feel Holidays" },
      { property: "og:description", content: "Room options, meal plans and cancellation terms for your stay." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HotelDetailPage,
});

function HotelDetailPage() {
  const { searchId, hotelId } = Route.useSearch();
  const navigate = useNavigate();
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const detail = useQuery(hotelDetailQueryOptions(searchId, hotelId));

  const { track } = useAnalytics();
  useTrackOnce(ANALYTICS_EVENTS.hotelViewed, Boolean(detail.data));

  const select = useMutation({
    mutationFn: (room: HotelRoomOption) =>
      hotelApi.review({
        searchId: searchId as string,
        hotelId: hotelId as string,
        rateId: room.id,
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: (review) => {
      // The guest secret stays in sessionStorage; only the token is in the URL.
      rememberHotelGuestToken(review.reviewToken, review.guestToken);
      track(ANALYTICS_EVENTS.hotelRoomSelected);
      navigate({ to: "/hotels/review", search: { token: review.reviewToken } });
    },
    onSettled: () => setSelectingId(null),
  });

  const handleSelect = (room: HotelRoomOption) => {
    if (select.isPending) return;
    setSelectingId(room.id);
    select.mutate(room);
  };

  if (!searchId || !hotelId) {
    return (
      <Shell>
        <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
          <p className="font-display text-2xl">Nothing to show yet</p>
          <p className="mt-2 text-sm text-muted-foreground">Start a search to browse stays for your dates.</p>
          <Button asChild className="mt-6">
            <Link to="/hotels">Search hotels</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  if (detail.isPending) {
    return (
      <Shell>
        <div className="space-y-6">
          <Skeleton className="aspect-[16/9] w-full rounded-3xl" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-40 w-full rounded-3xl" />
        </div>
      </Shell>
    );
  }

  if (detail.isError || !detail.data) {
    const error = toBookingError(detail.error);
    return (
      <Shell>
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>We couldn't open this hotel</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error.message}</p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => detail.refetch()}>
                Try again
              </Button>
              <Button asChild size="sm">
                <Link to="/hotels">Search again</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const data = detail.data;
  const hotel = data.hotel;
  const nights = data.nights ?? 0;
  const selectError = select.isError ? toBookingError(select.error) : null;

  const fromPrice = hotel.rooms.reduce<HotelRoomOption | null>(
    (best, room) => (!best || room.totalPrice.amount < best.totalPrice.amount ? room : best),
    null,
  );
  const location = hotel.location
    ? hotel.location.address ?? [hotel.location.area, hotel.location.city, hotel.location.country].filter(Boolean).join(", ")
    : null;
  const keyAmenities = (hotel.amenities ?? []).slice(0, 8);
  const moreAmenities = (hotel.amenities ?? []).slice(8);

  return (
    <Shell>
      <BackToResults />

      <header className="mb-5 grid gap-3 sm:flex sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-display text-3xl font-semibold leading-tight sm:text-5xl">{hotel.name}</h1>
            <StarRating rating={hotel.starRating} />
          </div>
          {location && (
            <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
              {location}
            </p>
          )}
        </div>
        {fromPrice && (
          <a href="#rooms" className="hidden shrink-0 rounded-sm bg-gold px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary sm:inline-flex">
            Choose a room
          </a>
        )}
      </header>

      <HotelGallery images={hotel.images} name={hotel.name} />

      {/* Compact stay summary on phones */}
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-foreground/10 bg-card p-4 lg:hidden">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            <CalendarDays className="size-4 shrink-0 text-gold" aria-hidden="true" />
            {stayLabel(data.checkIn, data.checkOut)}
          </p>
          {fromPrice && (
            <p className="mt-1 text-xs text-muted-foreground">
              From <span className="font-semibold text-foreground">{formatMoney(fromPrice.totalPrice.amount, fromPrice.totalPrice.currency)}</span> total
            </p>
          )}
        </div>
        <a href="#rooms" className="shrink-0 rounded-sm bg-gold px-4 py-2.5 text-sm font-medium text-primary-foreground">Rooms</a>
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {keyAmenities.length > 0 && (
            <section aria-labelledby="amenities-heading">
              <h2 id="amenities-heading" className="font-display text-2xl font-semibold">Popular amenities</h2>
              <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
                {keyAmenities.map((amenity) => (
                  <li key={amenity} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                    <span>{amenity}</span>
                  </li>
                ))}
              </ul>
              {moreAmenities.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium text-gold">See all {hotel.amenities?.length} amenities</summary>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {moreAmenities.map((amenity) => (
                      <li key={amenity} className="rounded-full border border-foreground/10 px-3 py-1.5 text-muted-foreground">{amenity}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}

          {hotel.description && (
            <section className="mt-10" aria-labelledby="about-heading">
              <h2 id="about-heading" className="font-display text-2xl font-semibold">About this property</h2>
              <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{hotel.description}</p>
            </section>
          )}

          <section id="rooms" className="mt-12 scroll-mt-28" aria-labelledby="rooms-heading">
            <h2 id="rooms-heading" className="font-display text-3xl font-semibold">Choose your room</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Each rate shows its meal plan, cancellation terms and fees. Prices are for your whole stay and include taxes.
            </p>
            {selectError && (
              <Alert variant="destructive" className="mt-6" role="alert">
                <AlertCircle className="size-4" aria-hidden="true" />
                <AlertTitle>We couldn't continue with that room</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{selectError.message}</p>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/hotels">Search again</Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {hotel.rooms.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
                <p className="font-display text-2xl">No rooms left for these dates</p>
                <Button asChild className="mt-4">
                  <Link to="/hotels">Try other dates</Link>
                </Button>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {hotel.rooms.map((room) => (
                  <HotelRoomCard
                    key={room.id}
                    room={room}
                    nights={nights}
                    selecting={selectingId === room.id}
                    disabled={select.isPending && selectingId !== room.id}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            )}
          </section>

          {(hotel.checkInTime || (hotel.policies && hotel.policies.length > 0)) && (
            <section className="mt-12" aria-labelledby="policies-heading">
              <h2 id="policies-heading" className="font-display text-2xl font-semibold">Important information</h2>
              {hotel.checkInTime && (
                <dl className="mt-4 grid max-w-md grid-cols-2 gap-4 text-sm">
                  <div className="rounded-xl border border-foreground/10 p-4"><dt className="text-xs uppercase tracking-wider text-muted-foreground">Check-in</dt><dd className="mt-1 font-medium">From {hotel.checkInTime}</dd></div>
                  <div className="rounded-xl border border-foreground/10 p-4"><dt className="text-xs uppercase tracking-wider text-muted-foreground">Check-out</dt><dd className="mt-1 font-medium">By {hotel.checkOutTime ?? "11:00"}</dd></div>
                </dl>
              )}
              {hotel.policies && hotel.policies.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  {hotel.policies.map((policy) => (
                    <li key={policy} className="flex gap-2"><span aria-hidden="true">•</span><span>{policy}</span></li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <aside className="hidden lg:sticky lg:top-28 lg:block lg:self-start">
          <div className="rounded-xl border border-foreground/10 bg-card p-6 shadow-[var(--shadow-soft)]">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Your stay</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-start gap-3"><CalendarDays className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" /><div><dt className="sr-only">Dates</dt><dd className="font-medium">{stayLabel(data.checkIn, data.checkOut)}</dd></div></div>
              {nights > 0 && <div className="flex items-start gap-3"><Moon className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" /><div><dt className="sr-only">Nights</dt><dd>{nights} night{nights > 1 ? "s" : ""}</dd></div></div>}
              {hotel.checkInTime && <div className="flex items-start gap-3"><Clock className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" /><div><dt className="sr-only">Check-in and check-out</dt><dd>Check-in from {hotel.checkInTime} · out by {hotel.checkOutTime ?? "11:00"}</dd></div></div>}
              {hotel.rate?.mealPlan && <div className="flex items-start gap-3"><Utensils className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" /><div><dt className="sr-only">Meal plans</dt><dd>Meal plans from {hotel.rate.mealPlan}</dd></div></div>}
              <div className="flex items-start gap-3"><BedDouble className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" /><div><dt className="sr-only">Rooms</dt><dd>{hotel.rooms.length} room option{hotel.rooms.length === 1 ? "" : "s"}</dd></div></div>
            </dl>
            {fromPrice && (
              <div className="mt-5 border-t border-foreground/10 pt-5">
                <p className="text-xs text-muted-foreground">Stay from</p>
                <p className="font-display text-3xl font-semibold">{formatMoney(fromPrice.totalPrice.amount, fromPrice.totalPrice.currency)}</p>
                <p className="text-xs text-muted-foreground">total, includes taxes & fees</p>
                <Button asChild className="mt-4 w-full bg-gold text-primary-foreground hover:bg-primary"><a href="#rooms">Choose a room</a></Button>
              </div>
            )}
            <p className="mt-4 flex gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 shrink-0 text-gold" aria-hidden="true" />
              Rates are re-checked with the hotel when you pick a room, so the total you pay is always the current one.
            </p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

/** Returns to the same results (search, filters, sort and scroll are restored there). */
function BackToResults() {
  const [search, setSearch] = useState<Record<string, unknown> | null>(null);
  useEffect(() => setSearch(readLastResults()), []);
  return (
    <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2">
      <Link to="/hotels" search={(search ?? {}) as never}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to results
      </Link>
    </Button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-svh bg-background text-foreground">
      <Nav />
      <section className="mx-auto max-w-7xl px-6 pb-20 pt-36 sm:pt-40 lg:pt-44">{children}</section>
      <Footer />
    </main>
  );
}
