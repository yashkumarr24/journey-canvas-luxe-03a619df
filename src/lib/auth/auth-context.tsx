/**
 * Centralized authentication state — the single source of truth.
 *
 * There is exactly ONE Supabase session subscription in the whole app (here).
 * Components read state with `useAuth()`; they must not call
 * `supabase.auth.*` for session state themselves.
 *
 * Status machine:
 *   "initializing"    -> restoring an existing session on load
 *   "authenticated"   -> valid session, `user` is set
 *   "unauthenticated" -> no session
 *
 * Token handling: the official Supabase client owns storage and refresh. We
 * never copy an access token into React state, never persist it ourselves and
 * never log it. The booking API client receives a *resolver* so it can fetch a
 * fresh token per request from one place (see src/lib/booking-api.ts).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";

import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { setBookingAuthTokenResolver } from "@/lib/booking-api";
import { AUTH_MESSAGES, safeAuthMessage } from "@/lib/auth/messages";
import { privateQueryFilter } from "@/lib/auth/query-keys";

export type AuthStatus = "initializing" | "authenticated" | "unauthenticated";

export interface AuthResult {
  ok: boolean;
  /** Safe, user-facing message. Never an internal provider error. */
  message?: string;
  /** True after sign-up when the account still needs email confirmation. */
  needsEmailConfirmation?: boolean;
}

export interface AuthContextValue {
  status: AuthStatus;
  isAuthenticated: boolean;
  isInitializing: boolean;
  /** Sign-in is unavailable until Supabase Auth env vars are configured. */
  isConfigured: boolean;
  user: User | null;
  userId: string | null;
  email: string | null;
  /** Whether Supabase reports the address as confirmed. */
  emailVerified: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, fullName?: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function origin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>(
    isSupabaseConfigured ? "initializing" : "unauthenticated",
  );
  const [user, setUser] = useState<User | null>(null);
  const previousUserId = useRef<string | null>(null);

  const applySession = useCallback((session: Session | null) => {
    setUser(session?.user ?? null);
    setStatus(session?.user ? "authenticated" : "unauthenticated");
  }, []);

  /* --- session restoration + change subscription (one listener) --------- */
  useEffect(() => {
    if (!supabase) return;
    let active = true;

    // 1. Restore any persisted session before first paint of gated UI.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) applySession(data.session ?? null);
      })
      .catch(() => {
        if (active) applySession(null);
      });

    // 2. React to sign-in, sign-out, token refresh and user updates.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) applySession(session ?? null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [applySession]);

  /* --- private cache isolation when the identity changes ---------------- */
  useEffect(() => {
    if (status === "initializing") return;
    const currentId = user?.id ?? null;
    if (previousUserId.current === currentId) return;

    // Identity changed (login, logout, or account switch): drop every cached
    // private query. Public flight/hotel searches are untouched.
    void queryClient.cancelQueries(privateQueryFilter);
    queryClient.removeQueries(privateQueryFilter);
    previousUserId.current = currentId;
  }, [status, user?.id, queryClient]);

  /* --- centralized bearer-token resolver for the booking API ------------ */
  useEffect(() => {
    if (!supabase) return;
    setBookingAuthTokenResolver(async () => {
      // Reads (and transparently refreshes) the session held by the Supabase
      // client. The token is handed straight to the Authorization header and
      // is never stored or logged by us.
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });
    return () => setBookingAuthTokenResolver(null);
  }, []);

  const signIn = useCallback<AuthContextValue["signIn"]>(async (email, password) => {
    if (!supabase) return { ok: false, message: AUTH_MESSAGES.notConfigured };
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) return { ok: false, message: safeAuthMessage(error) };
    return { ok: true };
  }, []);

  const signUp = useCallback<AuthContextValue["signUp"]>(async (email, password, fullName) => {
    if (!supabase) return { ok: false, message: AUTH_MESSAGES.notConfigured };
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${origin()}/auth/login`,
        // Stored on auth.users.user_metadata and mirrored into `profiles` by
        // the database trigger. Never contains credentials.
        data: fullName?.trim() ? { full_name: fullName.trim() } : undefined,
      },
    });
    if (error) return { ok: false, message: safeAuthMessage(error) };

    // With email confirmation enabled (Supabase default) there is no session
    // yet — the user is NOT signed in until they click the link.
    const needsEmailConfirmation = !data.session;
    return {
      ok: true,
      needsEmailConfirmation,
      message: needsEmailConfirmation
        ? AUTH_MESSAGES.registered
        : AUTH_MESSAGES.registeredAndSignedIn,
    };
  }, []);

  const signOut = useCallback(async () => {
    // Order matters: stop in-flight private queries, drop their cache, then
    // clear the session. Nothing private can repaint from stale cache.
    await queryClient.cancelQueries(privateQueryFilter);
    queryClient.removeQueries(privateQueryFilter);
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setStatus("unauthenticated");
  }, [queryClient]);

  const requestPasswordReset = useCallback<AuthContextValue["requestPasswordReset"]>(
    async (email) => {
      if (!supabase) return { ok: false, message: AUTH_MESSAGES.notConfigured };
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin()}/auth/reset-password`,
      });
      // Enumeration-safe: rate limiting is surfaced, everything else reports
      // the same neutral outcome whether or not the account exists.
      if (error && (error.status === 429 || /rate limit/i.test(error.message ?? ""))) {
        return { ok: false, message: AUTH_MESSAGES.rateLimited };
      }
      return { ok: true, message: AUTH_MESSAGES.resetRequested };
    },
    [],
  );

  const updatePassword = useCallback<AuthContextValue["updatePassword"]>(async (password) => {
    if (!supabase) return { ok: false, message: AUTH_MESSAGES.notConfigured };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, message: safeAuthMessage(error) };
    return { ok: true, message: AUTH_MESSAGES.passwordUpdated };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      isAuthenticated: status === "authenticated",
      isInitializing: status === "initializing",
      isConfigured: isSupabaseConfigured,
      user,
      userId: user?.id ?? null,
      email: user?.email ?? null,
      emailVerified: Boolean(user?.email_confirmed_at ?? user?.confirmed_at),
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      updatePassword,
    }),
    [status, user, signIn, signUp, signOut, requestPasswordReset, updatePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
