import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Clock,
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
import { forgetHotelBookingGuestToken, readHotelBookingGuestToken } from "@/lib/hotel-session";
import { isAccessRejection, sanitizeBookingReference } from "@/lib/booking-reference";
import { IOS_PAYU_HANDOFF_ENABLED, isIosPayment } from "@/lib/native/ios-payu";
import { occupancyLabel } from "@/lib/hotel-search";
import { toBookingError } from "@/lib/booking-api";
import {
  confirmationHeaderCopy,
  NEUTRAL_CONFIRMATION_HEADER,
  unpaidBookingCopy,
  type ConfirmationHeaderCopy,
} from "@/lib/hotel-confirmation-status";
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
      { title: "Hotel Booking Status — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Your Fly n Feel Holidays hotel booking status, with your booking reference, hotel details, room, guests and payment summary.",
      },
      { property: "og:title", content: "Hotel Booking Status — Fly n Feel Holidays" },
      { property: "og:description", content: "Your hotel booking reference, status and stay details." },
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
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      const platform = typeof window === "undefined" ? undefined :
        (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
      // iOS may resume before the PayU return arrives. Pending is not success.
      if (IOS_PAYU_HANDOFF_ENABLED && isIosPayment(platform) && s === "awaiting_payment") return 5_000;
      return s === "payment_processing" || s === "booking_processing" || s === "confirming" ? 5_000 : false;
    },
    queryFn: ({ signal }) => hotelApi.getBooking(ref as string, guestToken, signal),
  });

  const rejectedStatus = booking.isError ? toBookingError(booking.error).status : undefined;
  const accessRejected = isAccessRejection(rejectedStatus);
  useEffect(() => {
    // The server refused this booking's saved pass: drop it for this booking only.
    if (ref && accessRejected) forgetHotelBookingGuestToken(ref);
  }, [ref, accessRejected]);

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
    // No usable pass (missing/expired, e.g. the app was closed or payment
    // returned in another browser): offer the existing reference + email
    // lookup. The server still decides who may see the booking.
    if (isAccessRejection(error.status)) {
      return (
        <Shell>
          <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
            <p className="font-display text-2xl">Find your booking</p>
            <p className="mt-2 text-sm text-muted-foreground">
              For your security, please enter your booking reference{" "}
              <span className="font-medium text-foreground">{ref}</span> and the email address you used at checkout.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button asChild>
                <Link to="/booking-lookup" search={{ ref: sanitizeBookingReference(ref) }}>
                  Look up my booking
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/account/bookings">My bookings</Link>
              </Button>
            </div>
          </div>
        </Shell>
      );
    }
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
  const confirming =
    data.status === "payment_processing" || data.status === "booking_processing" || data.status === "confirming";
  const onHold = data.status === "on_hold";
  const cancelPending = data.status === "cancellation_pending";
  const confirmed = data.status === "confirmed";
  const unpaid = data.status === "awaiting_payment" || data.status === "payment_failed";
  const failed = data.status === "failed" || data.status === "cancelled" || data.status === "expired";
  const header = confirmationHeaderCopy(data.status);
  const unpaidCopy = unpaid ? unpaidBookingCopy(data.status) : null;

  return (
    <Shell header={header}>
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
            {data.status === "payment_processing"
              ? "We're verifying your payment with PayU. Once it's confirmed, we book the room with the hotel."
              : "Your payment went through and the hotel is confirming the room now."} This page updates on its own —
            you can safely leave it open.
          </p>
          <Field className="mx-auto mt-6 max-w-xs" label="Booking reference" value={data.bookingReference} />
        </div>
      )}

      {onHold && <HoldPanel data={data} guestToken={guestToken} onDone={() => booking.refetch()} />}

      {cancelPending && (
        <Alert role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <AlertTitle>Cancellation in progress</AlertTitle>
          <AlertDescription>
            {data.statusMessage ?? "The hotel is processing your cancellation. We'll email you when it's final."}
          </AlertDescription>
        </Alert>
      )}

      {confirmed && data.canCancel && (
        <CancelButton data={data} guestToken={guestToken} onDone={() => booking.refetch()} />
      )}

      {unpaid && unpaidCopy && (
        <Alert role="status">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>{unpaidCopy.title}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{data.statusMessage ?? unpaidCopy.body}</p>
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

function Shell({ children, header }: { children: React.ReactNode; header?: ConfirmationHeaderCopy }) {
  const copy = header ?? NEUTRAL_CONFIRMATION_HEADER;
  return (
    <main className="relative min-h-svh bg-background text-foreground">
      <Nav />
      <section className="mx-auto max-w-7xl px-6 pb-20 pt-36 sm:pt-40 lg:pt-44">
        <SectionTitle
          eyebrow="Confirmation"
          title={
            <>
              {copy.title} <span className="italic gold-gradient">{copy.accent}</span>
            </>
          }
          subtitle={copy.subtitle}
        />
        <div className="mt-10">{children}</div>
      </section>
      <Footer />
    </main>
  );
}

function formatDeadline(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("en-IN");
}

function HoldPanel({
  data,
  guestToken,
  onDone,
}: {
  data: HotelBookingSummary;
  guestToken: string | null;
  onDone: () => void;
}) {
  const deadline = formatDeadline(data.holdDeadline);
  return (
    <div className="rounded-3xl border border-foreground/10 bg-card p-8 text-center">
      <Clock className="mx-auto size-8 text-gold" aria-hidden="true" />
      <h2 className="mt-4 font-display text-3xl">Your room is on hold</h2>
      <p className="mt-2 text-muted-foreground">
        {deadline
          ? `Confirm before ${deadline}, or the hotel releases the room automatically.`
          : "The hotel hasn't shared the hold deadline yet. This page updates on its own."}
      </p>
      <Field className="mx-auto mt-6 max-w-xs" label="Booking reference" value={data.bookingReference} />
      <p className="mt-4 text-sm text-muted-foreground">
        Our team is reviewing this booking and will contact you. Nothing more is needed from you here.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {data.canCancel && <CancelButton data={data} guestToken={guestToken} onDone={onDone} inline />}
      </div>
    </div>
  );
}

function CancelButton({
  data,
  guestToken,
  onDone,
  inline,
}: {
  data: HotelBookingSummary;
  guestToken: string | null;
  onDone: () => void;
  inline?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => hotelApi.cancel(data.bookingReference, guestToken),
    onSuccess: () => onDone(),
    onError: (e) => setError(toBookingError(e).message),
  });
  const button = (
    <Button
      type="button"
      variant="outline"
      disabled={cancel.isPending}
      onClick={() => {
        if (window.confirm("Cancel this booking? Cancellation charges may apply as per the hotel's policy.")) {
          cancel.mutate();
        }
      }}
    >
      {cancel.isPending ? "Cancelling…" : "Cancel booking"}
    </Button>
  );
  if (inline) return button;
  return (
    <div className="flex flex-col items-center gap-2">
      {button}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
