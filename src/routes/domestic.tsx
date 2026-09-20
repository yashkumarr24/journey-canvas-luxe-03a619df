import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { Destinations } from "@/components/Destinations";
import { domesticDestinations } from "@/data/destinations";
import kashmirHero from "@/assets/kashmir.webp";

export const Route = createFileRoute("/domestic")({
  head: () => ({
    meta: [
      { title: "India Domestic Tour Packages — Fly n Feel Holidays" },
      { name: "description", content: "Explore India's most loved destinations — Kashmir, Goa, Kerala and Himachal — with hand‑crafted, end‑to‑end packages and guaranteed best prices." },
      { property: "og:title", content: "Domestic Tour Packages — Fly n Feel Holidays" },
      { property: "og:description", content: "Four signature India routes — Kashmir, Goa, Kerala, Himachal — designed end‑to‑end." },
      { property: "og:image", content: "" },
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
      <Destinations
        items={domesticDestinations}
        eyebrow={`${domesticDestinations.length} India destinations`}
        title={<>India's signature <span className="italic gold-gradient">destinations.</span></>}
        subtitle="Prices are quoted from destination airports for clarity. We can build a complete door‑to‑door package from your home city on request."
      />
      <Footer />
    </main>
  );
}
