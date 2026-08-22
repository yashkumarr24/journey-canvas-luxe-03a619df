import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth/register")({
  ssr: false,
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Create Account — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Create a Fly n Feel Holidays account to save travellers, keep contact details handy and track your bookings.",
      },
      { property: "og:title", content: "Create Account — Fly n Feel Holidays" },
      {
        property: "og:description",
        content: "Save travellers and track bookings with a free Fly n Feel account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RegisterPage,
});

const MIN_PASSWORD = 8;

function RegisterPage() {
  const { signUp, isAuthenticated, isInitializing, isConfigured } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const destination = sanitizeRedirect(search.redirect);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isInitializing && isAuthenticated && !notice) {
      void navigate({ to: destination, replace: true });
    }
  }, [isInitializing, isAuthenticated, destination, navigate, notice]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setPasswordError(null);
    setConfirmError(null);

    if (password.length < MIN_PASSWORD) {
      setPasswordError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setConfirmError("Both passwords must match.");
      return;
    }

    setSubmitting(true);
    const result = await signUp(email, password, fullName);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? AUTH_MESSAGES.generic);
      return;
    }
    // Same neutral copy whether or not the address was already registered.
    if (result.needsEmailConfirmation) {
      setNotice(result.message ?? AUTH_MESSAGES.registered);
      setPassword("");
      setConfirm("");
      return;
    }
    void navigate({ to: destination, replace: true });
  };

  return (
    <AuthLayout
      eyebrow="Fly n Feel Account"
      title="Create your account"
      description="An account is optional — you can search and book as a guest. Signing up simply saves your travellers and bookings for next time."
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/auth/login"
            search={{ redirect: destination }}
            className="text-gold underline underline-offset-4"
          >
            Sign in
          </Link>
        </>
      }
    >
      {!isConfigured ? <AuthMessage tone="info">{AUTH_MESSAGES.notConfigured}</AuthMessage> : null}
      {notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
      {error ? <AuthMessage tone="error">{error}</AuthMessage> : null}

      {!notice ? (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="register-name">Full name</Label>
            <Input
              id="register-name"
              ref={nameRef}
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-email">Email address</Label>
            <Input
              id="register-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`}
            error={passwordError ?? undefined}
            disabled={submitting}
          />

          <PasswordField
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            error={confirmError ?? undefined}
            disabled={submitting}
          />

          <Button type="submit" className="w-full" disabled={submitting || !isConfigured}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                <span>Creating account…</span>
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
      ) : (
        <Link
          to="/auth/login"
          search={{ redirect: destination }}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Go to sign in
        </Link>
      )}
    </AuthLayout>
  );
}
