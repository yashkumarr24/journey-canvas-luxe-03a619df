import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";

import { useAdminAuth } from "@/lib/admin/admin-context";
import { DEMO_ADMIN_ACCOUNTS } from "@/lib/admin/admin-mock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Admin sign-in — separate from the customer account login.
 *
 * The role is decided by the server (or, in local test mode, by the demo
 * directory). A successful sign-in here proves nothing to the API on its own:
 * each admin request is authorised again server-side.
 */
export const Route = createFileRoute("/admin/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Fly n Feel Admin — Sign in" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Staff sign-in for the Fly n Feel operations panel." },
      { property: "og:title", content: "Fly n Feel Admin" },
      { property: "og:description", content: "Staff sign-in for the Fly n Feel operations panel." },
    ],
  }),
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const { signIn, status, isDemoMode } = useAdminAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in: leave the login screen after render, never during it.
  useEffect(() => {
    if (status === "authenticated") void navigate({ to: "/admin", replace: true });
  }, [status, navigate]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "Sign-in failed.");
      return;
    }
    void navigate({ to: "/admin", replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="size-5 text-foreground" aria-hidden />
          </span>
          <h1 className="mt-3 text-lg font-semibold tracking-tight text-foreground">
            Fly n Feel Admin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Operations panel. Customer accounts cannot sign in here.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-lg border border-border bg-background p-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Email</Label>
            <Input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
            Login
          </Button>
        </form>

        {isDemoMode ? (
          <div className="mt-4 rounded-lg border border-dashed border-border bg-background p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Test accounts (local only)</p>
            <p className="mt-1">
              These demo logins exist so the three permission levels can be checked before real
              admin accounts are created. They work nowhere else.
            </p>
            <ul className="mt-2 space-y-1">
              {DEMO_ADMIN_ACCOUNTS.map((account) => (
                <li key={account.email} className="flex flex-wrap gap-x-2">
                  <button
                    type="button"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password);
                    }}
                  >
                    {account.email}
                  </button>
                  <span>{account.password}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
