/**
 * Browser Supabase client — identity only.
 *
 * This client is used for Supabase Auth (sign in / sign up / session
 * restoration / password reset) and for RLS-protected reads of the current
 * user's own rows (`profiles`, `travellers`). It NEVER holds a service-role
 * key, never talks to TripJack/Razorpay, and never performs privileged
 * operations — those stay in the FastAPI backend.
 *
 * Configuration is public-only:
 *   VITE_SUPABASE_URL       - project URL
 *   VITE_SUPABASE_ANON_KEY  - publishable/anon key (safe in the browser)
 *
 * There is deliberately NO VITE_SUPABASE_SERVICE_ROLE_KEY. If you ever see
 * one, it is a security incident.
 *
 * The project can run with these unset: `supabase` is then `null` and the
 * auth UI shows a "sign-in is being configured" state instead of crashing.
 * Guest browsing, flight search and guest booking do not depend on it.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

/** True when the public Supabase Auth configuration is present. */
export const isSupabaseConfigured = url.length > 0 && anonKey.length > 0;

/**
 * Session persistence is handled by the official Supabase client (localStorage
 * + automatic refresh). We do not implement custom token storage, and we never
 * copy tokens into our own state, cookies, URLs or logs.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

/** Narrow helper for code paths that require a configured client. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }
  return supabase;
}
