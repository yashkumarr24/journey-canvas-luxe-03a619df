import { describe, test } from "node:test";
import { strict as assert } from "node:assert";
import { domesticPackageDestinations, findDomesticPackageDestination } from "./domestic-packages";

describe("domestic package calendar dates", () => {
  test("removes specific travel dates without removing durations or itinerary day numbers", () => {
    const calendarDate = /\b\d{1,2}[\s-]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\b(?:November|December) 2026\b/i;
    for (const destination of domesticPackageDestinations) {
      for (const pkg of destination.packages) {
        assert.equal(pkg.tour.some((fact) => /travel date|travel month|^check-in$|^check-out$/i.test(fact.label)), false);
        assert.equal(calendarDate.test(JSON.stringify(pkg)), false);
        assert.equal(pkg.itinerary.every((day) => /^Day \d+$/.test(day.day)), true);
        assert.equal(pkg.options.every((option) => option.hotels.every((row) => row.length === option.columns.length)), true);
      }
    }
    const andaman = findDomesticPackageDestination("andaman")?.packages[0];
    assert.equal(andaman?.duration, "5 Nights / 6 Days");
    assert.equal(andaman?.itinerary.length, 6);
    assert.equal(andaman?.priceFrom, "INR 63,510 for 2 Pax");
  });
});