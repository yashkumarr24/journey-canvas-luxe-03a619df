/**
 * Live activity feed: session -> current page -> current activity -> time.
 *
 * Shows only operational information. No email, no name, no phone, no booking
 * amount — a truncated user id is the strongest identifier displayed.
 */

import { Link } from "@tanstack/react-router";

import { eventLabel, pageLabel } from "@/lib/analytics/events";
import type { LiveActivityRow } from "@/lib/analytics/admin-analytics";

function ago(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "—";
  const seconds = Math.max(0, Math.round(diff / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function LiveActivityTable({
  rows,
  emptyHint = "No activity recorded yet. Browse the site in another tab and it appears here.",
}: {
  rows: LiveActivityRow[];
  emptyHint?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Visitor</th>
            <th className="px-4 py-3 font-medium">Current page</th>
            <th className="px-4 py-3 font-medium">Latest activity</th>
            <th className="px-4 py-3 font-medium">Device</th>
            <th className="px-4 py-3 font-medium">When</th>
            <th className="px-4 py-3 font-medium sr-only">Journey</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sessionId} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className={
                      row.active
                        ? "size-2 rounded-full bg-emerald-500"
                        : "size-2 rounded-full bg-muted-foreground/40"
                    }
                  />
                  <span className="font-medium text-foreground">{row.identity}</span>
                  {row.userIdShort ? (
                    <span className="text-xs text-muted-foreground">{row.userIdShort}</span>
                  ) : null}
                </span>
              </td>
              <td className="px-4 py-3 text-foreground">{pageLabel(row.currentPage)}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.lastEventName ? eventLabel(row.lastEventName) : "—"}
              </td>
              <td className="px-4 py-3 text-muted-foreground capitalize">
                {row.device} · {row.browser}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                {ago(row.lastActivityAt)}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  to="/admin/sessions"
                  search={{ session: row.sessionId }}
                  className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Journey
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
