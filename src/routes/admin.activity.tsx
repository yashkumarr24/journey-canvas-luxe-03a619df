import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin/AdminShell";
import { LiveActivityTable } from "@/components/admin/LiveActivityTable";
import { useAdminSnapshot } from "@/lib/admin/admin-api";
import { liveActivity } from "@/lib/analytics/admin-analytics";

/** Full live activity feed — who is on the platform and what they are doing. */
export const Route = createFileRoute("/admin/activity")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Live activity — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Real-time visitor activity across Fly n Feel." },
      { property: "og:title", content: "Live activity — Fly n Feel Admin" },
      { property: "og:description", content: "Real-time visitor activity across Fly n Feel." },
    ],
  }),
  component: AdminActivityPage,
});

function AdminActivityPage() {
  const { snapshot, revision, error } = useAdminSnapshot();
  const rows = useMemo(() => liveActivity(snapshot, 100), [snapshot, revision]);

  return (
    <AdminShell
      title="Live activity"
      description="Most recent visitors first. A green dot means the visitor has been active in the last 30 minutes."
      permission="activity.view"
    >
      {error ? (
        <p className="mb-4 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
          {error}
        </p>
      ) : null}
      <LiveActivityTable rows={rows} />
    </AdminShell>
  );
}
