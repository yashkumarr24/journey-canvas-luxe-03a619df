/**
 * "Continue with Google" — signs in through the Google provider of the
 * Supabase project the browser auth client points at (on Vercel: FNF).
 * Returns to the public /auth/login page; the PKCE code in the URL is
 * exchanged automatically and login forwards the user to `destination`.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase/client";

export function GoogleButton({ destination, onError }: { destination: string; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    const redirectTo = `${window.location.origin}/auth/login?redirect=${encodeURIComponent(destination)}`;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      setBusy(false);
      onError("Google sign-in is unavailable right now. Please try again or use email.");
    }
  };
  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={onClick} disabled={busy || !supabase}>
        {busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
        Continue with Google
      </Button>
      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-foreground/10" />or<span className="h-px flex-1 bg-foreground/10" />
      </div>
    </>
  );
}
