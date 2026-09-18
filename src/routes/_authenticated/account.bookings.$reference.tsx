import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { BookingDetailPanels } from "@/components/ops/BookingDetailPanels";
import { BookingTimeline } from "@/components/ops/BookingTimeline";
import { DocumentsPanel } from "@/components/ops/DocumentsPanel";
import {
  BookingStatusBadge,
  CancellationBadge,
  PaymentStatusBadge,
  RefundBadge,
  TestModePill,
} from "@/components/ops/OpsBadges";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/flight-search";
import { useAuth } from "@/lib/auth/auth-context";
import { opsApi } from "@/lib/ops/ops-api";
import { privateKeys } from "@/lib/auth/query-keys";
import type { CancellationReason } from "@/types/operations";

/**
 * Customer booking detail: itinerary/stay, travellers/guests, fare, documents,
 * timeline and the cancellation request workflow.
 *
 * The cancellation action files a REQUEST. No provider cancellation and no
 * refund is executed here, and the copy says so plainly.
 */
export const Route = createFileRoute("/_authenticated/account/bookings/$reference")({
  component: BookingDetailPage,
});

const REASONS: { value: CancellationReason; label: string }[] = [
  { value: "change_of_plan", label: "Change of plan" },
  { value: "date_change", label: "I need different dates" },
  { value: "booked_by_mistake", label: "Booked by mistake" },
  { value: "found_better_option", label: "Found a better option" },
  { value: "medical", label: "Medical / emergency" },
  { value: "other", label: "Other" },
];

function BookingDetailPage() {
  const { reference } = Route.useParams();
  const { userId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState<CancellationReason>("change_of_plan");
  const [comment, setComment] = useState("");

  const booking = useQuery({
    queryKey: privateKeys.booking(userId ?? "anon", reference),
    queryFn: () => opsApi.getBooking(reference, { userId }),
    enabled: Boolean(userId),
  });

  const cancellation = useMutation({
    mutationFn: () => opsApi.requestCancellation({ bookingReference: reference, reason, comment: comment.trim() || undefined }, { userId }),
    onSuccess: () => {
      setShowForm(false);
      setComment("");
      void queryClient.invalidateQueries({ queryKey: privateKeys.bookings(userId ?? "anon") });
      void booking.refetch();
    },
  });

  if (booking.isPending) {
    return <div className="h-64 animate-pulse rounded-2xl border border-foreground/10 bg-foreground/5" />;
  }

  if (booking.isError || !booking.data) {
    return (
      <div className="rounded-2xl border border-red-600/25 bg-red-600/5 p-5 text-sm text-red-700">
        <p>We couldn&apos;t open that booking. It may not belong to this account.</p>
        <div className="mt-3 flex gap-3">
          <Button variant="outline" onClick={() => void booking.refetch()}>
            Try again
          </Button>
          <Button variant="ghost" onClick={() => void navigate({ to: "/account/bookings" })}>
            Back to bookings
          </Button>
        </div>
      </div>
    );
  }

  const detail = booking.data;
  const canRequestCancellation =
    (detail.status === "confirmed" || detail.status === "booking_processing") &&
    (!detail.cancellation || detail.cancellation.status === "rejected");

  return (
    <div className="space-y-6">
      <Link
        to="/account/bookings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All bookings
      </Link>

      <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {detail.product === "flight" ? "Flight booking" : "Hotel booking"}
            </p>
            <h2 className="mt-1 font-display text-2xl tracking-tight text-foreground">
              {detail.bookingReference}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{detail.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <BookingStatusBadge status={detail.status} />
            <PaymentStatusBadge status={detail.paymentStatus} />
            <CancellationBadge status={detail.cancellationStatus} />
            <RefundBadge status={detail.refundStatus} />
            {detail.isTestMode ? <TestModePill /> : null}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Destination</dt>
            <dd className="text-foreground">{detail.destination}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Total</dt>
            <dd className="text-foreground">
              {formatMoney(detail.totalAmount.amount, detail.totalAmount.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Contact</dt>
            <dd className="truncate text-foreground">{detail.contact.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Booked on</dt>
            <dd className="text-foreground">{new Date(detail.bookedAt).toLocaleDateString("en-IN")}</dd>
          </div>
        </dl>
      </section>

      <BookingDetailPanels detail={detail} />

      <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
        <h3 className="font-display text-lg tracking-tight text-foreground">Documents</h3>
        <div className="mt-4">
          <DocumentsPanel documents={detail.documents} />
        </div>
      </section>

      <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
        <h3 className="font-display text-lg tracking-tight text-foreground">Booking timeline</h3>
        <div className="mt-4">
          <BookingTimeline events={detail.timeline} />
        </div>
      </section>

      <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
        <h3 className="font-display text-lg tracking-tight text-foreground">Cancellation</h3>

        {detail.cancellation ? (
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <CancellationBadge status={detail.cancellation.status} />
              <RefundBadge status={detail.cancellation.refundStatus} />
            </div>
            <p className="text-muted-foreground">
              Requested on {new Date(detail.cancellation.createdAt).toLocaleString("en-IN")}.
              {detail.cancellation.decisionNote ? ` Note from our team: ${detail.cancellation.decisionNote}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              A refund is only processed once our payments provider is connected. Nothing has been
              charged back yet.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No cancellation request on this booking.
          </p>
        )}

        {canRequestCancellation ? (
          showForm ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                cancellation.mutate();
              }}
            >
              <label className="block text-sm">
                <span className="text-muted-foreground">Reason</span>
                <select
                  value={reason}
                  onChange={(event) => setReason(event.target.value as CancellationReason)}
                  className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
                >
                  {REASONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-muted-foreground">Anything we should know? (optional)</span>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  maxLength={600}
                  className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
                />
              </label>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800">
                Submitting this sends a cancellation request to our team. It does not cancel the
                booking with the airline or hotel and it does not start a refund — both happen only
                after our team reviews it.
              </div>
              {cancellation.isError ? (
                <p className="text-sm text-red-700">
                  We couldn&apos;t submit the request. Please try again.
                </p>
              ) : null}
              <div className="flex gap-3">
                <Button type="submit" disabled={cancellation.isPending}>
                  {cancellation.isPending ? "Submitting…" : "Confirm request"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" className="mt-4" onClick={() => setShowForm(true)}>
              Request cancellation
            </Button>
          )
        ) : null}
      </section>

      <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
        <h3 className="font-display text-lg tracking-tight text-foreground">Need help?</h3>
        {detail.supportRequests.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {detail.supportRequests.map((request) => (
              <li key={request.id} className="text-muted-foreground">
                {request.reference} — {request.subject} ({request.status.replace("_", " ")})
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Open a support request and our desk will follow up on this booking.
          </p>
        )}
        <Link to="/account/support" className="mt-3 inline-block text-sm text-gold underline underline-offset-4">
          Go to support
        </Link>
      </section>
    </div>
  );
}
