/**
 * Demo (mock) assistant provider — PHASE 12.
 *
 * This is deterministic pattern matching, NOT a language model. It exists so the
 * whole conversation -> structured requirements -> real flight search flow can be
 * built and tested before an AI provider is connected, and the UI labels it as a
 * demo everywhere it appears.
 *
 * It never produces flights, prices, fare ids, schedules or availability.
 */

import type {
  AssistantProvider,
  AssistantTurnRequest,
  AssistantTurnResponse,
  BaggagePreference,
  TimeWindow,
  TravelRequirements,
} from "@/types/assistant";
import type { CabinClass, TripType } from "@/types/booking";
import { isReady, mergeRequirements, missingRequirements, toValidatedSearchRequest } from "./requirements";

/** Small demo gazetteer. A real provider resolves places server-side. */
const PLACES: { code: string; label: string; aliases: string[] }[] = [
  { code: "AMD", label: "Ahmedabad", aliases: ["ahmedabad", "amdavad"] },
  { code: "BOM", label: "Mumbai", aliases: ["mumbai", "bombay"] },
  { code: "DEL", label: "Delhi", aliases: ["delhi", "new delhi"] },
  { code: "BLR", label: "Bengaluru", aliases: ["bengaluru", "bangalore"] },
  { code: "HYD", label: "Hyderabad", aliases: ["hyderabad"] },
  { code: "MAA", label: "Chennai", aliases: ["chennai", "madras"] },
  { code: "CCU", label: "Kolkata", aliases: ["kolkata", "calcutta"] },
  { code: "PNQ", label: "Pune", aliases: ["pune"] },
  { code: "GOI", label: "Goa", aliases: ["goa"] },
  { code: "JAI", label: "Jaipur", aliases: ["jaipur"] },
  { code: "COK", label: "Kochi", aliases: ["kochi", "cochin"] },
  { code: "SXR", label: "Srinagar", aliases: ["srinagar"] },
  { code: "DXB", label: "Dubai", aliases: ["dubai"] },
  { code: "AUH", label: "Abu Dhabi", aliases: ["abu dhabi"] },
  { code: "DOH", label: "Doha", aliases: ["doha"] },
  { code: "MCT", label: "Muscat", aliases: ["muscat"] },
  { code: "SIN", label: "Singapore", aliases: ["singapore"] },
  { code: "BKK", label: "Bangkok", aliases: ["bangkok"] },
  { code: "KUL", label: "Kuala Lumpur", aliases: ["kuala lumpur"] },
  { code: "DPS", label: "Bali", aliases: ["bali", "denpasar"] },
  { code: "MLE", label: "Maldives", aliases: ["maldives", "male"] },
  { code: "CMB", label: "Colombo", aliases: ["colombo"] },
  { code: "KTM", label: "Kathmandu", aliases: ["kathmandu", "nepal"] },
  { code: "LHR", label: "London", aliases: ["london"] },
  { code: "CDG", label: "Paris", aliases: ["paris"] },
  { code: "ZRH", label: "Zurich", aliases: ["zurich"] },
  { code: "IST", label: "Istanbul", aliases: ["istanbul"] },
  { code: "JFK", label: "New York", aliases: ["new york", "nyc"] },
  { code: "YYZ", label: "Toronto", aliases: ["toronto"] },
  { code: "SYD", label: "Sydney", aliases: ["sydney"] },
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function findPlace(text: string): { code: string; label: string } | null {
  const lower = text.toLowerCase();
  let best: { code: string; label: string; at: number } | null = null;
  for (const place of PLACES) {
    for (const alias of place.aliases) {
      const at = lower.indexOf(alias);
      if (at >= 0 && (best === null || at < best.at)) {
        best = { code: place.code, label: place.label, at };
      }
    }
  }
  if (best) return { code: best.code, label: best.label };
  const code = /\b([A-Z]{3})\b/.exec(text);
  if (code) {
    const known = PLACES.find((p) => p.code === code[1]);
    return { code: code[1], label: known?.label ?? code[1] };
  }
  return null;
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDate(text: string, today: Date): string | undefined {
  const lower = text.toLowerCase();

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower);
  if (iso) return iso[0];

  const dmy = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/.exec(lower);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${dmy[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const monthName = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})\\b`).exec(lower);
  const monthFirst = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(lower);
  if (monthName || monthFirst) {
    const day = Number(monthName ? monthName[1] : monthFirst![2]);
    const month = MONTHS.indexOf(monthName ? monthName[2]! : monthFirst![1]!);
    if (day >= 1 && day <= 31 && month >= 0) {
      let year = today.getFullYear();
      const candidate = new Date(year, month, day);
      if (candidate < today) year += 1;
      return isoDate(new Date(year, month, day));
    }
  }

  if (/\btomorrow\b/.test(lower)) return isoDate(addDays(today, 1));
  if (/\bday after tomorrow\b/.test(lower)) return isoDate(addDays(today, 2));
  if (/\bnext week\b/.test(lower)) return isoDate(addDays(today, 7));
  if (/\bthis weekend\b/.test(lower)) {
    const daysToSaturday = (6 - today.getDay() + 7) % 7 || 7;
    return isoDate(addDays(today, daysToSaturday));
  }
  if (/\bnext month\b/.test(lower)) {
    const next = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
    return isoDate(next);
  }
  const inDays = /\bin (\d{1,2}) days?\b/.exec(lower);
  if (inDays) return isoDate(addDays(today, Number(inDays[1])));

  return undefined;
}

function parseCabin(text: string): CabinClass | undefined {
  const lower = text.toLowerCase();
  if (/premium\s*economy/.test(lower)) return "premium_economy";
  if (/\bbusiness\b/.test(lower)) return "business";
  if (/\bfirst class\b|\bfirst\b(?!\s*time)/.test(lower)) return "first";
  if (/\beconomy\b|\bcheapest cabin\b/.test(lower)) return "economy";
  return undefined;
}

function parseWindow(fragment: string): TimeWindow | undefined {
  if (/early morning|red[- ]?eye|before 6/.test(fragment)) return "early_morning";
  if (/morning/.test(fragment)) return "morning";
  if (/afternoon/.test(fragment)) return "afternoon";
  if (/evening/.test(fragment)) return "evening";
  if (/night|late/.test(fragment)) return "night";
  return undefined;
}

interface Extraction {
  patch: TravelRequirements;
  understood: string[];
}

function extract(message: string, current: TravelRequirements, today: Date): Extraction {
  const patch: TravelRequirements = {};
  const understood: string[] = [];
  const lower = message.toLowerCase();

  const products = new Set(current.products ?? ["flights"]);
  if (/\b(hotel|stay|staying|accommodation|room|resort)\b/.test(lower)) products.add("hotels");
  if (/\b(flight|fly|flying)\b/.test(lower)) products.add("flights");
  patch.products = [...products];

  // ---- route -----------------------------------------------------------
  const STOP = "(?=[,.]|\\s+(?:on|next|in|for|this|tomorrow|with|by)\\b|$)";
  // "from X to Y" and the bare "X to Y" phrasing both resolve a full route.
  const fromTo =
    new RegExp(`\\bfrom\\s+([a-z\\s]{3,30}?)\\s+to\\s+([a-z\\s]{3,30}?)${STOP}`, "i").exec(message) ??
    new RegExp(`^\\s*(?:i\\s+want\\s+|i'd\\s+like\\s+|book\\s+|find\\s+|show\\s+)?([a-z\\s]{3,30}?)\\s+to\\s+([a-z\\s]{3,30}?)${STOP}`, "i").exec(message);
  if (fromTo) {
    const origin = findPlace(fromTo[1]!);
    const destination = findPlace(fromTo[2]!);
    if (origin) {
      patch.origin = origin.code;
      patch.originLabel = origin.label;
    }
    if (destination) {
      patch.destination = destination.code;
      patch.destinationLabel = destination.label;
    }
  } else {
    const toOnly = /\b(?:to|towards|visit|going to|fly to)\s+([a-z\s]{3,30}?)(?=[,.]|\s+(?:on|next|in|for|this|tomorrow|with|by)\b|$)/i.exec(
      message,
    );
    const fromOnly = /\b(?:from|departing from|leaving from)\s+([a-z\s]{3,30}?)(?=[,.]|\s+(?:on|next|in|for|this|tomorrow|with|by)\b|$)/i.exec(
      message,
    );
    if (fromOnly) {
      const origin = findPlace(fromOnly[1]!);
      if (origin) {
        patch.origin = origin.code;
        patch.originLabel = origin.label;
      }
    }
    if (toOnly) {
      const destination = findPlace(toOnly[1]!);
      if (destination) {
        patch.destination = destination.code;
        patch.destinationLabel = destination.label;
      }
    }
    if (!fromOnly && !toOnly) {
      const single = findPlace(message);
      if (single) {
        // A bare place answers whichever side is still open.
        if (!current.destination && current.origin) {
          patch.destination = single.code;
          patch.destinationLabel = single.label;
        } else if (!current.origin) {
          patch.origin = single.code;
          patch.originLabel = single.label;
        }
      }
    }
  }
  if (patch.origin) understood.push(`departing from ${patch.originLabel ?? patch.origin}`);
  if (patch.destination) understood.push(`flying to ${patch.destinationLabel ?? patch.destination}`);

  // ---- dates & duration ------------------------------------------------
  const returning = /\b(?:return(?:ing)?|coming back|back on)\b([^.]*)/i.exec(message);
  const departureSource = returning ? message.replace(returning[0], " ") : message;
  const departure = parseDate(departureSource, today);
  if (departure) {
    patch.departureDate = departure;
    understood.push("a departure date");
  }
  if (returning) {
    const back = parseDate(returning[1]!, today);
    if (back) {
      patch.returnDate = back;
      patch.tripType = "roundtrip";
    }
  }

  const duration = /\bfor\s+(\d{1,2})\s*(day|days|night|nights|week|weeks)\b/i.exec(lower);
  if (duration) {
    const amount = Number(duration[1]);
    const nights = /week/.test(duration[2]!) ? amount * 7 : amount;
    patch.durationNights = nights;
    patch.tripType = "roundtrip";
    const base = patch.departureDate ?? current.departureDate;
    if (base) {
      const start = new Date(`${base}T00:00:00`);
      patch.returnDate = isoDate(addDays(start, nights));
    }
    understood.push(`a ${nights}-night trip`);
  }

  const stayDuration = /\bstay(?:ing)?(?:\s+for)?\s+(\d{1,2})\s*(day|days|night|nights|week|weeks)\b/i.exec(lower);
  if (stayDuration) {
    const amount = Number(stayDuration[1]);
    const nights = /week/.test(stayDuration[2]!) ? amount * 7 : amount;
    patch.durationNights = nights;
    patch.tripType = "roundtrip";
    patch.products = [...new Set([...(patch.products ?? []), "flights", "hotels"] as const)];
    const base = patch.departureDate ?? current.departureDate;
    if (base) patch.returnDate = isoDate(addDays(new Date(`${base}T00:00:00`), nights));
  }

  if (/\bone[- ]?way\b/.test(lower)) patch.tripType = "oneway";
  if (/\bround[- ]?trip\b|\breturn trip\b/.test(lower)) patch.tripType = "roundtrip";

  // ---- passengers ------------------------------------------------------
  const adults = /(\d{1,2})\s*(?:adults?|grown[- ]?ups?)\b/.exec(lower);
  const children = /(\d{1,2})\s*(?:child|children|kids?)\b/.exec(lower);
  const infants = /(\d{1,2})\s*(?:infants?|babies|baby)\b/.exec(lower);
  const generic = /(\d{1,2})\s*(?:passengers?|travellers?|travelers?|people|persons?|pax)\b/.exec(lower);
  if (adults) patch.adults = Number(adults[1]);
  else if (generic) patch.adults = Number(generic[1]);
  if (children) patch.children = Number(children[1]);
  if (infants) patch.infants = Number(infants[1]);
  if (/\bsolo\b|\bjust me\b|\balone\b/.test(lower)) patch.adults = 1;
  if (patch.adults || patch.children || patch.infants) understood.push("traveller counts");

  // ---- cabin, timing, stops, baggage ----------------------------------
  const cabin = parseCabin(message);
  if (cabin) {
    patch.cabinClass = cabin;
    understood.push("a cabin preference");
  }

  const arrivalFragment = /\barriv\w*([^.]*)/i.exec(lower);
  if (arrivalFragment) {
    const window = parseWindow(arrivalFragment[0]);
    if (window) {
      patch.preferredArrivalWindow = window;
      understood.push("a preferred arrival time");
    }
  }
  const departureWindow = parseWindow(
    lower.replace(arrivalFragment ? arrivalFragment[0] : "", " "),
  );
  if (departureWindow) {
    if (/\b(return|coming back|back flight|inbound)\b/.test(lower)) {
      patch.preferredReturnWindow = departureWindow;
      understood.push("a preferred return time");
    } else {
      patch.preferredDepartureWindow = departureWindow;
      understood.push("a preferred departure time");
    }
  }

  const hotelArea = /\b(?:hotel|stay|room)s?\s+(?:near|around|in)\s+([a-z\s]{3,40}?)(?=[,.]|$)/i.exec(message);
  if (hotelArea) patch.hotelLocationPreference = hotelArea[1]!.trim();
  if (/\bcheaper|cheapest|lowest price|budget\b/.test(lower)) patch.resultSort = "cheapest";
  if (/\bfastest|shortest\b/.test(lower)) patch.resultSort = "fastest";

  if (/\bnon[- ]?stop\b|\bnonstop\b|\bdirect\b|\bno layover\b/.test(lower)) {
    patch.nonStopOnly = true;
    understood.push("non-stop only");
  }
  if (/\bwith stops? ok\b|\blayover.{0,12}(fine|ok)\b/.test(lower)) patch.nonStopOnly = false;

  let baggage: BaggagePreference | undefined;
  if (/\bcheck[- ]?in baggage\b|\bchecked baggage\b|\bluggage\b|\bwith baggage\b|\b(\d{1,2})\s*kg\b/.test(lower)) {
    baggage = "checked_baggage";
  }
  if (/\bhand baggage only\b|\bcabin (?:bag|baggage) only\b|\bno check[- ]?in\b/.test(lower)) {
    baggage = "cabin_only";
  }
  if (baggage) {
    patch.baggagePreference = baggage;
    understood.push("a baggage preference");
  }

  const airline = /\b(air india|indigo|vistara|emirates|etihad|qatar|spicejet|akasa|lufthansa|singapore airlines|thai airways|air arabia|flydubai)\b/.exec(
    lower,
  );
  if (airline) {
    const existing = current.preferredAirlines ?? [];
    const name = airline[1]!.replace(/\b\w/g, (c) => c.toUpperCase());
    if (!existing.includes(name)) patch.preferredAirlines = [...existing, name];
    understood.push("a preferred airline");
  }

  if (/\bflexible\b/.test(lower)) {
    const notes = current.notes ?? [];
    if (!notes.includes("Dates are flexible")) patch.notes = [...notes, "Dates are flexible"];
  }

  return { patch, understood };
}

const SMALL_TALK = /^(hi|hello|hey|namaste|good (morning|afternoon|evening))\b/i;

function buildReply(
  understood: string[],
  requirements: TravelRequirements,
  message: string,
): { reply: string; suggestions: string[] } {
  const missing = missingRequirements(requirements);
  const validation = toValidatedSearchRequest(requirements);

  if (SMALL_TALK.test(message) && understood.length === 0) {
    return {
      reply:
        "Hello! Tell me where you'd like to fly from and to, when you want to travel, and any preferences — cabin, timing or non-stop only.",
      suggestions: [
        "Ahmedabad to Dubai next month for 5 days, economy, morning flight",
        "One-way Mumbai to Singapore on 12 March, business class",
      ],
    };
  }

  if (understood.length === 0 && missing.length > 0) {
    return {
      reply: `I couldn't pick out travel details from that. ${missing[0]!.prompt}`,
      suggestions: ["Delhi to Bangkok on 20 April, 2 adults, non-stop"],
    };
  }

  const heard = understood.length
    ? `Got it — I noted ${understood.slice(0, 4).join(", ")}.`
    : "Noted.";

  if (missing.length > 0) {
    return { reply: missing[0]!.prompt, suggestions: [] };
  }

  if (!validation.ok) {
    return {
      reply: `${heard} One thing to fix first: ${validation.issues.join(" ")}`,
      suggestions: [],
    };
  }

  return {
    reply: `${heard} Your trip is ready to search.`,
    suggestions: ["Only evening flights", "Show cheaper options", "Hotels near the airport"],
  };
}

export function createDemoAssistantProvider(): AssistantProvider {
  return {
    id: "demo",
    async interpret(input: AssistantTurnRequest): Promise<AssistantTurnResponse> {
      // Small delay so the typing state is exercised realistically.
      await new Promise((resolve) => setTimeout(resolve, 450));

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { patch, understood } = extract(input.message, input.requirements, today);
      let requirements = mergeRequirements(input.requirements, patch);
      if (!requirements.tripType) {
        requirements = { ...requirements, tripType: requirements.returnDate ? "roundtrip" : "oneway" };
      }
      // Round-trip without a stated return date keeps the gap visible.
      const tripType: TripType = requirements.tripType ?? "oneway";

      const { reply, suggestions } = buildReply(understood, requirements, input.message);

      return {
        reply,
        requirements: { ...requirements, tripType },
        missing: missingRequirements(requirements),
        ready: isReady(requirements),
        suggestions,
        provider: "demo",
      };
    },
  };
}
