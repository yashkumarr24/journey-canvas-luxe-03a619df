import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { destinations } from "@/data/destinations";

/**
 * "Stays for every travel style" — tabbed destination cards built from the
 * existing package catalogue. Prices come straight from the catalogue data;
 * nothing is invented.
 */

const tabs = [
  { id: "mountains", label: "Mountains", slugs: ["kashmir", "himachal"] },
  { id: "beaches", label: "Beaches", slugs: ["goa", "kerala"] },
  { id: "culture", label: "Culture", slugs: ["vietnam", "bangkok-pattaya"] },
  { id: "city", label: "City breaks", slugs: ["dubai", "singapore-malaysia", "baku"] },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function TravelStyles() {
  const [active, setActive] = useState<TabId>("mountains");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  const shown = current.slugs
    .map((slug) => destinations.find((d) => d.slug === slug))
    .filter((d): d is (typeof destinations)[number] => Boolean(d));

  return (
    <section aria-labelledby="travel-styles-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16">
      <p className="text-xs uppercase tracking-[0.25em] text-gold">Holidays</p>
      <h2 id="travel-styles-heading" className="mt-2 font-display text-3xl leading-tight sm:text-4xl">
        Stays for every travel style
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Hand-built itineraries from our own catalogue</p>

      <div role="tablist" aria-label="Travel styles" className="mt-5 flex flex-wrap gap-2 border-b border-foreground/10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              active === tab.id
                ? "border-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((destination, i) => (
          <motion.div
            key={destination.slug}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: i * 0.06 }}
          >
            <Link
              to="/destinations/$slug"
              params={{ slug: destination.slug }}
              className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 rounded-xl"
            >
              <div className="aspect-[4/3] overflow-hidden rounded-xl border border-foreground/10">
                <img
                  src={destination.img}
                  alt={destination.name}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
              </div>
              <h3 className="mt-3 font-display text-xl font-semibold leading-tight transition-colors group-hover:text-gold">
                {destination.name}
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{destination.country}</p>
              <p className="mt-2 text-sm">
                <span className="font-semibold">{destination.price}</span>{" "}
                <span className="text-muted-foreground">· {destination.nights}</span>
              </p>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="mt-8">
        <Link
          to="/holidays"
          className="inline-flex items-center gap-2 rounded-sm border border-foreground/15 px-5 py-3 text-sm font-medium transition-colors hover:border-gold hover:text-gold"
        >
          Explore all holidays <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
