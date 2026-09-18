import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SupportStatusBadge } from "@/components/ops/OpsBadges";
import { useAuth } from "@/lib/auth/auth-context";
import { opsApi } from "@/lib/ops/ops-api";
import { privateKeys } from "@/lib/auth/query-keys";
import type { SupportCategory } from "@/types/operations";

/**
 * Customer support requests: open a case, follow its status, reply.
 *
 * Internal admin replies are filtered out server-side and never reach this view.
 * There is no live chat in this phase.
 */
export const Route = createFileRoute("/_authenticated/account/support")({
  component: SupportPage,
});

const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: "flight_booking", label: "Flight booking" },
  { value: "hotel_booking", label: "Hotel booking" },
  { value: "payment", label: "Payment" },
  { value: "cancellation", label: "Cancellation" },
  { value: "refund", label: "Refund" },
  { value: "documents", label: "Ticket / voucher" },
  { value: "general", label: "General issue" },
];

function SupportPage() {
  const { userId, email } = useAuth();
  const queryClient = useQueryClient();
  const supportKey = [...privateKeys.all(userId ?? "anon"), "support"] as const;

  const [category, setCategory] = useState<SupportCategory>("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [bookingReference, setBookingReference] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const bookings = useQuery({
    queryKey: [...privateKeys.bookings(userId ?? "anon"), "for-support"],
    queryFn: () => opsApi.listBookings({ limit: 50 }, { userId }),
    enabled: Boolean(userId),
  });

  const requests = useQuery({
    queryKey: supportKey,
    queryFn: () => opsApi.listSupport({ userId }),
    enabled: Boolean(userId),
  });

  const create = useMutation({
    mutationFn: () =>
      opsApi.createSupportRequest(
        {
          category,
          subject: subject.trim(),
          message: message.trim(),
          bookingReference: bookingReference || null,
        },
        { userId, email: email ?? "" },
      ),
    onSuccess: () => {
      setSubject("");
      setMessage("");
      setBookingReference("");
      void queryClient.invalidateQueries({ queryKey: supportKey });
    },
  });

  const addMessage = useMutation({
    mutationFn: (id: string) => opsApi.addSupportMessage(id, reply.trim(), { userId }),
    onSuccess: () => {
      setReply("");
      void queryClient.invalidateQueries({ queryKey: supportKey });
    },
  });

  const valid = subject.trim().length >= 4 && message.trim().length >= 10;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
        <h2 className="flex items-center gap-2 font-display text-xl tracking-tight text-foreground">
          <LifeBuoy className="size-4 text-gold" aria-hidden />
          Open a support request
        </h2>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <label className="text-sm">
            <span className="text-muted-foreground">Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as SupportCategory)}
              className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
            >
              {CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted-foreground">Related booking (optional)</span>
            <select
              value={bookingReference}
              onChange={(event) => setBookingReference(event.target.value)}
              className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
            >
              <option value="">Not about a specific booking</option>
              {(bookings.data?.items ?? []).map((booking) => (
                <option key={booking.bookingReference} value={booking.bookingReference}>
                  {booking.bookingReference} — {booking.destination}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted-foreground">Subject</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted-foreground">How can we help?</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              maxLength={1500}
              className="mt-1 w-full rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
            />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Please don&apos;t include card numbers, CVV, OTPs or passwords — our team never needs them.
          </p>
          {create.isError ? (
            <p className="text-sm text-red-700 sm:col-span-2">
              We couldn&apos;t submit that request. Please try again.
            </p>
          ) : null}
          {create.isSuccess ? (
            <p className="text-sm text-emerald-700 sm:col-span-2" aria-live="polite">
              Request submitted. You&apos;ll see it in the list below.
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-5 shadow-[var(--shadow-soft)]">
        <h2 className="font-display text-xl tracking-tight text-foreground">Your requests</h2>

        {requests.isPending ? (
          <div className="mt-4 h-24 animate-pulse rounded-xl bg-foreground/5" />
        ) : requests.isError ? (
          <div className="mt-4 text-sm text-red-700">
            <p>We couldn&apos;t load your requests.</p>
            <Button variant="outline" className="mt-2" onClick={() => void requests.refetch()}>
              Try again
            </Button>
          </div>
        ) : requests.data?.length ? (
          <ul className="mt-4 space-y-3">
            {requests.data.map((request) => (
              <li key={request.id} className="rounded-xl border border-foreground/10 bg-background/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{request.subject}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {request.reference}
                      {request.bookingReference ? ` · ${request.bookingReference}` : ""} ·{" "}
                      {new Date(request.updatedAt).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <SupportStatusBadge status={request.status} />
                </div>

                <button
                  type="button"
                  className="mt-2 text-xs text-gold underline underline-offset-4"
                  onClick={() => setOpenId(openId === request.id ? null : request.id)}
                >
                  {openId === request.id ? "Hide conversation" : "View conversation"}
                </button>

                {openId === request.id ? (
                  <div className="mt-3 space-y-2">
                    {request.messages.map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded-lg px-3 py-2 text-sm ${
                          entry.author === "customer"
                            ? "bg-foreground/5 text-foreground"
                            : "bg-gold/10 text-foreground"
                        }`}
                      >
                        <p className="text-xs text-muted-foreground">
                          {entry.author === "customer" ? "You" : entry.authorName || "Fly n Feel desk"} ·{" "}
                          {new Date(entry.createdAt).toLocaleString("en-IN")}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">{entry.body}</p>
                      </div>
                    ))}
                    {request.status !== "closed" ? (
                      <form
                        className="flex flex-wrap gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (reply.trim().length >= 2) addMessage.mutate(request.id);
                        }}
                      >
                        <input
                          value={reply}
                          onChange={(event) => setReply(event.target.value)}
                          placeholder="Add a reply"
                          maxLength={1000}
                          className="min-w-[12rem] flex-1 rounded-xl border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-gold"
                        />
                        <Button type="submit" variant="outline" disabled={addMessage.isPending}>
                          Send
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            You haven&apos;t opened any support requests yet.
          </p>
        )}
      </section>
    </div>
  );
}
