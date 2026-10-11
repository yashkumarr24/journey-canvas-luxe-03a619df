/**
 * Resolve the signed-in user's Supabase access token for server-function RPCs.
 *
 * Pure helper (no Supabase imports) so it can be unit-tested and reused.
 * It must NEVER throw: a missing or misconfigured public Supabase setup means
 * "no token", not "broken request" — public server functions such as the
 * enquiry form must keep working on hosts where VITE_SUPABASE_* is absent.
 */

interface MinimalSession {
  access_token?: string;
}

interface MinimalAuthClient {
  auth: {
    getSession: () => Promise<{ data: { session: MinimalSession | null } | null }>;
  };
}

export async function resolveBearerToken(
  client: MinimalAuthClient | null,
): Promise<string | null> {
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}
