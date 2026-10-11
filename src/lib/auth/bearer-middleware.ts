/**
 * Client-side function middleware: attaches the signed-in user's Supabase
 * bearer token to server-function RPCs.
 *
 * Uses the app's own null-safe Supabase client (VITE_SUPABASE_URL +
 * VITE_SUPABASE_ANON_KEY via @/lib/supabase/client) — NOT the generated
 * @/integrations/supabase/client, which throws when the public Supabase env
 * vars are missing and would break every server-function call (including the
 * public enquiry form) on hosts like Vercel where those build-time variables
 * may be absent. Unconfigured → no Authorization header, request proceeds.
 */
import { createMiddleware } from "@tanstack/react-start";

import { supabase } from "@/lib/supabase/client";
import { resolveBearerToken } from "./bearer-token";

export const attachSupabaseBearer = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token = await resolveBearerToken(supabase);
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
