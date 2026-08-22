import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { AuthLayout, AuthMessage } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { AUTH_MESSAGES } from "@/lib/auth/messages";

export const Route = createFileRoute("/auth/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset Your Password — Fly n Feel Holidays" },
      {
        name: "description",
        content:
          "Request a secure password reset link for your Fly n Feel Holidays account.",
      },
      { property: "og:title", content: "Reset Your Password — Fly n Feel Holidays" },
      { property: "og:description", content: "Request a secure password reset link." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { requestPasswordReset, isConfigured } = useAuth();
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const result = await requestPasswordReset(email);
    setSubmitting(false);
    // The success copy is identical for existing and unknown addresses.
    if (result.ok) setNotice(result.message ?? AUTH_MESSAGES.resetRequested);
    else setError(result.message ?? AUTH_MESSAGES.generic);
  };

  return (
    <AuthLayout
      eyebrow="Account Recovery"
      title="Forgot your password?"
      description="Enter the email address on your account and we'll send a secure reset link."
      footer={
        <Link to="/auth/login" className="text-gold underline underline-offset-4">
          Back to sign in
        </Link>
      }
    >
      {!isConfigured ? <AuthMessage tone="info">{AUTH_MESSAGES.notConfigured}</AuthMessage> : null}
      {notice ? <AuthMessage tone="success">{notice}</AuthMessage> : null}
      {error ? <AuthMessage tone="error">{error}</AuthMessage> : null}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="forgot-email">Email address</Label>
          <Input
            id="forgot-email"
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting || !isConfigured}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              <span>Sending link…</span>
            </>
          ) : (
            "Send reset link"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
