/**
 * Admin Panel frame + client-side gate.
 *
 * Intended to be served from admin.flynfeelholidays.com later; today it lives
 * under /admin so no DNS is required. The customer site (www) never links here.
 *
 * IMPORTANT: this gate is convenience only. It hides screens a signed-out or
 * under-privileged visitor should not see, but every number on them is fetched
 * through an endpoint that re-checks the admin level server-side, and the
 * underlying tables are protected by RLS. Editing this file in a browser grants
 * no data.
 */

import { useEffect, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Filter,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  LogOut,
  ShieldCheck,
  Ticket,
  Users,
} from "lucide-react";

import { useAdminAuth } from "@/lib/admin/admin-context";
import { ROLE_LABEL, type AdminPermission } from "@/lib/admin/admin-roles";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: AdminPermission;
}

const NAV: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
  { to: "/admin/activity", label: "Live activity", icon: Activity, permission: "activity.view" },
  { to: "/admin/sessions", label: "Sessions", icon: Users, permission: "activity.view" },
  { to: "/admin/funnel", label: "Booking funnel", icon: Filter, permission: "analytics.view" },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.view" },
  { to: "/admin/bookings", label: "Bookings", icon: Ticket, permission: "bookings.view" },
  {
    to: "/admin/booking-activity",
    label: "Booking activity",
    icon: Activity,
    permission: "bookings.view",
  },
  { to: "/admin/support", label: "Support", icon: LifeBuoy, permission: "support.view" },
  { to: "/admin/users", label: "Admin users", icon: ShieldCheck, permission: "admins.manage" },
];

export function AdminShell({
  title,
  description,
  /** Minimum permission needed for this screen. */
  permission,
  children,
}: {
  title: string;
  description?: string;
  permission: AdminPermission;
  children: ReactNode;
}) {
  const { status, admin, isDemoMode, signOut, can } = useAdminAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (status === "unauthenticated") {
      void navigate({ to: "/admin/login", replace: true });
    }
  }, [status, navigate]);

  if (status !== "authenticated" || !admin) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center bg-background px-4"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="ml-3 text-sm text-muted-foreground">
          {status === "initializing" ? "Checking your admin access…" : "Redirecting to sign in…"}
        </span>
      </div>
    );
  }

  const allowed = can(permission);
  const visibleNav = NAV.filter((item) => can(item.permission));

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col lg:flex-row">
        {/* --- sidebar (desktop) / horizontal scroller (mobile) ---------- */}
        <aside className="border-b border-border bg-background lg:min-h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3 px-4 py-4 lg:block">
            <div>
              <p className="text-sm font-semibold tracking-tight text-foreground">
                Fly n Feel Admin
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_LABEL[admin.role]}</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent lg:hidden"
            >
              <LogOut className="size-3.5" aria-hidden />
              Sign out
            </button>
          </div>

          <nav
            aria-label="Admin sections"
            className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-2"
          >
            {visibleNav.map((item) => {
              const active =
                item.to === "/admin" ? pathname === "/admin" : pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden px-4 py-4 lg:block">
            <button
              type="button"
              onClick={signOut}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        </aside>

        {/* --- content ---------------------------------------------------- */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            ) : null}
            {isDemoMode ? (
              <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                Test mode — activity is recorded in this browser only, and admin sign-in uses demo
                accounts. Real admin accounts and stored analytics arrive with the live backend.
              </p>
            ) : null}
          </header>

          {allowed ? (
            children
          ) : (
            <div className="rounded-lg border border-border bg-background p-6">
              <h2 className="text-sm font-semibold text-foreground">Not available on your level</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your access level ({ROLE_LABEL[admin.role]}) does not include this section. The
                server rejects the underlying request as well, so nothing here is only hidden.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
