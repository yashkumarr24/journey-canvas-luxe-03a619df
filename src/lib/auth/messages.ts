/**
 * User-facing authentication messages.
 *
 * Two rules drive every string here:
 *
 * 1. No account enumeration. Sign-in failures, registration and password-reset
 *    requests must not reveal whether an email address exists. Reset always
 *    reports the same neutral "if an account exists…" outcome.
 * 2. No internal detail. Supabase error codes, stack traces and provider text
 *    are never rendered; they are mapped to a small set of safe messages.
 */

export const AUTH_MESSAGES = {
  invalidCredentials: "That email and password combination didn't work. Please try again.",
  emailNotConfirmed: "Please confirm your email address first — check your inbox for the link.",
  rateLimited: "Too many attempts. Please wait a moment and try again.",
  weakPassword: "Please choose a password with at least 8 characters.",
  networkIssue: "We couldn't reach the sign-in service. Please check your connection and try again.",
  notConfigured: "Accounts are being set up. You can still search and book as a guest.",
  generic: "Something went wrong. Please try again.",
  /** Identical whether or not the email exists. */
  resetRequested:
    "If an account exists for that email, we've sent a password reset link. Please check your inbox and spam folder.",
  /** Identical whether or not the email was already registered. */
  registered:
    "Thanks for signing up. If a confirmation email is required, we've sent a link to that address — open it to activate your account.",
  registeredAndSignedIn: "Your account is ready. Welcome to Fly n Feel.",
  passwordUpdated: "Your password has been updated.",
  resetLinkInvalid:
    "This password reset link is invalid or has expired. Please request a new one.",
} as const;

type SupabaseLikeError = { message?: string; status?: number; code?: string } | null | undefined;

/**
 * Map a Supabase auth error to a safe message. The raw error is intentionally
 * NOT returned and must never be logged with the submitted credentials.
 */
export function safeAuthMessage(error: SupabaseLikeError): string {
  if (!error) return AUTH_MESSAGES.generic;

  const status = error.status ?? 0;
  const text = (error.message ?? "").toLowerCase();

  if (status === 429 || text.includes("rate limit") || text.includes("too many")) {
    return AUTH_MESSAGES.rateLimited;
  }
  if (text.includes("email not confirmed") || text.includes("not confirmed")) {
    return AUTH_MESSAGES.emailNotConfirmed;
  }
  if (text.includes("password") && (text.includes("short") || text.includes("weak") || text.includes("least"))) {
    return AUTH_MESSAGES.weakPassword;
  }
  if (text.includes("failed to fetch") || text.includes("network")) {
    return AUTH_MESSAGES.networkIssue;
  }
  if (status === 400 || status === 401 || text.includes("invalid login")) {
    return AUTH_MESSAGES.invalidCredentials;
  }
  return AUTH_MESSAGES.generic;
}
