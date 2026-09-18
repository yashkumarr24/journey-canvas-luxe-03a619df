import { useEffect, useRef } from "react";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth/auth-context";

/**
 * Pathless layout guarding every private route (/account/**).
 *
 * `ssr: false` because the Supabase session lives in browser storage: gating
 * server-side would redirect every hard refresh to /auth/login and loop.
 *
 * The gate has exactly three states, so protected content can never flash to a
 * signed-out visitor:
 *   initializing    -> spinner
 *   unauthenticated -> replace-navigate to /auth/login?redirect=<current path>
 *   authenticated   -> render <Outlet />
 *
 * The `redirect` value is a same-origin path taken from the router (not from
 * user input) and is re-sanitized by sanitizeRedirect() before it is used.
 *
 * This is UI protection only. Every private read/write is independently
 * authorized by Postgres RLS or by FastAPI token verification.
 */
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (s) => `${s.location.pathname}${s.location.searchStr ?? ""}`,
  });

  // The location changes the moment we navigate away, so the redirect target
  // is captured ONCE and the bounce fires ONCE. Re-running it would send
  // /auth/login back to itself and nest the redirect value forever.
  const intended = useRef(pathname);
  const bounced = useRef(false);

  useEffect(() => {
    if (status !== "unauthenticated" || bounced.current) return;
    bounced.current = true;
    void navigate({
      to: "/auth/login",
      search: { redirect: intended.current },
      replace: true,
    });
  }, [status, navigate]);

  if (status !== "authenticated") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center bg-background px-4"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="ml-3 text-sm text-muted-foreground">
          {status === "initializing" ? "Restoring your session…" : "Redirecting to sign in…"}
        </span>
      </div>
    );
  }

  return <Outlet />;
}
