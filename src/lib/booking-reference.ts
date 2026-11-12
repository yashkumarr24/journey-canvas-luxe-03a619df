/**
 * Booking references are safe to carry in a URL (they never authorise anything
 * on their own). Only accept a plain reference shape before prefilling a form.
 */
export function sanitizeBookingReference(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/.test(trimmed) ? trimmed : undefined;
}

/** Server answers meaning "this caller may not see this booking" (never 5xx). */
export function isAccessRejection(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 404;
}
