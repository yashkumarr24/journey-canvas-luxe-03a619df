import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { domesticPackageDestinations } from "@/data/domestic-packages";
import { internationalPackageDestinations } from "@/data/international-packages";

/** "Explore a world of travel" — quick links into hotel search and our package destinations. */
const indiaHotels = ["Goa", "Mumbai", "New Delhi", "Jaipur", "Udaipur", "Manali", "Srinagar", "Munnar", "Shimla", "Bengaluru", "Port Blair", "Rishikesh"];
const worldHotels = ["Dubai", "Singapore", "Bangkok", "Bali", "Phuket", "Kuala Lumpur", "Maldives", "London", "Paris", "Istanbul", "Baku", "Hanoi"];

const tabs = [
  { id: "india", label: "Hotels in India" },
  { id: "world", label: "Hotels abroad" },
  { id: "domestic", label: "Domestic holidays" },
  { id: "international", label: "International holidays" },
] as const;

export function ExploreLinks() {
  const [active, setActive] = useState<(typeof tabs)[number]["id"]>("india");
  const linkCls = "block truncate py-1 text-sm text-muted-foreground transition-colors hover:text-gold";
  return (
    <section aria-labelledby="explore-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 md:py-16">
      <h2 id="explore-heading" className="font-display text-3xl font-semibold leading-tight sm:text-4xl">Explore a world of travel with Fly n Feel</h2>
      <div role="tablist" aria-label="Explore" className="mt-5 flex gap-2 overflow-x-auto border-b border-foreground/10">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={active === t.id} onClick={() => setActive(t.id)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active === t.id ? "border-gold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <ul role="tabpanel" className="mt-5 grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-4">
        {(active === "india" || active === "world") &&
          (active === "india" ? indiaHotels : worldHotels).map((city) => (
            <li key={city}><Link to="/hotels" search={{ destination: city }} className={linkCls}>{city} hotels</Link></li>
          ))}
        {active === "domestic" && domesticPackageDestinations.map((d) => (
          <li key={d.slug}><Link to="/domestic-packages/$destination" params={{ destination: d.slug }} className={linkCls}>{d.name} packages</Link></li>
        ))}
        {active === "international" && internationalPackageDestinations.map((d) => (
          <li key={d.slug}><Link to="/international-packages/$destination" params={{ destination: d.slug }} className={linkCls}>{d.name} packages</Link></li>
        ))}
      </ul>
    </section>
  );
}
