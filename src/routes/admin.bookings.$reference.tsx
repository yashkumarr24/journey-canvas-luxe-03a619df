import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { BookingTimeline } from "@/components/ops/BookingTimeline";
import {
  BookingStatusBadge,
  CancellationBadge,
  PaymentStatusBadge,
  RefundBadge,
  SupportStatusBadge,
  TestModePill,
} from "@/components/ops/OpsBadges";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/flight-search";
import { useAdminAuth } from "@/lib/admin/admin-context";
import { opsApi } from "@/lib/ops/ops-api";
import type { CancellationStatus, RefundStatus } from "@/types/operations";

/**
 * Admin booking detail: operational identity, statuses, provider reference
 * placeholders, timeline, cancellation/refund workflow, support cases and
 * internal notes.
 *
 * Internal notes are admin-only and never returned to a customer view. Approving
 * a cancellation records a decision; it does not call a provider and does not
 * move money — no gateway is connected.
 */
export const Route = createFileRoute("/admin/bookings/$reference")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Booking detail — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Operational detail for a single Fly n Feel booking." },
      { property: "og:title", content: "Booking detail — Fly n Feel Admin" },
      { property: "og:description", content: "Booking timeline, cancellation state, notes and cases." },
    ],
  }),
  component: AdminBookingDetailPage,
});

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function AdminBookingDetailPage() {
  const { reference } = Route.useParams();
  const { admin, can } = useAdminAuth();
  const adminName = admin?.displayName || admin?.email || "Admin";

  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<CancellationStatus>("approved");
  const [refund, setRefund] = useState<RefundStatus>("pending");
  const [decisionNote, setDecisionNote] = useState("");
  const [reply, setReply] = useState("");

  const booking = useQuery({
    queryKey: ["admin", "ops", "booking", reference],
    queryFn: () => opsApi.adminGetBooking(reference),
  });

  const addNote = useMutation({
    mutationFn: () => opsApi.adminAddNote(reference, note.trim(), { name: adminName, role: admin?.role ?? "staff" }),
    onSuccess: () => {
      setNote("");
      void booking.refetch();
    },
  });

  const updateCancellation = useMutation({
    mutationFn: () =>
      opsApi.adminUpdateCancellation(
        reference,
        { status: decision, refundStatus: refund, note: decisionNote.trim() || undefined },
        { name: adminName },
      ),
    onSuccess: () => {
      setDecisionNote("");
      void booking.refetch();
    },
  });

  const replyToCase = useMutation({
    mutationFn: (id: string) =>
      opsApi.adminUpdateSupport(id, { reply: reply.trim(), status: "in_progress" }, { name: adminName }),
    onSuccess: () => {
      setReply("");
      void booking.refetch();
    },
  });

  const detail = booking.data;

  return (
    <AdminShell
      title={`Booking ${reference}`}
      description="Everything the desk needs to work this booking."
      permission="bookings.view"
    >
      <Link
        to="/admin/bookings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All bookings
      </Link>

      {booking.isPending ? (
        <div className="h-64 animate-pulse rounded-lg border border-border bg-background" />
      ) : booking.isError || !detail ? (
        <div className="rounded-lg border border-destructive/30 bg-background p-4 text-sm">
          <p className="text-destructive">No booking with that reference is available.</p>
          <Button variant="outline" className="mt-3" onClick={() => void booking.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Summary">
            <div className="flex flex-wrap gap-2">
              <BookingStatusBadge status={detail.status} />
              <PaymentStatusBadge status={detail.paymentStatus} />
              <CancellationBadge status={detail.cancellationStatus} />
              <RefundBadge status={detail.refundStatus} />
              {detail.isTestMode ? <TestModePill /> : null}
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Product</dt>
                <dd className="capitalize text-foreground">{detail.product}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Destination</dt>
                <dd className="text-foreground">{detail.destination}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Summary</dt>
                <dd className="text-right text-foreground">{detail.summary}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Travel date</dt>
                <dd className="text-foreground">
                  {detail.travelDate ? new Date(detail.travelDate).toLocaleDateString("en-IN") : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="text-foreground">
                  {formatMoney(detail.totalAmount.amount, detail.totalAmount.currency)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Customer</dt>
                <dd className="text-right text-foreground">
                  {detail.contactEmail}
                  <span className="ml-2 text-xs capitalize text-muted-foreground">
                    {detail.customerType}
                  </span>
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Provider references">
            <dl className="space-y-1.5 text-sm">
              {detail.providerReferences.map((item) => (
                <div key={item.label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className="text-foreground">{item.value ?? "Pending integration"}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              These are filled in by the provider once live booking is connected.
            </p>
          </Panel>

          <Panel title="Timeline">
            <BookingTimeline events={detail.timeline} />
          </Panel>

          <Panel title="Cancellation &amp; refund">
            {detail.cancellation ? (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-2">
                  <CancellationBadge status={detail.cancellation.status} />
                  <RefundBadge status={detail.cancellation.refundStatus} />
                </div>
                <p className="text-muted-foreground">
                  Reason: {detail.cancellation.reason.replace(/_/g, " ")}
                  {detail.cancellation.comment ? ` — “${detail.cancellation.comment}”` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Requested {new Date(detail.cancellation.createdAt).toLocaleString("en-IN")}
                  {detail.cancellation.decidedBy ? ` · last updated by ${detail.cancellation.decidedBy}` : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No cancellation request on this booking.</p>
            )}

            {detail.cancellation && can("cancellations.manage") ? (
              <form
                className="mt-4 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  updateCancellation.mutate();
                }}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    aria-label="Cancellation decision"
                    value={decision}
                    onChange={(event) => setDecision(event.target.value as CancellationStatus)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="pending">Mark pending</option>
                    <option value="approved">Approve cancellation</option>
                    <option value="rejected">Reject cancellation</option>
                  </select>
                  <select
                    aria-label="Refund state"
                    value={refund}
                    onChange={(event) => setRefund(event.target.value as RefundStatus)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="not_applicable">Refund not applicable</option>
                    <option value="pending">Refund pending</option>
                    <option value="completed">Refund completed (recorded manually)</option>
                  </select>
                </div>
                <textarea
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Note shown to the customer (optional)"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  This records a decision only. No airline or hotel cancellation is sent and no
                  refund is issued until the provider and payment integrations are live.
                </p>
                <Button type="submit" disabled={updateCancellation.isPending}>
                  {updateCancellation.isPending ? "Saving…" : "Save decision"}
                </Button>
              </form>
            ) : detail.cancellation ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Managing cancellations is available to Manager and Owner levels.
              </p>
            ) : null}
          </Panel>

          <Panel title="Support cases">
            {detail.supportRequests.length ? (
              <ul className="space-y-3">
                {detail.supportRequests.map((request) => (
                  <li key={request.id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{request.subject}</p>
                      <SupportStatusBadge status={request.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {request.reference} · {request.category.replace(/_/g, " ")}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {request.messages.map((message) => (
                        <li key={message.id} className="text-muted-foreground">
                          <span className="text-foreground">
                            {message.author === "customer" ? "Customer" : message.authorName || "Desk"}
                            {message.internal ? " (internal)" : ""}:
                          </span>{" "}
                          {message.body}
                        </li>
                      ))}
                    </ul>
                    {can("support.manage") ? (
                      <form
                        className="mt-2 flex flex-wrap gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (reply.trim().length >= 2) replyToCase.mutate(request.id);
                        }}
                      >
                        <input
                          value={reply}
                          onChange={(event) => setReply(event.target.value)}
                          placeholder="Reply to the customer"
                          className="min-w-[12rem] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                        <Button type="submit" variant="outline" disabled={replyToCase.isPending}>
                          Send
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No support cases for this booking.</p>
            )}
          </Panel>

          <Panel title="Internal notes">
            <p className="text-xs text-muted-foreground">
              Visible to admins only — never to the customer. Never record card details, OTPs,
              passwords or API keys here.
            </p>
            {can("notes.manage") ? (
              <form
                className="mt-3 space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (note.trim().length >= 3) addNote.mutate();
                }}
              >
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  maxLength={800}
                  placeholder="Add an internal note"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <Button type="submit" variant="outline" disabled={addNote.isPending}>
                  {addNote.isPending ? "Saving…" : "Add note"}
                </Button>
              </form>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Adding notes is available to Manager and Owner levels.
              </p>
            )}
            <ul className="mt-3 space-y-2 text-sm">
              {detail.notes.length ? (
                detail.notes.map((item) => (
                  <li key={item.id} className="rounded-md border border-border p-3">
                    <p className="text-foreground">{item.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.authorName} ({item.authorRole}) ·{" "}
                      {new Date(item.createdAt).toLocaleString("en-IN")}
                    </p>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">No internal notes yet.</li>
              )}
            </ul>
          </Panel>
        </div>
      )}
    </AdminShell>
  );
}
