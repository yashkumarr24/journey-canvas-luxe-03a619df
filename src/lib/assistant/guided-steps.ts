/**
 * Guided follow-up steps for the travel assistant.
 *
 * After the AI extracts what it can from free text, these steps ask — with
 * controls, not chat — for anything still missing. Selections are written
 * straight into TravelRequirements and never sent to the AI.
 *
 * A step only counts as answered when the user actually said it (in their own
 * words) or picked it with a control. Provider defaults such as "oneway" or
 * "flights only" are never treated as the user's answer.
 */

import type { TimeWindow, TravelRequirements } from "@/types/assistant";

export type GuidedStep =
  | "departureDate"
  | "tripType"
  | "returnDate"
  | "products"
  | "nights"
  | "travellers"
  | "cabinClass";

export type ConfirmedSteps = Partial<Record<GuidedStep, true>>;

export const GUIDED_PROMPTS: Record<GuidedStep, string> = {
  departureDate: "When would you like to depart?",
  tripType: "Is this a one-way or round trip?",
  returnDate: "When would you like to return?",
  products: "Do you need flights only, or flights and a hotel?",
  nights: "How many nights will you stay?",
  travellers: "Who is travelling?",
  cabinClass: "Which cabin would you like?",
};

/** Mark steps the user explicitly covered in their own message. */
export function confirmFromTurn(
  userText: string,
  requirements: TravelRequirements,
  previous: ConfirmedSteps,
): ConfirmedSteps {
  const text = userText.toLowerCase();
  const next: ConfirmedSteps = { ...previous };
  if (requirements.returnDate || /\bone[- ]?way\b|\bround[- ]?trip\b|\breturn(ing)?\b|\bcoming back\b/.test(text)) {
    if (requirements.tripType) next.tripType = true;
  }
  if (
    requirements.products?.includes("hotels") ||
    /\bflights? only\b|\bonly (a )?flights?\b|\bjust (a )?flights?\b|\bno hotels?\b|\bwithout (a )?hotels?\b|\bdon'?t need (a )?(hotel|stay)\b/.test(text)
  ) {
    next.products = true;
  }
  if (
    requirements.adults !== undefined &&
    /\b\d{1,2}\s*(adults?|child(ren)?|kids?|infants?|bab(y|ies)|people|persons?|pax|travell?ers?|passengers?)\b|\bsolo\b|\balone\b|\bjust me\b|\bcouple\b/.test(text)
  ) {
    next.travellers = true;
  }
  if (requirements.cabinClass && /\beconomy\b|\bbusiness\b|\bfirst class\b|\bpremium\b/.test(text)) {
    next.cabinClass = true;
  }
  return next;
}

/** The next step to show, or null when nothing (guided) is left to ask. */
export function nextGuidedStep(requirements: TravelRequirements, confirmed: ConfirmedSteps): GuidedStep | null {
  // Route comes from free text; the chat keeps asking for it.
  if (!requirements.origin || !requirements.destination) return null;
  if (!requirements.departureDate) return "departureDate";
  if (!confirmed.tripType) return "tripType";
  if (requirements.tripType === "roundtrip" && !requirements.returnDate) return "returnDate";
  if (!confirmed.products) return "products";
  if (requirements.products?.includes("hotels") && !requirements.durationNights && !requirements.returnDate) return "nights";
  if (!confirmed.travellers) return "travellers";
  if (!confirmed.cabinClass) return "cabinClass";
  return null;
}

export function toIsoDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function addNights(iso: string, nights: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + nights);
  return toIsoDate(date);
}

export function nightsBetweenDates(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000);
}

const WINDOW_WORDS: [RegExp, TimeWindow][] = [
  [/early morning/, "early_morning"],
  [/morning/, "morning"],
  [/afternoon/, "afternoon"],
  [/evening/, "evening"],
  [/night/, "night"],
];

function windowIn(fragment: string): TimeWindow | undefined {
  return WINDOW_WORDS.find(([re]) => re.test(fragment))?.[1];
}

/**
 * Keep details the user stated literally, even if a provider dropped or
 * mis-filed them. Only reads the user's own words; never invents values.
 */
export function preserveStatedDetails(userText: string, requirements: TravelRequirements): TravelRequirements {
  const text = userText.toLowerCase();
  const next: TravelRequirements = { ...requirements };

  const stay = /\b(?:stay(?:ing)?|for)\s+(?:for\s+)?(\d{1,2})\s*nights?\b/.exec(text) ?? /\b(\d{1,2})\s*nights?\b/.exec(text);
  if (stay) next.durationNights = Number(stay[1]);

  const ret = /\b(?:return(?:ing)?|coming back|back flight|inbound)\b([^.,;]*)/.exec(text);
  const returnWindow = ret ? windowIn(ret[1] ?? "") : undefined;
  if (returnWindow) {
    next.preferredReturnWindow = returnWindow;
    const outside = text.replace(ret![0], " ");
    const departureWindow = windowIn(outside.replace(/\barriv\w*[^.,;]*/, " "));
    // A return-only time must not become an outbound preference.
    if (!departureWindow && next.preferredDepartureWindow === returnWindow) delete next.preferredDepartureWindow;
  }
  return next;
}
