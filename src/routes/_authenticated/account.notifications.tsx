import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, CheckCheck, LifeBuoy, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DeliveryBadge,
  formatNotificationTime,
} from "@/components/notifications/NotificationBadges";
import { useAnalytics } from "@/lib/analytics/tracker";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";
import { useAuth } from "@/lib/auth/auth-context";
import { privateKeys } from "@/lib/auth/query-keys";
import { notificationsApi, useMockNotifications } from "@/lib/notifications/notifications-api";
import { subscribeOpsStore } from "@/lib/ops/ops-store";

/**
 * PHASE 13 — customer notification centre.
 *
 * Reads through the notifications API boundary, which resolves ownership from
 * the signed-in session. No provider is contacted from the browser, and no
 * message body here carries a card detail, OTP or document number.
 */
export const Route = createFileRoute("/_authenticated/account/notifications")({
  component: NotificationsPage,
});

function NotificationsPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const { track } = useAnalytics();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const key = useMemo(
    () => [...privateKeys.all(userId ?? "anon"), "notifications", unreadOnly] as const,
    [userId, unreadOnly],
  );

  const notifications = useQuery({
    queryKey: key,
    queryFn: () => notificationsApi.list({ unreadOnly, limit: 50 }),
    enabled: Boolean(userId),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: [...privateKeys.all(userId ?? "anon"), "notifications"],
    });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  });

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  });

  useEffect(() => {
    track(ANALYTICS_EVENTS.notificationCenterViewed);
  }, [track]);

  // In demo mode the records live in the shared local store, so a booking made
  // in another tab shows up here without a refresh.
  useEffect(() => {
    if (!useMockNotifications) return;
    return subscribeOpsStore(() => invalidate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const items = notifications.data ?? [];
  const unread = items.filter((item) => !item.readAt).length;

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl tracking-tight text-foreground">
            <Bell className="size-4 text-gold" aria-hidden />
            Notifications
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Booking, payment, cancellation and support updates. {unread} unread.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUnreadOnly((value) => !value)}
            aria-pressed={unreadOnly}
          >
            {unreadOnly ? "Show all" : "Unread only"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAll.mutate()}
            disabled={unread === 0 || markAll.isPending}
          >
            <CheckCheck className="mr-2 size-4" aria-hidden />
            Mark all as read
          </Button>
        </div>
      </header>

      {useMockNotifications ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800">
          Demo mode — email, SMS and WhatsApp are not connected yet. Updates are
          recorded and shown here; nothing is sent outside the app.
        </p>
      ) : null}

      {notifications.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your notifications…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-foreground/10 bg-[#F8F8F6] p-8 text-center shadow-[var(--shadow-soft)]">
          <BellOff className="mx-auto size-5 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">
            {unreadOnly ? "Nothing unread right now." : "You have no notifications yet."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded-2xl border p-4 shadow-[var(--shadow-soft)] ${
                item.readAt
                  ? "border-foreground/10 bg-[#F8F8F6]"
                  : "border-gold/40 bg-[#FDFDFB]"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-foreground">
                    {item.readAt ? null : (
                      <span className="size-1.5 shrink-0 rounded-full bg-gold" aria-label="Unread" />
                    )}
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                  <p className="mt-2 text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground">
                    {formatNotificationTime(item.createdAt)}
                  </p>
                </div>
                {item.readAt ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markRead.mutate(item.id)}
                    disabled={markRead.isPending}
                  >
                    Mark as read
                  </Button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(item.deliveries ?? []).map((delivery) => (
                  <DeliveryBadge key={delivery.channel} delivery={delivery} />
                ))}
              </div>

              {item.bookingReference || item.supportRequestId ? (
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  {item.bookingReference ? (
                    <Link
                      to="/account/bookings/$reference"
                      params={{ reference: item.bookingReference }}
                      className="inline-flex items-center gap-1.5 text-foreground underline decoration-gold/50 underline-offset-4"
                    >
                      <Ticket className="size-3.5" aria-hidden />
                      Booking {item.bookingReference}
                    </Link>
                  ) : null}
                  {item.supportRequestId ? (
                    <Link
                      to="/account/support"
                      className="inline-flex items-center gap-1.5 text-foreground underline decoration-gold/50 underline-offset-4"
                    >
                      <LifeBuoy className="size-3.5" aria-hidden />
                      Open support request
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
