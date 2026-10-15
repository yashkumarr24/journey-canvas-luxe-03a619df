/**
 * Pure rules for the Android/iOS shell (no Capacitor imports, safe for SSR
 * and unit tests). The website never calls these unless running in the app.
 */

export const APP_HOSTS = ["www.flynfeelholiday.com", "flynfeelholiday.com"] as const;
export const CANONICAL_ORIGIN = "https://www.flynfeelholiday.com";

export type LinkAction = "in-app" | "system-browser" | "os-handler" | "ignore";

/** What to do when a link is tapped inside the app. */
export function classifyLink(href: string, base: string = CANONICAL_ORIGIN): LinkAction {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return "ignore";
  }
  if (url.protocol === "tel:" || url.protocol === "mailto:" || url.protocol === "sms:") return "os-handler";
  if (url.protocol === "intent:" || url.protocol === "whatsapp:") return "os-handler";
  if (url.protocol !== "https:" && url.protocol !== "http:") return "ignore";
  if (url.protocol === "https:" && (APP_HOSTS as readonly string[]).includes(url.hostname)) return "in-app";
  return "system-browser";
}

/**
 * Turn an incoming App Link / Universal Link (or the OAuth return) into the
 * in-app path to open. Returns null for anything that isn't our site, so a
 * hostile link can never navigate the app elsewhere.
 */
export function deepLinkPath(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !(APP_HOSTS as readonly string[]).includes(url.hostname)) return null;
  // Hash carries Supabase tokens for some email links; keep it intact.
  return `${url.pathname}${url.search}${url.hash}` || "/";
}

/** Paths where Android's back button should leave the app instead of going back. */
export function isRootPath(pathname: string): boolean {
  return pathname === "/" || pathname === "";
}
