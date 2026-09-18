import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock, FlaskConical, Loader2, Lock, ShieldCheck } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SectionTitle } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ItinerarySummary } from "@/components/booking/ItinerarySummary";
import { FareBreakdown } from "@/components/booking/FareBreakdown";
import { TravellerSummary } from "@/components/booking/TravellerSummary";
import { PaymentMethods } from "@/components/booking/PaymentMethods";
import { TestPaymentSheet } from "@/components/booking/TestPaymentSheet";
import { checkoutApi, useTestCheckout } from "@/lib/checkout-api";
import { useAnalytics, useTrackOnce } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { readBookingGuestToken } from "@/lib/checkout-session";
import { newIdempotencyKey } from "@/lib/review-session";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { toBookingError } from "@/lib/booking-api";
import { formatMoney } from "@/lib/flight-search";
import type { PaymentOrder } from "@/types/booking";

/**
 * Checkout / payment.
 *
 * The payable amount rendered here is the server's, read back from the booking
 * summary. Nothing on this page posts an amount, a fare id or a provider
 * credential; the browser only forwards the provider's acknowledgement so the
 * backend can verify it and issue the booking.
 */

type Search = { ref?: string };

type Stage =
  | "idle"
  | "creating_order"
  | "awaiting_payment"
  | "processing"
  | "booking"
  | "failed"
  | "cancelled";

