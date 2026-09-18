/**
 * Admin session state for the Admin Panel (separate from the customer account).
 *
 * The panel is intended to be served from admin.flynfeelholidays.com later; the
 * routes live under /admin today so nothing needs DNS to be testable.
 *
 * Authorisation model:
 *   * The role is NEVER taken from the browser. In backend mode it comes from
 *     `GET /api/v1/admin/me`, which resolves the caller's Supabase user id
 *     against the `admin_users` table server-side.
 *   * In local test mode a demo directory stands in (see admin-mock.ts).
 *   * Hiding links is cosmetic only — FastAPI `require_admin(level)` and
 *     Postgres RLS reject anything a customer tries to call.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { bookingApiBaseUrl, isBookingApiConfigured } from "@/lib/booking-api";

import { verifyDemoAdmin } from "./admin-mock";
import {
  LEVEL_BY_ROLE,
  can,
  hasLevel,
  type AdminIdentity,
  type AdminLevel,
  type AdminPermission,
} from "./admin-roles";

const STORAGE_KEY = "ffh.admin.session.v1";

export type AdminStatus = "initializing" | "authenticated" | "unauthenticated";

export interface AdminContextValue {
  status: AdminStatus;
  admin: AdminIdentity | null;
  /** True while the demo directory backs sign-in (no live backend yet). */
  isDemoMode: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  signOut: () => void;
  can: (permission: AdminPermission) => boolean;
  hasLevel: (minimum: AdminLevel) => boolean;
}

const AdminContext = createContext<AdminContextValue | null>(null);

function readStored(): AdminIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminIdentity;
    return parsed?.role ? parsed : null;
  } catch {
    return null;
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminStatus>("initializing");
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const isDemoMode = !isBookingApiConfigured;

  /* Restore a panel session (per tab only — nothing persistent). */
  useEffect(() => {
    const stored = readStored();
    if (!stored) {
      setStatus("unauthenticated");
      return;
    }
    if (isDemoMode) {
      setAdmin(stored);
      setStatus("authenticated");
      return;
    }
    // Backend mode: re-verify the role server-side before trusting it.
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${bookingApiBaseUrl}/api/v1/admin/me`, {
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) throw new Error("unauthorized");
        const identity = (await response.json()) as AdminIdentity;
        if (cancelled) return;
        setAdmin(identity);
        setStatus("authenticated");
      } catch {
        if (cancelled) return;
        window.sessionStorage.removeItem(STORAGE_KEY);
        setAdmin(null);
        setStatus("unauthenticated");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDemoMode]);

  const signIn = useCallback<AdminContextValue["signIn"]>(
    async (email, password) => {
      if (isDemoMode) {
        const identity = verifyDemoAdmin(email, password);
        if (!identity) {
          return { ok: false, message: "Those admin details are not recognised." };
        }
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
        setAdmin(identity);
        setStatus("authenticated");
        return { ok: true };
      }

      try {
        const response = await fetch(`${bookingApiBaseUrl}/api/v1/admin/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        if (!response.ok) {
          return { ok: false, message: "Those admin details are not recognised." };
        }
        const identity = (await response.json()) as AdminIdentity;
        if (!identity?.role || LEVEL_BY_ROLE[identity.role] < 1) {
          return { ok: false, message: "This account has no admin access." };
        }
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
        setAdmin(identity);
        setStatus("authenticated");
        return { ok: true };
      } catch {
        return { ok: false, message: "Admin sign-in is unavailable right now." };
      }
    },
    [isDemoMode],
  );

  const signOut = useCallback(() => {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setAdmin(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo<AdminContextValue>(
    () => ({
      status,
      admin,
      isDemoMode,
      signIn,
      signOut,
      can: (permission) => can(admin?.role ?? null, permission),
      hasLevel: (minimum) => hasLevel(admin?.role ?? null, minimum),
    }),
    [status, admin, isDemoMode, signIn, signOut],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminAuth(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdminAuth must be used inside <AdminAuthProvider>");
  return ctx;
}
