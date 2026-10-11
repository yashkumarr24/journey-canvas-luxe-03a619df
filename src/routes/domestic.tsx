import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { DestinationCard } from "@/components/Destinations";
import { SectionTitle } from "@/components/Section";
import { domesticDestinations } from "@/data/destinations";
import { domesticPackageDestinations } from "@/data/domestic-packages";
import kashmirHero from "@/assets/kashmir.webp";

export const Route = createFileRoute("/domestic")({
  head: () => ({
    meta: [
      { title: "India Domestic Tour Packages — Fly n Feel Holidays" },
      { name: "description", content: "Explore India's most loved destinations — Kashmir, Goa, Kerala and Himachal — with hand‑crafted, end‑to‑end packages and guaranteed best prices." },
      { property: "og:title", content: "Domestic Tour Packages — Fly n Feel Holidays" },
      { property: "og:description", content: "Explore India's signature destinations and domestic holiday packages with Fly n Feel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DomesticPage,
});

function DomesticPage() {
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={kashmirHero}
        eyebrow="India · Domestic"
        title={<>Explore <span className="italic gold-gradient">India's</span> tour packages</>}
        subtitle="We offer a guaranteed lowest price on India holiday packages. Browse by destination, choose a route, and we'll quote your departure city — Ahmedabad or anywhere — with the best mix of car, train and air."
        lightText
      />
      <section className="relative mx-auto max-w-7xl border-t border-foreground/10 px-6 py-24 md:py-32">
        <SectionTitle
          eyebrow={`${new Set([...domesticDestinations, ...domesticPackageDestinations].map((d) => d.slug)).size} India destinations`}
          title={<>India's signature <span className="italic gold-gradient">destinations.</span></>}
          subtitle="Prices are quoted from destination airports for clarity. We can build a complete door‑to‑door package from your home city on request."
        />
        <div className="mt-14 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {domesticDestinations.map((d, i) => (
            <DestinationCard key={`existing-${d.slug}`} p={d} index={i} />
          ))}
          {domesticPackageDestinations.map((d, i) => (
            <DestinationCard
              key={d.slug}
              index={i + domesticDestinations.length}
              badge={null}
              cta="View Packages"
              link={{ to: "/domestic-packages/$destination", params: { destination: d.slug } }}
              p={{
                slug: d.slug,
                name: d.name,
                country: d.region,
                tagline: `${d.packages.length} ${d.packages.length === 1 ? "package" : "packages"}`,
                price: d.packages.find((p) => p.priceFrom)?.priceFrom ?? "Price on request",
                nights: d.packages.map((p) => p.duration.replace(/\s*\/\s*/, "/")).join(" · ").slice(0, 60),
                img: d.img,
              }}
            />
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
