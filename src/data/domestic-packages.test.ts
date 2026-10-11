import { describe, expect, test } from "bun:test";
import { domesticPackageDestinations, findDomesticPackageDestination } from "./domestic-packages";

describe("domestic package calendar dates", () => {
  test("removes specific travel dates without removing durations or itinerary day numbers", () => {
    const calendarDate = /\b\d{1,2}[\s-]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\b(?:November|December) 2026\b/i;
    for (const destination of domesticPackageDestinations) {
      for (const pkg of destination.packages) {
        expect(pkg.tour.some((fact) => /travel date|travel month|^check-in$|^check-out$/i.test(fact.label))).toBe(false);
        expect(calendarDate.test(JSON.stringify(pkg))).toBe(false);
        expect(pkg.itinerary.every((day) => /^Day \d+$/.test(day.day))).toBe(true);
        expect(pkg.options.every((option) => option.hotels.every((row) => row.length === option.columns.length))).toBe(true);
      }
    }
    const andaman = findDomesticPackageDestination("andaman")?.packages[0];
    expect(andaman?.duration).toBe("5 Nights / 6 Days");
    expect(andaman?.itinerary.length).toBe(6);
    expect(andaman?.priceFrom).toBe("INR 63,510 for 2 Pax");
  });
});