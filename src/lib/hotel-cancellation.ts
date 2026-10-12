import { formatMoney } from "@/lib/flight-search";
import type { HotelCancellationRule } from "@/types/booking";

/**
 * TripJack v3 sends cancellation dates as IST wall-clock values without an
 * offset ("2026-05-18T00:00:00", GMT+5:30). Show them exactly as sent, labelled
 * IST, instead of letting the browser re-interpret them in its own timezone.
 * No buffer time or rounding is applied.
 */
export function formatPolicyTime(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
  if (m[4] === undefined) return date;
  return `${date}, ${m[4]}:${m[5]}${m[6] ? `:${m[6]}` : ""} IST`;
}

/** Charge text for one penalty slab; a missing amount is never shown as free. */
export function formatPolicyCharge(rule: HotelCancellationRule): string {
  if (!rule.charge) return "charge not specified by the hotel";
  if (rule.charge.amount === 0) return "free cancellation (no charge)";
  return `charge ${formatMoney(rule.charge.amount, rule.charge.currency)}`;
}

export function formatPolicyRule(rule: HotelCancellationRule): string {
  return `${formatPolicyTime(rule.from, "Now")} – ${formatPolicyTime(rule.to, "check-in")}: ${formatPolicyCharge(rule)}`;
}
