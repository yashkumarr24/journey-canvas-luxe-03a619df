import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import {
  DeliveryBadge,
  formatNotificationTime,
} from "@/components/notifications/NotificationBadges";
import { useAdminAuth } from "@/lib/admin/admin-context";
import { notificationsApi, useMockNotifications } from "@/lib/notifications/notifications-api";
import { subscribeOpsStore } from "@/lib/ops/ops-store";
import type { NotificationAudience } from "@/types/notifications";

/**
 * PHASE 13 — admin notification desk.
 *
 * Level 1 can read the notification log. Retrying a failed delivery needs
 * Level 2+, enforced server-side (`require_admin(2)`) and by RLS as well as in
 * this UI. Nothing here can create a booking, move money or change a payment:
 * a retry only re-attempts a message.
 */
export const Route = createFileRoute("/admin/notifications")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Notifications — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Operational notification log and delivery states for Fly n Feel bookings.",
      },
      { property: "og:title", content: "Notifications — Fly n Feel Admin" },
      {
        property: "og:description",
        content: "Review notification delivery states across bookings, payments and support.",
      },
    ],
  }),
  component: AdminNotificationsPage,
});

const AUDIENCES: { value: NotificationAudience; label: string }[] = [
  { value: "admin", label: "Operations alerts" },
  { value: "customer", label: "Customer messages" },
];

function AdminNotificationsPage() {
  const { can } = useAdminAuth();
  const queryClient = useQueryClient();
  const [audience, setAudience] = useState<NotificationAudience>("admin");
  const [failedOnly, setFailedOnly] = useState(false);

  const list = useQuery({
    queryKey: ["admin", "notifications", audience],
    queryFn: () => notificationsApi.adminList({ audience, limit: 100 }),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["admin", "notifications"] });

  const retry = useMutation({
    mutationFn: (id: string) => notificationsApi.adminRetry(id),
    onSuccess: invalidate,
  });

  useEffect(() => {
    if (!useMockNotifications) return;
    return subscribeOpsStore(() => invalidate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = (list.data ?? []).filter((item) =>
    failedOnly
      ? (item.deliveries ?? []).some((d) => d.state === "failed" || d.state === "retrying")
      : true,
  );

  return (
    <AdminShell
      title="Notifications"
      description="Notification log and delivery states. Retrying a message never changes a booking or a payment."
      permission="bookings.view"
    >
      <div className="flex flex-wrap items-center gap-2">
        {AUDIENCES.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={audience === option.value ? "default" : "outline"}
            onClick={() => setAudience(option.value)}
          >
            {option.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={failedOnly ? "default" : "outline"}
          onClick={() => setFailedOnly((value) => !value)}
        >
          Needs attention
        </Button>
      </div>

      {useMockNotifications ? (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800">
          Demo mode — no email, SMS or WhatsApp provider is connected. Delivery
          states below describe local attempts only.
        </p>
      ) : null}

      <div className="mt-5 space-y-3">
        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading notifications…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notifications match this filter.</p>
        ) : (
          items.map((item) => {
            const needsAttention = (item.deliveries ?? []).some(
              (d) => d.state === "failed" || d.state === "retrying",
            );
            return (
              <article
                key={item.id}
                className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-4 shadow-[var(--shadow-soft)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                    <p className="mt-2 text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground">
                      {item.type.replace(/_/g, " ")} · {formatNotificationTime(item.createdAt)}
                    </p>
                  </div>
                  {needsAttention && can("bookings.manage") ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retry.mutate(item.id)}
                      disabled={retry.isPending}
                    >
                      <RefreshCw className="mr-2 size-4" aria-hidden />
                      Retry delivery
                    </Button>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(item.deliveries ?? []).map((delivery) => (
                    <DeliveryBadge key={delivery.channel} delivery={delivery} />
                  ))}
                </div>

                {item.bookingReference ? (
                  <Link
                    to="/admin/bookings/$reference"
                    params={{ reference: item.bookingReference }}
                    className="mt-3 inline-block text-sm text-foreground underline decoration-gold/50 underline-offset-4"
                  >
                    Booking {item.bookingReference}
                  </Link>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </AdminShell>
  );
}
