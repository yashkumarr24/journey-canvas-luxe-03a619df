import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { AuthLayout, AuthMessage } from "@/components/auth/AuthLayout";
import { PasswordField } from "@/components/auth/PasswordField";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import { supabase } from "@/lib/supabase/client";

/**
 * Landing page for Supabase's official recovery link.
 *
 * Supabase (PKCE flow, `detectSessionInUrl`) exchanges the code in the URL for
 * a temporary recovery session. We only ever call `updateUser({ password })` —
 * we never mint, store or log our own reset tokens, and the URL is cleaned so
 * the link never lingers in history or in a screenshot.
 */
export const Route = createFileRoute("/auth/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a New Password — Fly n Feel Holidays" },
      {
        name: "description",
        content: "Choose a new password for your Fly n Feel Holidays account.",
      },
      { property: "og:title", content: "Set a New Password — Fly n Feel Holidays" },
      { property: "og:description", content: "Choose a new password for your account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

const MIN_PASSWORD = 8;

type LinkState = "checking" | "ready" | "invalid";

function ResetPasswordPage() {
  const { updatePassword, isConfigured } = useAuth();
  const navigate = useNavigate();

  const [linkState, setLinkState] = useState<LinkState>(isConfigured ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;

    const check = async () => {
      const { data } = await client.auth.getSession();
      if (!active) return;
      setLinkState(data.session ? "ready" : "invalid");
      // Strip the recovery fragment/query from the address bar.
      if (typeof window !== "undefined" && (window.location.hash || window.location.search)) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    };

    // A PASSWORD_RECOVERY event may arrive slightly after mount.
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) setLinkState("ready");
    });

    void check();
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setFieldError(null);

    if (password.length < MIN_PASSWORD) {
      setFieldError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setFieldError("Both passwords must match.");
      return;
    }

    setSubmitting(true);
    const result = await updatePassword(password);
    setSubmitting(false);
    setPassword("");
    setConfirm("");

    if (!result.ok) {
      setError(result.message ?? AUTH_MESSAGES.generic);
      return;
    }
    setDone(true);
    setTimeout(() => void navigate({ to: "/account", replace: true }), 1200);
  };

  return (
    <AuthLayout
      eyebrow="Account Recovery"
      title="Set a new password"
      description="Choose a password you haven't used before."
      footer={
        <Link to="/auth/login" className="text-gold underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      {linkState === "checking" ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Checking your reset link…
        </p>
      ) : null}

      {linkState === "invalid" ? (
        <AuthMessage tone="error">
          {isConfigured ? AUTH_MESSAGES.resetLinkInvalid : AUTH_MESSAGES.notConfigured}
        </AuthMessage>
      ) : null}

      {done ? <AuthMessage tone="success">{AUTH_MESSAGES.passwordUpdated}</AuthMessage> : null}
      {error ? <AuthMessage tone="error">{error}</AuthMessage> : null}

      {linkState === "ready" && !done ? (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <PasswordField
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`}
            error={fieldError ?? undefined}
            disabled={submitting}
          />
          <PasswordField
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            disabled={submitting}
          />
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                <span>Updating password…</span>
              </>
            ) : (
              "Update password"
            )}
          </Button>
        </form>
      ) : null}

      {linkState === "invalid" ? (
        <Link
          to="/auth/forgot-password"
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Request a new link
        </Link>
      ) : null}
    </AuthLayout>
  );
}
