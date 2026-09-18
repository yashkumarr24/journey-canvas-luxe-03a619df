/**
 * DEMO admin directory — local test mode only.
 *
 * These are NOT production credentials and grant nothing anywhere real: they
 * exist so the three permission levels can be exercised locally before the
 * Supabase `admin_users` table and FastAPI `require_admin()` are live.
 *
 * When `VITE_BOOKING_API_URL` is configured, this file is never used: the admin
 * role comes from the server (`GET /api/v1/admin/me`) after a Supabase Auth
 * sign-in, and the level is re-checked on every admin request and by RLS.
 */

import type { AdminIdentity, AdminRole } from "./admin-roles";
import { LEVEL_BY_ROLE } from "./admin-roles";

export interface DemoAdminAccount {
  email: string;
  /** Demo-only passphrase. Never a real secret. */
  password: string;
  displayName: string;
  role: AdminRole;
}

export const DEMO_ADMIN_ACCOUNTS: DemoAdminAccount[] = [
  {
    email: "staff@demo.flynfeel.test",
    password: "demo-staff-1234",
    displayName: "Demo Staff",
    role: "staff",
  },
  {
    email: "manager@demo.flynfeel.test",
    password: "demo-manager-1234",
    displayName: "Demo Manager",
    role: "manager",
  },
  {
    email: "owner@demo.flynfeel.test",
    password: "demo-owner-1234",
    displayName: "Demo Owner",
    role: "owner",
  },
];

export function verifyDemoAdmin(email: string, password: string): AdminIdentity | null {
  const account = DEMO_ADMIN_ACCOUNTS.find(
    (item) => item.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!account || account.password !== password) return null;
  return {
    id: `demo_${account.role}`,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    level: LEVEL_BY_ROLE[account.role],
    status: "active",
    lastSignInAt: new Date().toISOString(),
  };
}

/** Demo admin roster shown on the "Admin users" screen (Level 3 only). */
export function demoAdminRoster(): AdminIdentity[] {
  return DEMO_ADMIN_ACCOUNTS.map((account) => ({
    id: `demo_${account.role}`,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    level: LEVEL_BY_ROLE[account.role],
    status: "active" as const,
    lastSignInAt: null,
  }));
}
