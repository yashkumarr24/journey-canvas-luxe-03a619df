import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, MapPin, Utensils } from "lucide-react";
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
import { rememberHotelGuestToken } from "@/lib/hotel-session";
import { newIdempotencyKey } from "@/lib/review-session";
import { toBookingError } from "@/lib/booking-api";
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

  return (
    <Shell>
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link to="/hotels">← Back to results</Link>
      </Button>

      <HotelGallery images={hotel.images} name={hotel.name} />

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-display text-4xl leading-tight sm:text-5xl">{hotel.name}</h1>
            <StarRating rating={hotel.starRating} />
          </div>

          {hotel.location && (
            <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {hotel.location.address ??
                [hotel.location.area, hotel.location.city, hotel.location.country].filter(Boolean).join(", ")}
            </p>
          )}

          {hotel.description && <p className="mt-6 max-w-2xl text-muted-foreground">{hotel.description}</p>}

          {hotel.amenities && hotel.amenities.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Amenities</h2>
              <ul className="mt-4 flex flex-wrap gap-2">
                {hotel.amenities.map((amenity) => (
                  <li
                    key={amenity}
                    className="rounded-full border border-foreground/10 px-3 py-1.5 text-sm text-muted-foreground"
                  >
                    {amenity}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-12">
            <h2 className="font-display text-3xl">Choose your room</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Prices below are for your whole stay and include taxes and fees.
            </p>

            {selectError && (
              <Alert variant="destructive" className="mt-6" role="alert">
                <AlertCircle className="size-4" aria-hidden="true" />
                <AlertTitle>We couldn't hold that room</AlertTitle>
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

          {hotel.policies && hotel.policies.length > 0 && (
            <section className="mt-12">
              <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Property policies</h2>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {hotel.policies.map((policy) => (
                  <li key={policy}>• {policy}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border border-foreground/10 bg-card p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Your stay</p>
            <p className="mt-3 flex items-center gap-2 text-sm">
              <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
              {stayLabel(data.checkIn, data.checkOut)}
            </p>
            {hotel.checkInTime && (
              <p className="mt-3 text-xs text-muted-foreground">
                Check-in from {hotel.checkInTime} · check-out by {hotel.checkOutTime ?? "11:00"}
              </p>
            )}
            {hotel.rate?.mealPlan && (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Utensils className="size-3.5" aria-hidden="true" />
                Meal plans from {hotel.rate.mealPlan}
              </p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Rates are re-checked with the hotel when you pick a room, so the total you pay is always the
              current one.
            </p>
          </div>
        </aside>
      </div>
    </Shell>
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
