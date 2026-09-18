import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Mail,
  Ticket,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SectionTitle } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ItinerarySummary } from "@/components/booking/ItinerarySummary";
import { FareBreakdown } from "@/components/booking/FareBreakdown";
import { TravellerSummary } from "@/components/booking/TravellerSummary";
import { checkoutApi } from "@/lib/checkout-api";
import { readBookingGuestToken } from "@/lib/checkout-session";
import { toBookingError } from "@/lib/booking-api";
import { useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import type { BookingSummary } from "@/types/booking";

/**
 * Booking confirmation.
 *
 * Everything shown here is read back from the server booking. While issuing is
 * still in progress the page polls, because the airline PNR arrives after the
 * payment is verified.
 */

type Search = { ref?: string };

export const Route = createFileRoute("/flights/confirmation")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ref: typeof search.ref === "string" ? search.ref.slice(0, 64) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Booking Confirmed — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Your Fly n Feel Holidays flight booking confirmation, with your booking reference, airline PNR, flight details and traveller summary.",
      },
      { property: "og:title", content: "Booking Confirmed — Fly n Feel Holidays" },
      { property: "og:description", content: "Your flight booking reference and travel details." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConfirmationPage,
});

function ConfirmationPage() {
  const { ref } = Route.useSearch();
  const guestToken = ref ? readBookingGuestToken(ref) : null;

  const booking = useQuery<BookingSummary>({
    queryKey: ["booking", ref],
    enabled: Boolean(ref),
    retry: false,
    staleTime: 0,
    // Keep checking while the airline is still issuing the seats.
    refetchInterval: (query) =>
      query.state.data?.status === "booking_processing" ? 5_000 : false,
    queryFn: ({ signal }) => checkoutApi.getBooking(ref as string, guestToken, signal),
  });

  if (!ref) {
    return (
      <Shell>
        <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
          <p className="font-display text-2xl">No booking to show</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Open the link from your confirmation email, or view your bookings in your account.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild variant="outline">
              <Link to="/account/bookings">My bookings</Link>
            </Button>
            <Button asChild>
              <Link to="/flights">Search flights</Link>
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  if (booking.isPending) {
    return (
      <Shell>
        <div className="space-y-4">
          <Skeleton className="h-36 w-full rounded-3xl" />
          <Skeleton className="h-64 w-full rounded-3xl" />
        </div>
      </Shell>
    );
  }

  if (booking.isError || !booking.data) {
    const error = toBookingError(booking.error);
    return (
      <Shell>
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>We couldn't load this booking</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error.message}</p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => booking.refetch()}>
                Try again
              </Button>
              <Button asChild size="sm">
                <Link to="/contact">Talk to our desk</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const data = booking.data;
  const issuing = data.status === "booking_processing";
  const confirmed = data.status === "confirmed";
  const unpaid = data.status === "awaiting_payment" || data.status === "payment_failed";
  const failed = data.status === "failed" || data.status === "cancelled" || data.status === "expired";

  return (
    <Shell>
      {confirmed && (
        <div className="rounded-3xl border border-foreground/10 bg-card p-8 text-center">
          <CheckCircle2 className="mx-auto size-9 text-gold" aria-hidden="true" />
          <h2 className="mt-4 font-display text-3xl sm:text-4xl">You're booked</h2>
          <p className="mt-2 text-muted-foreground">
            A confirmation is on its way to {data.contact.email}.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Booking reference" value={data.bookingReference} />
            <Field label="Airline PNR" value={data.pnr ?? "Issued shortly"} />
          </div>
        </div>
      )}

      {issuing && (
        <div className="rounded-3xl border border-foreground/10 bg-card p-8 text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-gold" aria-hidden="true" />
          <h2 className="mt-4 font-display text-3xl">Confirming with the airline</h2>
          <p className="mt-2 text-muted-foreground">
            Your payment went through and we're issuing the seats now. This page updates on its own — you can
            safely leave it open.
          </p>
          <Field className="mx-auto mt-6 max-w-xs" label="Booking reference" value={data.bookingReference} />
        </div>
      )}

      {unpaid && (
        <Alert role="status">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>This booking isn't paid yet</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{data.statusMessage ?? "Your fare is still held. Complete payment to confirm your seats."}</p>
            <Button asChild size="sm">
              <Link to="/flights/checkout" search={{ ref: data.bookingReference }}>
                Continue to payment
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {failed && (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>This booking couldn't be completed</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              {data.statusMessage ??
                "The airline could not issue the seats. Any amount taken is refunded in full — our desk will follow up with you."}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="sm" variant="outline">
                <Link to="/flights">Search again</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/contact">Talk to our desk</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-8">
          <section className="rounded-3xl border border-foreground/10 bg-card px-5 sm:px-6">
            <ItinerarySummary itineraries={data.itineraries} />
          </section>

          <section className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
            <TravellerSummary travellers={data.travellers} contact={data.contact} showTickets={confirmed} />
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border border-foreground/10 bg-card p-6">
            <FareBreakdown
              breakdown={data.breakdown}
              totalPayable={data.totalPayable}
              passengers={data.passengers}
              footnote={confirmed ? "Paid in full" : undefined}
            />
          </div>

          <div className="rounded-3xl border border-foreground/10 bg-card p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Your documents</p>
            <div className="mt-4 space-y-3">
              <DocumentAction
                icon={Ticket}
                label="E-ticket"
                href={data.ticketUrl}
                pending={confirmed}
              />
              <DocumentAction
                icon={FileText}
                label="Invoice"
                href={data.invoiceUrl}
                pending={confirmed}
              />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {confirmed
                ? "Your e-ticket and invoice are being prepared and will also be emailed to you."
                : "Documents appear here once the booking is confirmed."}
            </p>
          </div>

          <div className="rounded-3xl border border-foreground/10 bg-card p-6">
            <p className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
              Need a change or have a question?
            </p>
            <Button asChild variant="outline" className="mt-4 w-full">
              <Link to="/contact">Contact our travel desk</Link>
            </Button>
            <Button asChild variant="ghost" className="mt-2 w-full">
              <Link to="/account/bookings">View all my bookings</Link>
            </Button>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-foreground/10 p-4 ${className ?? ""}`}>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl leading-none">{value}</p>
    </div>
  );
}

/** A document link, or a clearly-labelled placeholder until the file exists. */
function DocumentAction({
  icon: Icon,
  label,
  href,
  pending,
}: {
  icon: typeof Ticket;
  label: string;
  href?: string | null;
  pending?: boolean;
}) {
  if (href) {
    return (
      <Button asChild variant="outline" className="w-full justify-start">
        <a href={href} target="_blank" rel="noopener noreferrer">
          <Icon className="size-4" aria-hidden="true" />
          Download {label}
          <Download className="ml-auto size-4" aria-hidden="true" />
        </a>
      </Button>
    );
  }
  return (
    <div
      className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-foreground/15 px-4 py-3 text-sm text-muted-foreground"
      aria-disabled="true"
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
      <span className="ml-auto text-xs">{pending ? "Preparing…" : "Not available yet"}</span>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-svh bg-background text-foreground">
      <Nav />
      <section className="mx-auto max-w-7xl px-6 pb-20 pt-36 sm:pt-40 lg:pt-44">
        <SectionTitle
          eyebrow="Confirmation"
          title={
            <>
              Your journey, <span className="italic gold-gradient">confirmed.</span>
            </>
          }
          subtitle="Keep your booking reference handy — it's all you need at the airport counter."
        />
        <div className="mt-10">{children}</div>
      </section>
      <Footer />
    </main>
  );
}
