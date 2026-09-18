import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import {
  BookingStatusBadge,
  CancellationBadge,
  PaymentStatusBadge,
} from "@/components/ops/OpsBadges";
import { formatMoney } from "@/lib/flight-search";
import { opsApi, useMockOperations } from "@/lib/ops/ops-api";
import { clearSampleOperations, seedSampleOperations } from "@/lib/ops/ops-demo";
import type { BookingBucket, BookingListQuery, BookingProduct, PaymentStatus } from "@/types/operations";

/**
 * Admin booking management.
 *
 * Rows come from the operations endpoint, which authorises the caller's admin
 * level server-side. Only the identity needed to run a booking desk is shown:
 * reference, product, destination, dates, statuses and the contact email.
 */
export const Route = createFileRoute("/admin/bookings/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Bookings — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Manage flight and hotel bookings, payments and cancellations." },
      { property: "og:title", content: "Bookings — Fly n Feel Admin" },
      { property: "og:description", content: "Flight and hotel booking management for Fly n Feel staff." },
    ],
  }),
  component: AdminBookingsPage,
});

const BUCKETS: { value: BookingBucket; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

const PAYMENTS: { value: PaymentStatus | "all"; label: string }[] = [
  { value: "all", label: "Any payment status" },
  { value: "not_started", label: "Not paid" },
  { value: "pending", label: "Payment pending" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Payment failed" },
  { value: "refund_pending", label: "Refund pending" },
  { value: "refunded", label: "Refund completed" },
];

const PAGE = 20;

function AdminBookingsPage() {
  const [bucket, setBucket] = useState<BookingBucket>("all");
  const [product, setProduct] = useState<BookingProduct | "all">("all");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [seeded, setSeeded] = useState(0);

  const query = useMemo<BookingListQuery>(
    () => ({
      bucket,
      product,
      paymentStatus,
      search: search.trim() || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      limit,
      offset: 0,
    }),
    [bucket, product, paymentStatus, search, fromDate, toDate, limit],
  );

  const bookings = useQuery({
    queryKey: ["admin", "ops", "bookings", query, seeded],
    queryFn: () => opsApi.adminListBookings(query),
  });

  return (
    <AdminShell
      title="Bookings"
      description="Search, filter and open any flight or hotel booking. Cancellations and refunds are requests until the provider integrations are live."
      permission="bookings.view"
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {BUCKETS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setBucket(item.value);
              setLimit(PAGE);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              bucket === item.value
                ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                : "border-input text-muted-foreground hover:bg-accent"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-2 lg:grid-cols-5">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Reference, destination or customer email"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary lg:col-span-2"
        />
        <select
          value={product}
          onChange={(event) => setProduct(event.target.value as BookingProduct | "all")}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">Flights &amp; hotels</option>
          <option value="flight">Flights</option>
          <option value="hotel">Hotels</option>
        </select>
        <select
          value={paymentStatus}
          onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus | "all")}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {PAYMENTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Booked from"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          />
          <input
            type="date"
            aria-label="Booked to"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          />
        </div>
      </div>

      {bookings.isPending ? (
        <div className="h-40 animate-pulse rounded-lg border border-border bg-background" />
      ) : bookings.isError ? (
        <div className="rounded-lg border border-destructive/30 bg-background p-4 text-sm">
          <p className="text-destructive">We couldn&apos;t load bookings.</p>
          <Button variant="outline" className="mt-3" onClick={() => void bookings.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Travel</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Cases</th>
              </tr>
            </thead>
            <tbody>
              {bookings.data?.items.length ? (
                bookings.data.items.map((booking) => (
                  <tr key={booking.bookingReference} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        to="/admin/bookings/$reference"
                        params={{ reference: booking.bookingReference }}
                        className="font-medium text-foreground underline underline-offset-4"
                      >
                        {booking.bookingReference}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">{booking.destination}</p>
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{booking.product}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="block max-w-[14rem] truncate">{booking.contactEmail}</span>
                      <span className="text-xs capitalize">{booking.customerType}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {booking.travelDate ? new Date(booking.travelDate).toLocaleDateString("en-IN") : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-foreground">
                      {formatMoney(booking.totalAmount.amount, booking.totalAmount.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <BookingStatusBadge status={booking.status} />
                        <PaymentStatusBadge status={booking.paymentStatus} />
                        <CancellationBadge status={booking.cancellationStatus} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {booking.openSupportRequests} support · {booking.internalNoteCount} notes
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-muted-foreground">
                    No bookings match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {bookings.data?.hasMore ? (
        <Button variant="outline" className="mt-4" onClick={() => setLimit((value) => value + PAGE)}>
          Load more
        </Button>
      ) : null}

      {useMockOperations ? (
        <div className="mt-6 rounded-lg border border-border bg-background p-4">
          <h2 className="text-sm font-semibold text-foreground">Sample records</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Test mode only. Adds clearly-labelled sample bookings (confirmed, pending, failed, with a
            cancellation request) so the list, timeline, notes and support screens can be exercised
            without walking the whole booking journey.
          </p>
          <div className="mt-3 flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                seedSampleOperations();
                setSeeded((value) => value + 1);
              }}
            >
              Add sample records
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                clearSampleOperations();
                setSeeded((value) => value + 1);
              }}
            >
              Remove samples
            </Button>
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
