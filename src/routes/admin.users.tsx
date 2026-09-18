import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "@/components/admin/AdminShell";
import { useAdminAuth } from "@/lib/admin/admin-context";
import { demoAdminRoster } from "@/lib/admin/admin-mock";
import { useMockAnalytics } from "@/lib/analytics/analytics-api";
import {
  LEVEL_BY_ROLE,
  ROLE_BY_LEVEL,
  ROLE_LABEL,
  permissionsFor,
  type AdminLevel,
  type AdminRole,
} from "@/lib/admin/admin-roles";

/**
 * Owner-only administration of admin accounts.
 *
 * Roles are stored in a dedicated admin table and enforced by database policies
 * plus a server-side check on every admin endpoint. Changing a role in this UI
 * (or a request payload) cannot grant access on its own.
 */
export const Route = createFileRoute("/admin/users")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin users — Fly n Feel Admin" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Manage Fly n Feel admin accounts and access levels." },
      { property: "og:title", content: "Admin users — Fly n Feel Admin" },
      {
        property: "og:description",
        content: "Manage Fly n Feel admin accounts and access levels.",
      },
    ],
  }),
  component: AdminUsersPage,
});

const LEVELS: AdminLevel[] = [1, 2, 3];

function AdminUsersPage() {
  const { admin } = useAdminAuth();
  const [roster, setRoster] = useState(() => demoAdminRoster());
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <AdminShell
      title="Admin users"
      description="Who can sign in to this panel and what each level can do."
      permission="admins.manage"
    >
      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Admin</th>
              <th className="px-4 py-3 font-medium">Level</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Change level</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((entry) => (
              <tr key={entry.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{entry.displayName}</p>
                  <p className="text-xs text-muted-foreground">{entry.email}</p>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  Level {entry.level} · {ROLE_LABEL[entry.role]}
                </td>
                <td className="px-4 py-3 capitalize text-muted-foreground">{entry.status}</td>
                <td className="px-4 py-3">
                  <select
                    aria-label={`Access level for ${entry.email}`}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={entry.level}
                    disabled={entry.id === admin?.id}
                    onChange={(event) => {
                      const level = Number(event.target.value) as AdminLevel;
                      const role: AdminRole = ROLE_BY_LEVEL[level];
                      setRoster((current) =>
                        current.map((item) =>
                          item.id === entry.id ? { ...item, level, role } : item,
                        ),
                      );
                      setNotice(
                        useMockAnalytics
                          ? `${entry.email} set to Level ${level} for this test session only — real role changes are saved by the server.`
                          : `${entry.email} set to Level ${level}.`,
                      );
                    }}
                  >
                    {LEVELS.map((level) => (
                      <option key={level} value={level}>
                        Level {level} — {ROLE_LABEL[ROLE_BY_LEVEL[level]]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {notice ? <p className="mt-3 text-xs text-muted-foreground">{notice}</p> : null}

      <section className="mt-8 grid gap-4 lg:grid-cols-3">
        {(["staff", "manager", "owner"] as AdminRole[]).map((role) => (
          <div key={role} className="rounded-lg border border-border bg-background p-4">
            <p className="text-sm font-semibold text-foreground">
              Level {LEVEL_BY_ROLE[role]} — {ROLE_LABEL[role]}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {permissionsFor(role).map((permission) => (
                <li key={permission}>{permission}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <p className="mt-6 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        Real admin accounts are created against the live database when it is ready. Access is decided
        by the server on every request, so no one can reach Owner tools by editing the browser.
      </p>
    </AdminShell>
  );
}
