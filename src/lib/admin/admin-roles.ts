/**
 * Admin roles and permissions.
 *
 * Three levels, matching the database enum in
 * backend/db/migrations/0008_analytics_admin.sql:
 *
 *   1 staff    — read-only operational access
 *   2 manager  — staff + analytics, reports, payments, booking management
 *   3 owner    — everything + admin user management and platform settings
 *
 * THIS FILE IS UI CONVENIENCE ONLY. It decides which links and panels to draw.
 * Every admin read/write is independently authorised server-side (FastAPI
 * `require_admin(level)`) and at the database level (RLS + `has_admin_level()`),
 * so editing this file in a browser grants nothing.
 */

export type AdminLevel = 1 | 2 | 3;
export type AdminRole = "staff" | "manager" | "owner";

export const ROLE_BY_LEVEL: Record<AdminLevel, AdminRole> = {
  1: "staff",
  2: "manager",
  3: "owner",
};

export const LEVEL_BY_ROLE: Record<AdminRole, AdminLevel> = {
  staff: 1,
  manager: 2,
  owner: 3,
};

export const ROLE_LABEL: Record<AdminRole, string> = {
  staff: "Level 1 — Staff",
  manager: "Level 2 — Manager",
  owner: "Level 3 — Owner",
};

export type AdminPermission =
  | "dashboard.view"
  | "bookings.view"
  | "bookings.manage"
  | "customers.view"
  | "payments.view"
  | "analytics.view"
  | "activity.view"
  | "reports.view"
  | "admins.manage"
  | "settings.manage";

const PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  staff: ["dashboard.view", "bookings.view", "customers.view"],
  manager: [
    "dashboard.view",
    "bookings.view",
    "bookings.manage",
    "customers.view",
    "payments.view",
    "analytics.view",
    "activity.view",
    "reports.view",
  ],
  owner: [
    "dashboard.view",
    "bookings.view",
    "bookings.manage",
    "customers.view",
    "payments.view",
    "analytics.view",
    "activity.view",
    "reports.view",
    "admins.manage",
    "settings.manage",
  ],
};

export function permissionsFor(role: AdminRole): AdminPermission[] {
  return PERMISSIONS[role];
}

export function can(role: AdminRole | null, permission: AdminPermission): boolean {
  if (!role) return false;
  return PERMISSIONS[role].includes(permission);
}

export function hasLevel(role: AdminRole | null, minimum: AdminLevel): boolean {
  if (!role) return false;
  return LEVEL_BY_ROLE[role] >= minimum;
}

export interface AdminIdentity {
  /** Opaque admin record id (never the Supabase service key or a raw token). */
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  level: AdminLevel;
  status: "active" | "suspended";
  lastSignInAt: string | null;
}
