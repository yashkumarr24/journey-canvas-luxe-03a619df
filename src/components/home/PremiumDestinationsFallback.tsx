import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import dubai from "@/assets/dubai.webp";
import maldives from "@/assets/maldives.webp";
import singapore from "@/assets/singapore.webp";
import goa from "@/assets/goa.webp";
import { blankRoom } from "@/lib/hotel-search";

/** Shown when live hotel rates are unavailable. Never shows prices. */
const DESTINATIONS = [
  { city: "Dubai", image: dubai, blurb: "Skyline suites and desert resorts" },
  { city: "Maldives", image: maldives, blurb: "Overwater villas on private lagoons" },
  { city: "Singapore", image: singapore, blurb: "Iconic hotels around Marina Bay" },
  { city: "Goa", image: goa, blurb: "Beachfront retreats and boutique stays" },
];

export function PremiumDestinationsFallback({ checkIn, checkOut }: { checkIn: string; checkOut: string }) {
  return (
    <section aria-labelledby="premium-destinations-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16">
      <p className="text-xs uppercase tracking-[0.25em] text-gold">Hotels</p>
      <h2 id="premium-destinations-heading" className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-4xl">
        Premium destinations to explore
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Search to see live rates and availability for your dates.</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DESTINATIONS.map((d) => (
          <li key={d.city} className="min-w-0">
            <Link
              to="/hotels"
              search={{ destination: d.city, checkIn, checkOut, rooms: [blankRoom()], nationality: "IN", currency: "INR" }}
              className="group block overflow-hidden rounded-xl border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={d.image} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105" />
              <div className="p-4">
                <h3 className="font-display text-lg font-semibold">Luxury stays in {d.city}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d.blurb}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Check live rates<ArrowRight className="size-4" aria-hidden="true" />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
