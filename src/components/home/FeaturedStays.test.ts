import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FEATURED_CITIES, pickFeaturedCity } from "./featured-cities";

describe("pickFeaturedCity", () => {
  it("keeps a visitor's stored city", () => {
    assert.equal(pickFeaturedCity("Paris", 0), "Paris");
  });
  it("gives different visitors different cities, not only Dubai", () => {
    assert.equal(pickFeaturedCity(null, 0), FEATURED_CITIES[0]);
    assert.notEqual(pickFeaturedCity(null, 0.99), "Dubai");
  });
  it("ignores an unknown stored value", () => {
    assert.ok(FEATURED_CITIES.includes(pickFeaturedCity("Atlantis", 0.5)));
  });
});
