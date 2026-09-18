import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plane, Search } from "lucide-react";

import { BookingCard } from "@/components/ops/BookingCard";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { opsApi, useMockOperations } from "@/lib/ops/ops-api";
import { privateKeys } from "@/lib/auth/query-keys";
import type { BookingBucket, BookingListQuery, BookingProduct } from "@/types/operations";

/**
 * "My trips" — the customer booking list.
 *
 * Bookings are read through the operations API boundary, which resolves
 * ownership from the signed-in session. No booking table is read directly from
 * the browser and no second booking store exists.
 */
export const Route = createFileRoute("/_authenticated/account/bookings/")({
  component: BookingsListPage,
});

const BUCKETS: { value: BookingBucket; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
  { value: "pending", label: "Pending" },
  { value: "cancelled", label: "Cancelled" },
  { value: "failed", label: "Failed" },
];

const PAGE_SIZE = 5;

function BookingsListPage() {
  const { userId } = useAuth();
  const [bucket, setBucket] = useState<BookingBucket>("all");
  const [product, setProduct] = useState<BookingProduct | "all">("all");
  const [sort, setSort] = useState<NonNullable<BookingListQuery["sort"]>>("newest");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const query = useMemo<BookingListQuery>(
    () => ({ bucket, product, sort, search: search.trim() || undefined, limit, offset: 0 }),
    [bucket, product, sort, search, limit],
  );

  const bookings = useQuery({
    queryKey: [...privateKeys.bookings(userId ?? "anon"), query],
    queryFn: () => opsApi.listBookings(query, { userId }),
    enabled: Boolean(userId),
  });

  const reset = (apply: () => void) => {
    setLimit(PAGE_SIZE);
    apply();
  };

  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <h2 className="font-display text-xl tracking-tight text-foreground">Your bookings</h2>
        <p className="text-sm text-muted-foreground">
          Flights and hotels you have booked, with payment and cancellation status.
        </p>
        {useMockOperations ? (
          <p className="rounded-xl border border-sky-600/25 bg-sky-600/5 px-3 py-2 text-xs text-sky-800">
            Test mode: these are bookings made with the test payment flow. Real bookings will appear
            here once live booking is switched on.
          </p>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Booking status">
        {BUCKETS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={bucket === item.value}
            onClick={() => reset(() => setBucket(item.value))}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              bucket === item.value
                ? "border-gold bg-gold/10 text-foreground"
                : "border-foreground/12 text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[12rem]">
          <span className="sr-only">Search bookings</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => reset(() => setSearch(event.target.value))}
            placeholder="Booking reference or destination"
            className="w-full rounded-full border border-foreground/15 bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-gold"
          />
        </label>
        <label className="text-sm">
          <span className="sr-only">Product</span>
          <select
            value={product}
            onChange={(event) => reset(() => setProduct(event.target.value as BookingProduct | "all"))}
            className="rounded-full border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
          >
            <option value="all">Flights &amp; hotels</option>
            <option value="flight">Flights</option>
            <option value="hotel">Hotels</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="sr-only">Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as NonNullable<BookingListQuery["sort"]>)}
            className="rounded-full border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="travel_date">By travel date</option>
          </select>
        </label>
      </div>

      {bookings.isPending ? (
        <div className="space-y-3" aria-live="polite">
          {[0, 1].map((key) => (
            <div key={key} className="h-32 animate-pulse rounded-2xl border border-foreground/10 bg-foreground/5" />
          ))}
        </div>
      ) : bookings.isError ? (
        <div className="rounded-2xl border border-red-600/25 bg-red-600/5 p-5 text-sm text-red-700">
          <p>We couldn&apos;t load your bookings just now.</p>
          <Button variant="outline" className="mt-3" onClick={() => void bookings.refetch()}>
            Try again
          </Button>
        </div>
      ) : bookings.data && bookings.data.items.length > 0 ? (
        <>
          <div className="space-y-3">
            {bookings.data.items.map((booking) => (
              <BookingCard key={booking.bookingReference} booking={booking} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {bookings.data.items.length} of {bookings.data.total}
          </p>
          {bookings.data.hasMore ? (
            <Button variant="outline" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
              Load more
            </Button>
          ) : null}
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-foreground/15 px-4 py-10 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-foreground/5 text-gold">
            <Plane className="size-5" aria-hidden />
          </span>
          <p className="mt-4 text-sm text-muted-foreground">
            No bookings match this view yet.
          </p>
          <Link to="/flights" className="mt-4 inline-block text-sm text-gold underline underline-offset-4">
            Search flights
          </Link>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Booked as a guest? Use the reference and email from your confirmation on the{" "}
        <Link to="/booking-lookup" className="text-gold underline underline-offset-4">
          booking lookup page
        </Link>{" "}
        — a guest booking is never attached to an account automatically.
      </p>
    </section>
  );
}
