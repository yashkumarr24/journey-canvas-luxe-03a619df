import { describe, expect, it } from "vitest";
import { FEATURED_CITIES, pickFeaturedCity } from "./FeaturedStays";

describe("pickFeaturedCity", () => {
  it("keeps a visitor's stored city", () => {
    expect(pickFeaturedCity("Paris", 0)).toBe("Paris");
  });
  it("gives different visitors different cities, not only Dubai", () => {
    expect(pickFeaturedCity(null, 0)).toBe(FEATURED_CITIES[0]);
    expect(pickFeaturedCity(null, 0.99)).toBe(FEATURED_CITIES[FEATURED_CITIES.length - 1]);
    expect(pickFeaturedCity(null, 0.99)).not.toBe("Dubai");
  });
  it("ignores an unknown stored value", () => {
    expect(FEATURED_CITIES).toContain(pickFeaturedCity("Atlantis", 0.5));
  });
});
