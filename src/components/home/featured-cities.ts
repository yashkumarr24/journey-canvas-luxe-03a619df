export const FEATURED_CITIES = ["Dubai", "Singapore", "Bangkok", "Bali", "Goa", "Mumbai", "Jaipur", "Udaipur", "Maldives", "London", "Paris", "Phuket"];

export function pickFeaturedCity(stored: string | null, random = Math.random()) {
  if (stored && FEATURED_CITIES.includes(stored)) return stored;
  return FEATURED_CITIES[Math.floor(random * FEATURED_CITIES.length) % FEATURED_CITIES.length];
}
