export type DbPackageCard = {
  slug: string;
  name: string;
  duration_nights: number | null;
  duration_days: number | null;
  departure_city: string | null;
  indicative_price_from: number | null;
  currency: string;
  price_basis: string | null;
  overview: string | null;
  image: string | null;
};

export type DbDestination = {
  slug: string;
  name: string;
  country: string;
  summary: string | null;
  image: string | null;
  packages: DbPackageCard[];
};

export type DbHotel = {
  city: string | null;
  hotel_name: string;
  star_rating: number | null;
  room_type: string | null;
  nights: number | null;
  meal_plan: string | null;
  is_similar: boolean;
};

export type DbOption = {
  option_name: string;
  indicative_price: number | null;
  currency: string;
  price_basis: string | null;
  child_price_notes: string | null;
  single_supplement: number | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  hotels: DbHotel[];
};

export type DbPackageDetail = {
  slug: string;
  name: string;
  package_code: string | null;
  duration_nights: number | null;
  duration_days: number | null;
  departure_city: string | null;
  travel_validity_from: string | null;
  travel_validity_to: string | null;
  indicative_price_from: number | null;
  currency: string;
  price_basis: string | null;
  meal_plan: string | null;
  overview: string | null;
  highlights: string[];
  destination: { slug: string; name: string; country: string };
  images: { url: string; alt: string | null }[];
  options: DbOption[];
  itinerary: { day_number: number; title: string; description: string | null; meals: string[]; overnight_city: string | null }[];
  inclusions: string[];
  exclusions: string[];
  flights: {
    option_name: string | null;
    sector: string | null;
    airline: string | null;
    flight_no: string | null;
    depart_time: string | null;
    arrive_time: string | null;
    is_included: boolean;
    notes: string | null;
  }[];
  notes: { kind: string; text: string }[];
  departures: { departure_date: string; seats_note: string | null; price_override: number | null }[];
};

export function formatPrice(v: number | null, currency: string): string | null {
  if (v == null) return null;
  const n = Number(v);
  if (currency.trim() === "INR") return `₹ ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return `${currency.trim()} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function formatDuration(n: number | null, d: number | null): string | null {
  if (n == null && d == null) return null;
  return [n != null ? `${n} Nights` : null, d != null ? `${d} Days` : null].filter(Boolean).join(" · ");
}
