/**
 * One row in the customer booking list. Presentation only — every value comes
 * from the server-shaped booking record.
 */

import { Link } from "@tanstack/react-router";
import { BedDouble, Plane } from "lucide-react";

import { formatMoney } from "@/lib/flight-search";
import {
  BookingStatusBadge,
  CancellationBadge,
  PaymentStatusBadge,
  TestModePill,
} from "@/components/ops/OpsBadges";
import type { BookingListItem } from "@/types/operations";

function day(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function BookingCard({ booking }: { booking: BookingListItem }) {
  return (
    <article className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-4 shadow-[var(--shadow-soft)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {booking.product === "flight" ? (
              <Plane className="size-3.5 text-gold" aria-hidden />
            ) : (
              <BedDouble className="size-3.5 text-gold" aria-hidden />
            )}
            {booking.product === "flight" ? "Flight" : "Hotel"} · {booking.bookingReference}
          </p>
          <h3 className="mt-1.5 font-display text-lg tracking-tight text-foreground">
            {booking.destination}
          </h3>
          <p className="mt-1 truncate text-sm text-muted-foreground">{booking.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BookingStatusBadge status={booking.status} />
          <PaymentStatusBadge status={booking.paymentStatus} />
          <CancellationBadge status={booking.cancellationStatus} />
          {booking.isTestMode ? <TestModePill /> : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Booked on</dt>
          <dd className="text-foreground">{day(booking.bookedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {booking.product === "flight" ? "Departure" : "Check-in"}
          </dt>
          <dd className="text-foreground">{day(booking.travelDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total</dt>
          <dd className="text-foreground">
            {formatMoney(booking.totalAmount.amount, booking.totalAmount.currency)}
          </dd>
        </div>
        <div className="flex items-end">
          <Link
            to="/account/bookings/$reference"
            params={{ reference: booking.bookingReference }}
            className="text-sm text-gold underline underline-offset-4"
          >
            View details
          </Link>
        </div>
      </dl>
    </article>
  );
}
