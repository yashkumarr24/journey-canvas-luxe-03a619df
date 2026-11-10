import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { markSignInPromptDismissed, markSignInPromptShown, signInPromptAllowed } from "@/lib/hotel-results-state";

/**
 * Homepage-only nudge for signed-out visitors. Appears after 2s, at most once
 * per session and not within 24h of being dismissed. It is only mounted on the
 * homepage, so it can never interrupt checkout or payment.
 */
export function SignInPrompt() {
  const { isAuthenticated, isInitializing, isConfigured } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isInitializing || isAuthenticated || !isConfigured) return;
    if (!signInPromptAllowed()) return;
    const timer = window.setTimeout(() => {
      setOpen(true);
      markSignInPromptShown();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [isInitializing, isAuthenticated, isConfigured]);

  useEffect(() => {
    if (isAuthenticated) setOpen(false);
  }, [isAuthenticated]);

  if (!open) return null;

  const dismiss = () => {
    markSignInPromptDismissed();
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="signin-prompt-title"
      className="fixed inset-x-3 bottom-3 z-50 rounded-xl border border-foreground/10 bg-card p-5 text-card-foreground shadow-[var(--shadow-luxe)] animate-in fade-in slide-in-from-bottom-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <Sparkles className="size-5 text-gold" aria-hidden="true" />
      <p id="signin-prompt-title" className="mt-2 pr-8 font-display text-2xl leading-tight">
        Sign in or create an account for better deals
      </p>
      <p className="mt-1 text-sm text-muted-foreground">Keep your trips and searches in one place.</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button asChild className="bg-gold text-primary-foreground hover:bg-primary" onClick={() => markSignInPromptDismissed()}>
          <Link to="/auth/login" search={{ redirect: "/" }}>Sign in</Link>
        </Button>
        <Button asChild variant="outline" onClick={() => markSignInPromptDismissed()}>
          <Link to="/auth/register">Create account</Link>
        </Button>
      </div>
    </div>
  );
}
