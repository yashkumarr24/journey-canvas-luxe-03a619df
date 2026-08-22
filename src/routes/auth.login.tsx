import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import { AuthLayout, AuthMessage } from "@/components/auth/AuthLayout";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import { sanitizeRedirect } from "@/lib/auth/redirect";

const searchSchema = z.object({
  /** Sanitized again before use — never trusted as an absolute URL. */
  redirect: z.string().optional(),
  registered: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/auth/login")({
  ssr: false,
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign In — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Sign in to your Fly n Feel Holidays account to manage saved travellers, contact details and booking history.",
      },
      { property: "og:title", content: "Sign In — Fly n Feel Holidays" },
      {
        property: "og:description",
        content: "Access your Fly n Feel account, saved travellers and bookings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { signIn, isAuthenticated, isInitializing, isConfigured } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const destination = sanitizeRedirect(search.redirect);
  const routerState = useRouterState({ select: (s) => s.status });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // Already signed in? Leave the auth page instead of showing a dead form.
  useEffect(() => {
    if (!isInitializing && isAuthenticated) {
      void navigate({ to: destination, replace: true });
    }
  }, [isInitializing, isAuthenticated, destination, navigate]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message ?? AUTH_MESSAGES.generic);
      return;
    }
    void navigate({ to: destination, replace: true });
  };

  const busy = submitting || routerState === "pending";

  return (
    <AuthLayout
      eyebrow="Fly n Feel Account"
      title="Welcome back"
      description="Sign in to manage saved travellers, contact details and your booking history."
      footer={
        <>
          New here?{" "}
          <Link
            to="/auth/register"
            search={{ redirect: destination }}
            className="text-gold underline underline-offset-4"
          >
            Create an account
          </Link>
        </>
      }
    >
      {search.registered ? (
        <AuthMessage tone="success">{AUTH_MESSAGES.registered}</AuthMessage>
      ) : null}
      {!isConfigured ? <AuthMessage tone="info">{AUTH_MESSAGES.notConfigured}</AuthMessage> : null}
      {error ? <AuthMessage tone="error">{error}</AuthMessage> : null}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="login-email">Email address</Label>
          <Input
            id="login-email"
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
        />

        <div className="flex justify-end">
          <Link
            to="/auth/forgot-password"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" className="w-full" disabled={busy || !isConfigured}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              <span>Signing in…</span>
            </>
          ) : (
            "Sign in"
          )}
        </Button>
        <p aria-live="polite" className="sr-only">
          {submitting ? "Signing in, please wait." : ""}
        </p>
      </form>
    </AuthLayout>
  );
}
