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
import { FareBreakdown } from "@/components/booking/FareBreakdown";
import { HotelStaySummary } from "@/components/booking/HotelStaySummary";
import { HotelGuestSummary } from "@/components/booking/HotelGuestSummary";
import { hotelApi } from "@/lib/hotel-api";
import { readHotelBookingGuestToken } from "@/lib/hotel-session";
import { occupancyLabel } from "@/lib/hotel-search";
import { toBookingError } from "@/lib/booking-api";
import type { HotelBookingSummary } from "@/types/booking";

/**
 * Hotel booking confirmation.
 *
 * Everything shown is read back from the server booking. While the hotel is
 * still confirming, the page polls, because the hotel confirmation number
 * arrives after the payment is verified.
 */

type Search = { ref?: string };

export const Route = createFileRoute("/hotels/confirmation")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ref: typeof search.ref === "string" ? search.ref.slice(0, 64) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Hotel Booking Confirmed — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Your Fly n Feel Holidays hotel booking confirmation, with your booking reference, hotel details, room, guests and payment summary.",
      },
      { property: "og:title", content: "Hotel Booking Confirmed — Fly n Feel Holidays" },
      { property: "og:description", content: "Your hotel booking reference and stay details." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HotelConfirmationPage,
});

function HotelConfirmationPage() {
  const { ref } = Route.useSearch();
  const guestToken = ref ? readHotelBookingGuestToken(ref) : null;

  const booking = useQuery<HotelBookingSummary>({
    queryKey: ["hotel-booking", ref],
    enabled: Boolean(ref),
    retry: false,
    staleTime: 0,
    // Keep checking while the hotel is still confirming the room.
    refetchInterval: (query) => (query.state.data?.status === "booking_processing" ? 5_000 : false),
    queryFn: ({ signal }) => hotelApi.getBooking(ref as string, guestToken, signal),
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
              <Link to="/hotels">Search hotels</Link>
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
  const confirming = data.status === "booking_processing";
  const confirmed = data.status === "confirmed";
  const unpaid = data.status === "awaiting_payment" || data.status === "payment_failed";
  const failed = data.status === "failed" || data.status === "cancelled" || data.status === "expired";

  return (
    <Shell>
      {confirmed && (
        <div className="rounded-3xl border border-foreground/10 bg-card p-8 text-center">
          <CheckCircle2 className="mx-auto size-9 text-gold" aria-hidden="true" />
          <h2 className="mt-4 font-display text-3xl sm:text-4xl">Your stay is booked</h2>
          <p className="mt-2 text-muted-foreground">A voucher is on its way to {data.contact.email}.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Booking reference" value={data.bookingReference} />
            <Field
              label="Hotel confirmation"
              value={data.hotelConfirmationNumber ?? data.hotelBookingId ?? "Issued shortly"}
            />
          </div>
        </div>
      )}

      {confirming && (
        <div className="rounded-3xl border border-foreground/10 bg-card p-8 text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-gold" aria-hidden="true" />
          <h2 className="mt-4 font-display text-3xl">Confirming with the hotel</h2>
          <p className="mt-2 text-muted-foreground">
            Your payment went through and the hotel is confirming the room now. This page updates on its own —
            you can safely leave it open.
          </p>
          <Field className="mx-auto mt-6 max-w-xs" label="Booking reference" value={data.bookingReference} />
        </div>
      )}

      {unpaid && (
        <Alert role="status">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>This booking isn't paid yet</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{data.statusMessage ?? "Your room is still held. Complete payment to confirm your stay."}</p>
            <Button asChild size="sm">
              <Link to="/hotels/checkout" search={{ ref: data.bookingReference }}>
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
                "The hotel could not confirm the room. Any amount taken is refunded in full — our desk will follow up with you."}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="sm" variant="outline">
                <Link to="/hotels">Search again</Link>
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
          <section className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
            <HotelStaySummary hotel={data.hotel} room={data.room} stay={data.stay} />
          </section>

          <section className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
            <HotelGuestSummary
              guests={data.guests}
              contact={data.contact}
              specialRequests={data.specialRequests}
            />
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border border-foreground/10 bg-card p-6">
            <FareBreakdown
              breakdown={data.breakdown}
              totalPayable={data.totalPayable}
              title="Payment summary"
              occupancy={{ label: "Rooms & guests", value: occupancyLabel(data.stay.rooms) }}
              footnote={confirmed ? "Paid in full" : undefined}
            />
          </div>

          <div className="rounded-3xl border border-foreground/10 bg-card p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Your documents</p>
            <div className="mt-4 space-y-3">
              <DocumentAction icon={Ticket} label="Hotel voucher" href={data.voucherUrl} pending={confirmed} />
              <DocumentAction icon={FileText} label="Invoice" href={data.invoiceUrl} pending={confirmed} />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {confirmed
                ? "Your voucher and invoice are being prepared and will also be emailed to you."
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
              Your stay, <span className="italic gold-gradient">confirmed.</span>
            </>
          }
          subtitle="Keep your booking reference handy — it's all the hotel needs at check-in."
        />
        <div className="mt-10">{children}</div>
      </section>
      <Footer />
    </main>
  );
}
