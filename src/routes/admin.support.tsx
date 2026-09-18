import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";

import { AdminShell } from "@/components/admin/AdminShell";
import { SupportStatusBadge } from "@/components/ops/OpsBadges";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/lib/admin/admin-context";
import { opsApi } from "@/lib/ops/ops-api";
import type { SupportStatus } from "@/types/operations";

/**
 * Admin support management: search, filter, open a case, reply, change status.
 *
 * Level 1 can read cases. Replying and changing status needs Level 2+, enforced
 * server-side as well as in this UI.
 */
export const Route = createFileRoute("/admin/support")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Support — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Customer support cases for Fly n Feel bookings." },
      { property: "og:title", content: "Support — Fly n Feel Admin" },
      { property: "og:description", content: "Work customer support cases across flights and hotels." },
    ],
  }),
  component: AdminSupportPage,
});

const STATUSES: { value: SupportStatus | "all"; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_customer", label: "Waiting for customer" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const CATEGORIES = [
  "all",
  "flight_booking",
  "hotel_booking",
  "payment",
  "cancellation",
  "refund",
  "documents",
  "general",
];

function AdminSupportPage() {
  const { admin, can } = useAdminAuth();
  const adminName = admin?.displayName || admin?.email || "Admin";

  const [status, setStatus] = useState<SupportStatus | "all">("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);

  const requests = useQuery({
    queryKey: ["admin", "ops", "support", status, category, search],
    queryFn: () => opsApi.adminListSupport({ status, category, search: search.trim() || undefined }),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; patch: { status?: SupportStatus; reply?: string; internal?: boolean } }) =>
      opsApi.adminUpdateSupport(input.id, input.patch, { name: adminName }),
    onSuccess: () => {
      setReply("");
      void requests.refetch();
    },
  });

  return (
    <AdminShell
      title="Support"
      description="Customer cases, newest activity first. Level 1 can read; replying and status changes need Level 2 or above."
      permission="support.view"
    >
      <div className="mb-4 grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Reference, subject, booking or email"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as SupportStatus | "all")}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {STATUSES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "Any category" : item.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {requests.isPending ? (
        <div className="h-40 animate-pulse rounded-lg border border-border bg-background" />
      ) : requests.isError ? (
        <div className="rounded-lg border border-destructive/30 bg-background p-4 text-sm">
          <p className="text-destructive">We couldn&apos;t load support cases.</p>
          <Button variant="outline" className="mt-3" onClick={() => void requests.refetch()}>
            Try again
          </Button>
        </div>
      ) : requests.data?.length ? (
        <ul className="space-y-3">
          {requests.data.map((request) => (
            <li key={request.id} className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{request.subject}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {request.reference} · {request.category.replace(/_/g, " ")} · {request.contactEmail} (
                    {request.customerType}) · updated{" "}
                    {new Date(request.updatedAt).toLocaleString("en-IN")}
                  </p>
                  {request.bookingReference ? (
                    <Link
                      to="/admin/bookings/$reference"
                      params={{ reference: request.bookingReference }}
                      className="mt-1 inline-block text-xs text-foreground underline underline-offset-4"
                    >
                      Open booking {request.bookingReference}
                    </Link>
                  ) : null}
                </div>
                <SupportStatusBadge status={request.status} />
              </div>

              <button
                type="button"
                className="mt-2 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                onClick={() => setOpenId(openId === request.id ? null : request.id)}
              >
                {openId === request.id ? "Hide conversation" : "Open conversation"}
              </button>

              {openId === request.id ? (
                <div className="mt-3 space-y-3">
                  <ul className="space-y-2 text-sm">
                    {request.messages.map((message) => (
                      <li key={message.id} className="rounded-md border border-border p-2.5">
                        <p className="text-xs text-muted-foreground">
                          {message.author === "customer" ? "Customer" : message.authorName || "Desk"}
                          {message.internal ? " · internal" : ""} ·{" "}
                          {new Date(message.createdAt).toLocaleString("en-IN")}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-foreground">{message.body}</p>
                      </li>
                    ))}
                  </ul>

                  {can("support.manage") ? (
                    <form
                      className="space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (reply.trim().length >= 2) {
                          update.mutate({ id: request.id, patch: { reply: reply.trim(), internal } });
                        }
                      }}
                    >
                      <textarea
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        rows={2}
                        maxLength={1500}
                        placeholder="Reply to the customer"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={internal}
                          onChange={(event) => setInternal(event.target.checked)}
                        />
                        Internal note on this case (not shown to the customer)
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="submit" variant="outline" disabled={update.isPending}>
                          Send
                        </Button>
                        <select
                          aria-label="Set status"
                          value={request.status}
                          onChange={(event) =>
                            update.mutate({
                              id: request.id,
                              patch: { status: event.target.value as SupportStatus },
                            })
                          }
                          className="rounded-md border border-input bg-background px-2 py-2 text-sm"
                        >
                          {STATUSES.filter((item) => item.value !== "all").map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </form>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Replying and status changes are available to Manager and Owner levels.
                    </p>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-border bg-background px-4 py-6 text-sm text-muted-foreground">
          No support cases match these filters.
        </p>
      )}
    </AdminShell>
  );
}
