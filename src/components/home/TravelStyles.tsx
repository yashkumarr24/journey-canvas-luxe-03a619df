import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { domesticPackageDestinations } from "@/data/domestic-packages";
import { internationalPackages, internationalImage, internationalPrice } from "@/data/international-packages";

/**
 * "Stays for every travel style" — International and Domestic packages from our
 * own catalogue. Prices are shown exactly as written in the source quotations.
 */

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Card = { key: string; name: string; place: string; duration: string; price?: string; img: string; link: { kind: "intl" | "dom"; destination: string; pkg: string } };

const international: Card[] = internationalPackages.map((p) => ({
  key: `i-${p.slug}`,
  name: p.name,
  place: p.countries.join(", "),
  duration: p.duration,
  price: internationalPrice(p),
  img: internationalImage(p),
  link: { kind: "intl", destination: slugify(p.countries[0]), pkg: p.slug },
}));

const domestic: Card[] = domesticPackageDestinations.flatMap((d) =>
  d.packages.map((p) => ({
    key: `d-${d.slug}-${p.slug}`,
    name: p.name,
    place: `${d.name}, ${d.region}`,
    duration: p.duration,
    price: p.priceFrom,
    img: d.img,
    link: { kind: "dom" as const, destination: d.slug, pkg: p.slug },
  })),
);

const tabs = [
  { id: "international", label: `International (${international.length})`, cards: international, all: "/international-packages" },
  { id: "domestic", label: `Domestic (${domestic.length})`, cards: domestic, all: "/domestic-packages" },
] as const;

export function TravelStyles() {
  const [active, setActive] = useState<(typeof tabs)[number]["id"]>("international");
  const [expanded, setExpanded] = useState(false);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const shown = expanded ? current.cards : current.cards.slice(0, 8);

  return (
    <section aria-labelledby="travel-styles-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16">
      <p className="text-xs uppercase tracking-[0.25em] text-gold">Holidays</p>
      <h2 id="travel-styles-heading" className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-4xl">
        Stays for every travel style
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Hand-built itineraries from our own catalogue · indicative prices, enquire to book</p>

      <div role="tablist" aria-label="Package type" className="mt-5 flex flex-wrap gap-2 border-b border-foreground/10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => { setActive(tab.id); setExpanded(false); }}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              active === tab.id ? "border-gold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((card) => (
          <PackageCard key={card.key} card={card} />
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        {current.cards.length > 8 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-2 rounded-sm border border-foreground/15 px-5 py-3 text-sm font-medium transition-colors hover:border-gold hover:text-gold"
          >
            {expanded ? "Show fewer" : `Show all ${current.cards.length} packages`}
          </button>
        )}
        <a href={current.all} className="inline-flex items-center gap-2 rounded-sm bg-gold px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary">
          Browse {active === "international" ? "international" : "domestic"} destinations <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

function PackageCard({ card }: { card: Card }) {
  const inner = (
    <>
      <div className="aspect-[4/3] overflow-hidden rounded-xl border border-foreground/10">
        <img src={card.img} alt={card.place} loading="lazy" className="size-full object-cover transition-transform duration-700 group-hover:scale-105" />
      </div>
      <h3 className="mt-3 line-clamp-2 font-display text-lg font-semibold leading-snug transition-colors group-hover:text-gold">{card.name}</h3>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{card.place}</span></p>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />{card.duration}</p>
      {card.price && <p className="mt-2 line-clamp-2 text-sm font-semibold">{card.price}</p>}
    </>
  );
  const cls = "group block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2";
  return card.link.kind === "intl" ? (
    <Link to="/international-packages/$destination/$package" params={{ destination: card.link.destination, package: card.link.pkg }} className={cls}>{inner}</Link>
  ) : (
    <Link to="/domestic-packages/$destination/$package" params={{ destination: card.link.destination, package: card.link.pkg }} className={cls}>{inner}</Link>
  );
}