export const Route = createFileRoute("/flights/checkout")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ref: typeof search.ref === "string" ? search.ref.slice(0, 64) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Secure Checkout — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Review your booking summary, fare breakdown and traveller details, then pay securely to confirm your Fly n Feel Holidays flight.",
      },
      { property: "og:title", content: "Secure Checkout — Fly n Feel Holidays" },
      { property: "og:description", content: "Pay securely to confirm your flight booking." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { ref } = Route.useSearch();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>("idle");
  const [method, setMethod] = useState("upi");
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [testSheet, setTestSheet] = useState<PaymentOrder | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const guestToken = ref ? readBookingGuestToken(ref) : null;

  const booking = useQuery({
    queryKey: ["booking", ref],
    enabled: Boolean(ref),
    staleTime: 0,
    retry: false,
    queryFn: ({ signal }) => checkoutApi.getBooking(ref as string, guestToken, signal),
  });

  const data = booking.data;

  // Align the default method with what the backend actually offers.
  useEffect(() => {
    const first = data?.paymentMethods?.find((option) => option.enabled);
    if (first && !data?.paymentMethods?.some((option) => option.id === method && option.enabled)) {
      setMethod(first.id);
    }
  }, [data, method]);

  const confirm = useMutation({
    mutationFn: (payload: { paymentId: string; orderId: string; signature?: string }) => {
      setStage("booking");
      return checkoutApi.confirmPayment({
        bookingReference: ref as string,
        guestToken: guestToken ?? undefined,
        provider: useTestCheckout ? "test" : "razorpay",
        orderId: payload.orderId,
        paymentId: payload.paymentId,
        signature: payload.signature,
        idempotencyKey,
      });
    },
    onSuccess: (result) => {
      if (result.status === "confirmed" || result.status === "booking_processing") {
        navigate({ to: "/flights/confirmation", search: { ref: result.booking.bookingReference } });
        return;
      }
      setStage("failed");
      setMessage(result.message ?? result.booking.statusMessage ?? null);
      // A fresh attempt must not reuse the previous idempotency key.
      setIdempotencyKey(newIdempotencyKey());
      booking.refetch();
    },
    onError: (error) => {
      setStage("failed");
      setMessage(toBookingError(error).message);
      setIdempotencyKey(newIdempotencyKey());
    },
  });

  const reportFailure = (reason: "cancelled" | "failed", note?: string) => {
    if (!ref) return;
    checkoutApi
      .reportFailure({
        bookingReference: ref,
        guestToken: guestToken ?? undefined,
        orderId: order?.orderId,
        reason,
        message: note,
      })
      .catch(() => undefined)
      .finally(() => booking.refetch());
  };

  const pay = useMutation({
    mutationFn: () => {
      setStage("creating_order");
      setMessage(null);
      return checkoutApi.createOrder({
        bookingReference: ref as string,
        guestToken: guestToken ?? undefined,
        method,
        idempotencyKey,
      });
    },
    onSuccess: async (created) => {
      setOrder(created);
      setStage("awaiting_payment");

      const opened = await openRazorpayCheckout(created, {
        onAuthorised: (result) => confirm.mutate(result),
        onFailed: (reason) => {
          setStage("failed");
          setMessage(reason ?? "The payment did not go through. No money has been taken.");
          reportFailure("failed", reason);
        },
        onDismissed: () => {
          setStage("cancelled");
          setMessage("You closed the payment window before paying. Your fare is still held.");
          reportFailure("cancelled");
        },
      });

      // No provider sheet available yet — rehearse the same journey locally.
      if (!opened) setTestSheet(created);
    },
    onError: (error) => {
      setStage("failed");
      setMessage(toBookingError(error).message);
    },
  });

  if (!ref) {
    return (
      <Shell>
        <EmptyState
          title="No booking to pay for"
          body="Start a new search to choose your flight and traveller details."
        />
      </Shell>
    );
  }

  if (booking.isPending) {
    return (
      <Shell>
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <Skeleton className="h-44 w-full rounded-3xl" />
            <Skeleton className="h-56 w-full rounded-3xl" />
          </div>
          <Skeleton className="h-80 w-full rounded-3xl" />
        </div>
      </Shell>
    );
  }

  if (booking.isError || !data) {
    const error = toBookingError(booking.error);
    return (
      <Shell>
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>We couldn't open this checkout</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error.message}</p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => booking.refetch()}>
                Try again
              </Button>
              <Button asChild size="sm">
                <Link to="/flights">Search flights</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const busy =
    stage === "creating_order" || stage === "awaiting_payment" || stage === "processing" || stage === "booking";
  const expired = data.status === "expired" || data.status === "cancelled";
  const payable = data.totalPayable;

  if (busy) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg rounded-3xl border border-foreground/10 bg-card p-10 text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-gold" aria-hidden="true" />
          <h2 className="mt-5 font-display text-3xl" aria-live="polite">
            {stage === "creating_order" && "Preparing your payment…"}
            {stage === "awaiting_payment" && "Waiting for your payment…"}
            {stage === "processing" && "Confirming your payment…"}
            {stage === "booking" && "Confirming your booking…"}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            {stage === "booking"
              ? "We're issuing your seats with the airline. This can take up to a minute — please don't close or refresh this page."
              : "Please don't close or refresh this page."}
          </p>
          <p className="mt-6 font-display text-2xl">{formatMoney(payable.amount, payable.currency)}</p>
        </div>

        {useTestCheckout && (
          <TestPaymentSheet
            order={testSheet}
            onAuthorise={(paymentId) => {
              setTestSheet(null);
              setStage("processing");
              confirm.mutate({ paymentId, orderId: (order ?? testSheet)?.orderId ?? "" });
            }}
            onFail={() => {
              setTestSheet(null);
              setStage("failed");
              setMessage("The payment was declined. No money has been taken.");
              reportFailure("failed", "Declined in test mode");
            }}
            onDismiss={() => {
              setTestSheet(null);
              setStage("cancelled");
              setMessage("You closed the payment window before paying. Your fare is still held.");
              reportFailure("cancelled");
            }}
          />
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      {useTestCheckout && (
        <Alert className="mb-6" role="status">
          <FlaskConical className="size-4" aria-hidden="true" />
          <AlertTitle>Test payment mode</AlertTitle>
          <AlertDescription>
            Payments aren't live yet, so this step is a rehearsal — no card details are collected and no money
            moves. Everything else behaves exactly as it will on the day.
          </AlertDescription>
        </Alert>
      )}

      {data.priceChange?.direction === "increase" && (
        <Alert className="mb-6" role="status">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>The airline re-priced this fare</AlertTitle>
          <AlertDescription>
            The amount payable is now{" "}
            {formatMoney(data.priceChange.current.amount, data.priceChange.current.currency)} —{" "}
            {formatMoney(data.priceChange.difference.amount, data.priceChange.difference.currency)} more than
            when you searched.
          </AlertDescription>
        </Alert>
      )}

      {(stage === "failed" || stage === "cancelled" || data.status === "payment_failed") && (
        <Alert
          variant={stage === "cancelled" ? "default" : "destructive"}
          className="mb-6"
          role="alert"
        >
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {stage === "cancelled" ? "Payment not completed" : "That payment didn't go through"}
          </AlertTitle>
          <AlertDescription>
            {message ?? data.statusMessage ?? "No money has been taken. You can try paying again."}
          </AlertDescription>
        </Alert>
      )}

      {expired && (
        <Alert variant="destructive" className="mb-6" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>This fare is no longer held</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              {data.statusMessage ??
                "The airline released this fare before payment was completed. Please search again for current prices."}
            </p>
            <Button asChild size="sm">
              <Link to="/flights">Search again</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-8">
          <section className="rounded-3xl border border-foreground/10 bg-card px-5 sm:px-6">
            <ItinerarySummary itineraries={data.itineraries} />
          </section>

          <section className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
            <TravellerSummary travellers={data.travellers} contact={data.contact} />
          </section>

          <section className="rounded-3xl border border-foreground/10 bg-card p-5 sm:p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Payment method</p>
            <div className="mt-4">
              <PaymentMethods
                methods={data.paymentMethods ?? []}
                value={method}
                onChange={setMethod}
                disabled={expired}
              />
            </div>
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="size-3.5" aria-hidden="true" />
              Card and bank details are entered on the payment provider's secure window — we never see or store
              them.
            </p>
          </section>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border border-foreground/10 bg-card p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Booking {data.bookingReference}
            </p>
            <div className="mt-4">
              <FareBreakdown
                breakdown={data.breakdown}
                totalPayable={payable}
                passengers={data.passengers}
                footnote={data.expiresAt ? "Pay before the hold expires" : undefined}
              />
            </div>

            {data.expiresAt && (
              <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden="true" />
                Fare held until {new Date(data.expiresAt).toLocaleString("en-IN")}
              </p>
            )}

            <Button
              type="button"
              size="lg"
              className="mt-6 w-full"
              disabled={expired || pay.isPending}
              onClick={() => pay.mutate()}
            >
              {stage === "failed" || stage === "cancelled" || data.status === "payment_failed"
                ? "Try payment again"
                : `Pay ${formatMoney(payable.amount, payable.currency)}`}
            </Button>

            <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Your seats are issued only after payment is confirmed. If issuing fails, you're refunded in full.
            </p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-foreground/15 p-10 text-center">
      <p className="font-display text-2xl">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <Button asChild className="mt-6">
        <Link to="/flights">Search flights</Link>
      </Button>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-svh bg-background text-foreground">
      <Nav />
      <section className="mx-auto max-w-7xl px-6 pb-20 pt-36 sm:pt-40 lg:pt-44">
        <SectionTitle
          eyebrow="Checkout"
          title={
            <>
              One last look, <span className="italic gold-gradient">then you're flying.</span>
            </>
          }
          subtitle="Check the journey, the travellers and the total — then pay securely to confirm."
        />
        <div className="mt-10">{children}</div>
      </section>
      <Footer />
    </main>
  );
}
