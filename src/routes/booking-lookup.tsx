import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";

import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { BookingDetailPanels } from "@/components/ops/BookingDetailPanels";
import { BookingTimeline } from "@/components/ops/BookingTimeline";
import { DocumentsPanel } from "@/components/ops/DocumentsPanel";
import {
  BookingStatusBadge,
  CancellationBadge,
  PaymentStatusBadge,
  TestModePill,
} from "@/components/ops/OpsBadges";
import { formatMoney } from "@/lib/flight-search";
import { opsApi } from "@/lib/ops/ops-api";

/**
 * Guest booking retrieval.
 *
 * Knowing a booking reference is NOT sufficient: the contact email captured at
 * booking time must match as well, and the backend performs that check. The
 * record returned to a guest omits dates of birth and document numbers.
 */
export const Route = createFileRoute("/booking-lookup")({
  head: () => ({
    meta: [
      { title: "Find your booking — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Retrieve a Fly n Feel Holidays flight or hotel booking using your booking reference and the email address on your confirmation.",
      },
      { property: "og:title", content: "Find your booking — Fly n Feel Holidays" },
      {
        property: "og:description",
        content: "Look up a booking with your reference and confirmation email.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BookingLookupPage,
});

function BookingLookupPage() {
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");

  const lookup = useMutation({
    mutationFn: () =>
      opsApi.lookupGuestBooking({ bookingReference: reference.trim(), contactEmail: email.trim() }),
  });

  const detail = lookup.data;

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-32 sm:px-6 md:pt-40">
        <p className="text-[0.7rem] uppercase tracking-[0.2em] text-gold">Guest booking</p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-foreground sm:text-4xl">
          Find your booking
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Enter the booking reference and the email address from your confirmation. We ask for both so
          nobody can open a booking with the reference alone.
        </p>

        <form
          className="mt-6 grid gap-3 rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)] sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            lookup.mutate();
          }}
        >
          <label className="text-sm">
            <span className="text-muted-foreground">Booking reference</span>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value.toUpperCase())}
              placeholder="e.g. FNF12345"
              className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Email on the booking</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
            />
          </label>
          <div className="sm:col-span-2">
            <Button
              type="submit"
              disabled={lookup.isPending || reference.trim().length < 4 || !email.includes("@")}
            >
              {lookup.isPending ? "Checking…" : "Find booking"}
            </Button>
          </div>
          {lookup.isError ? (
            <p className="text-sm text-red-700 sm:col-span-2" aria-live="polite">
              {(lookup.error as Error).message}
            </p>
          ) : null}
        </form>

        {detail ? (
          <div className="mt-8 space-y-6">
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
                  {detail.isTestMode ? <TestModePill /> : null}
                </div>
              </div>
              <p className="mt-4 text-sm text-foreground">
                Total {formatMoney(detail.totalAmount.amount, detail.totalAmount.currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Need a change or a cancellation? Contact our desk with this reference.
              </p>
            </section>

            <BookingDetailPanels detail={detail} />

            <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
              <h3 className="font-display text-lg tracking-tight text-foreground">Documents</h3>
              <div className="mt-4">
                <DocumentsPanel documents={detail.documents} />
              </div>
            </section>

            <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
              <h3 className="font-display text-lg tracking-tight text-foreground">Timeline</h3>
              <div className="mt-4">
                <BookingTimeline events={detail.timeline} />
              </div>
            </section>
          </div>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
