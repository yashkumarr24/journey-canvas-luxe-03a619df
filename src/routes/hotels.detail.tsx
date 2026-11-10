import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, BedDouble, CalendarDays, Check, Loader2, MapPin, ShieldCheck, Users } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { HotelGallery } from "@/components/booking/HotelGallery";
import { CancellationLine } from "@/components/booking/HotelRoomCard";
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [amenitiesOpen, setAmenitiesOpen] = useState(false);
  const [roomFilter, setRoomFilter] = useState({ refundable: false, breakfast: false });

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
  const amenities = hotel.amenities ?? [];
  const visibleRooms = hotel.rooms.filter(
    (room) =>
      (!roomFilter.refundable || room.cancellation?.refundable) &&
      (!roomFilter.breakfast || /breakfast|board/i.test(room.mealPlan ?? "")),
  );
  const groups = groupRooms(visibleRooms);

  return (
    <Shell>
      <BackToResults />

      {/* Property overview card */}
      <article className="rounded-2xl border border-foreground/10 bg-card p-4 shadow-sm sm:p-6">
        <header className="mb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">{hotel.name}</h1>
            <StarRating rating={hotel.starRating} />
          </div>
          {location && (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
              {location}
            </p>
          )}
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <HotelGallery images={hotel.images} name={hotel.name} />

          {/* Desktop summary panel */}
          <aside className="hidden flex-col gap-3 lg:flex">
            {fromPrice && (
              <div className="rounded-xl border border-foreground/10 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{fromPrice.roomName}</p>
                    <p className="text-xs text-muted-foreground">{fromPrice.roomCount} room{fromPrice.roomCount > 1 ? "s" : ""} for {fromPrice.occupancy.adults + (fromPrice.occupancy.childAges?.length ?? 0)} guests</p>
                  </div>
                  <a href="#rooms" className="shrink-0 text-xs font-medium text-gold">View details</a>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    <li>• {fromPrice.mealPlan ?? "Room only"}</li>
                    <li>• {fromPrice.cancellation?.refundable ? "Refundable" : "Non-refundable"}</li>
                  </ul>
                  <div className="text-right">
                    <p className="font-display text-2xl font-bold leading-none">{formatMoney(fromPrice.totalPrice.amount, fromPrice.totalPrice.currency)}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Total for {nights} night{nights > 1 ? "s" : ""}</p>
                  </div>
                </div>
                <Button type="button" className="mt-4 w-full bg-gold text-primary-foreground hover:bg-primary" disabled={select.isPending} onClick={() => handleSelect(fromPrice)}>
                  {selectingId === fromPrice.id ? "Checking…" : "Book now"}
                </Button>
              </div>
            )}
            {hotel.rooms.length > 1 && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-gold/30 bg-gold/5 p-3 text-sm">
                <span className="font-medium">More options available</span>
                <a href="#rooms" className="rounded-md border border-gold/40 px-3 py-1.5 text-xs font-medium text-gold">View all rooms</a>
              </div>
            )}
            <div className="grid grid-cols-2 divide-x divide-foreground/10 rounded-xl border border-foreground/10 text-xs">
              <p className="p-3">Check-in from <span className="font-semibold">{hotel.checkInTime ?? "—"}</span></p>
              <p className="p-3">Check-out until <span className="font-semibold">{hotel.checkOutTime ?? "—"}</span></p>
            </div>
            <p className="flex gap-2 text-xs text-muted-foreground">
              <CalendarDays className="size-4 shrink-0 text-gold" aria-hidden="true" />
              {stayLabel(data.checkIn, data.checkOut)}
            </p>
          </aside>
        </div>

        {/* Compact stay summary on phones */}
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-foreground/10 p-3 lg:hidden">
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

        {hotel.description && (
          <section className="mt-5" aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-base font-bold">About this property</h2>
            <p className={`mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground ${aboutOpen ? "" : "line-clamp-2"}`}>{hotel.description}</p>
            <button type="button" onClick={() => setAboutOpen((v) => !v)} className="mt-1 text-sm font-medium text-gold">{aboutOpen ? "Show less" : "Read more"}</button>
          </section>
        )}

        {amenities.length > 0 && (
          <section className="mt-4" aria-labelledby="amenities-heading">
            <h2 id="amenities-heading" className="text-base font-bold">Amenities</h2>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              {(amenitiesOpen ? amenities : amenities.slice(0, 6)).map((amenity) => (
                <li key={amenity} className="flex items-center gap-1.5"><Check className="size-3.5 shrink-0 text-gold" aria-hidden="true" />{amenity}</li>
              ))}
            </ul>
            {amenities.length > 6 && (
              <button type="button" onClick={() => setAmenitiesOpen((v) => !v)} className="mt-1.5 text-sm font-medium text-gold">{amenitiesOpen ? "Show less" : `View all ${amenities.length}`}</button>
            )}
          </section>
        )}
      </article>

      {/* Room types */}
      <section id="rooms" className="mt-8 scroll-mt-28 rounded-2xl border border-foreground/10 bg-card shadow-sm" aria-labelledby="rooms-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 p-4 sm:p-6">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 id="rooms-heading" className="font-display text-2xl font-bold">Room types</h2>
            <p className="text-xs text-muted-foreground">Showing {visibleRooms.length} of {hotel.rooms.length} room options · prices for your whole stay, incl. taxes</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["refundable", "breakfast"] as const).map((key) => (
              <button key={key} type="button" aria-pressed={roomFilter[key]} onClick={() => setRoomFilter((f) => ({ ...f, [key]: !f[key] }))}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${roomFilter[key] ? "border-gold bg-gold/10 text-gold" : "border-foreground/15 text-muted-foreground hover:text-foreground"}`}>
                {key === "refundable" ? "Refundable" : "Breakfast included"}
              </button>
            ))}
          </div>
        </div>

        {selectError && (
          <Alert variant="destructive" className="m-4 w-auto" role="alert">
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
          <div className="p-10 text-center">
            <p className="font-display text-2xl">No rooms left for these dates</p>
            <Button asChild className="mt-4"><Link to="/hotels">Try other dates</Link></Button>
          </div>
        ) : groups.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-display text-xl">No rooms match these filters</p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => setRoomFilter({ refundable: false, breakfast: false })}>Clear filters</Button>
          </div>
        ) : (
          <div className="divide-y divide-foreground/10">
            {groups.map((group) => (
              <div key={group.name} className="grid md:grid-cols-[260px_minmax(0,1fr)]">
                <div className="border-foreground/10 bg-foreground/[0.02] p-4 md:border-r">
                  <div className="flex items-center gap-2 rounded-lg bg-foreground/5 p-4">
                    <BedDouble className="size-6 shrink-0 text-gold" aria-hidden="true" />
                    <p className="font-semibold leading-snug">{group.name}</p>
                  </div>
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {group.bed && <li className="flex items-center gap-1.5"><BedDouble className="size-3.5" aria-hidden="true" />{group.bed}</li>}
                    <li className="flex items-center gap-1.5"><Users className="size-3.5" aria-hidden="true" />Fits {group.guests} guest{group.guests > 1 ? "s" : ""}</li>
                    {group.inclusions.slice(0, 4).map((inc) => (
                      <li key={inc} className="flex items-center gap-1.5"><Check className="size-3.5 text-gold" aria-hidden="true" />{inc}</li>
                    ))}
                  </ul>
                </div>
                <ul className="divide-y divide-foreground/10">
                  {group.rooms.map((room) => (
                    <RateRow key={room.id} room={room} nights={nights} selecting={selectingId === room.id} disabled={select.isPending && selectingId !== room.id} onSelect={handleSelect} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {(hotel.checkInTime || (hotel.policies && hotel.policies.length > 0)) && (
        <section className="mt-8 rounded-2xl border border-foreground/10 bg-card p-4 shadow-sm sm:p-6" aria-labelledby="policies-heading">
          <h2 id="policies-heading" className="font-display text-2xl font-bold">Important information</h2>
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
          <p className="mt-4 flex gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-gold" aria-hidden="true" />
            Rates are re-checked with the hotel when you pick a room, so the total you pay is always the current one.
          </p>
        </section>
      )}
    </Shell>
  );
}

function groupRooms(rooms: HotelRoomOption[]) {
  const map = new Map<string, { name: string; bed?: string; guests: number; inclusions: string[]; rooms: HotelRoomOption[] }>();
  for (const room of rooms) {
    const g = map.get(room.roomName) ?? { name: room.roomName, bed: room.bedType, guests: room.occupancy.adults + (room.occupancy.childAges?.length ?? 0), inclusions: [], rooms: [] };
    g.rooms.push(room);
    for (const inc of room.inclusions ?? []) if (!g.inclusions.includes(inc)) g.inclusions.push(inc);
    map.set(room.roomName, g);
  }
  return [...map.values()];
}

function RateRow({ room, nights, selecting, disabled, onSelect }: { room: HotelRoomOption; nights: number; selecting: boolean; disabled: boolean; onSelect: (room: HotelRoomOption) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="font-semibold leading-snug">{room.roomName}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {room.mealPlan ?? "Room only"} <span aria-hidden="true">|</span> {room.cancellation?.refundable ? "Refundable" : "Non-refundable"}
          {room.paymentPolicy ? <> <span aria-hidden="true">|</span> {room.paymentPolicy}</> : null}
        </p>
        <div className="mt-1.5"><CancellationLine room={room} /></div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 text-xs font-medium text-gold">{open ? "Hide details" : "View more"}</button>
        {open && (
          <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
            {room.basePrice && <div className="flex gap-2"><dt>Room charges:</dt><dd>{formatMoney(room.basePrice.amount, room.basePrice.currency)}</dd></div>}
            {room.taxes && <div className="flex gap-2"><dt>Taxes:</dt><dd>{formatMoney(room.taxes.amount, room.taxes.currency)}</dd></div>}
            {room.feesAndCharges && <div className="flex gap-2"><dt>Fees:</dt><dd>{formatMoney(room.feesAndCharges.amount, room.feesAndCharges.currency)}</dd></div>}
            {(room.cancellation?.rules ?? []).map((rule, i) => <div key={i}>{rule.description}</div>)}
            {(room.inclusions ?? []).map((inc) => <div key={inc}>• {inc}</div>)}
          </dl>
        )}
      </div>
      <div className="flex items-end justify-between gap-3 sm:block sm:text-right">
        <div>
          <p className="font-display text-xl font-bold leading-none">{formatMoney(room.totalPrice.amount, room.totalPrice.currency)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Total for {nights} night{nights > 1 ? "s" : ""}{room.roomCount > 1 ? `, ${room.roomCount} rooms` : ""}</p>
          {room.roomsAvailable !== undefined && room.roomsAvailable <= 3 && <p className="text-[11px] text-destructive">Only {room.roomsAvailable} left</p>}
        </div>
        <Button type="button" size="sm" className="shrink-0 bg-gold text-primary-foreground hover:bg-primary sm:mt-2 sm:w-36" disabled={disabled || selecting} onClick={() => onSelect(room)}>
          {selecting ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />Checking…</> : "Select room"}
        </Button>
      </div>
    </li>
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
