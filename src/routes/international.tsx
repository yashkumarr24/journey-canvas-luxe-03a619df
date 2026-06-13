import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { Destinations } from "@/components/Destinations";
import { internationalDestinations } from "@/data/destinations";
import vietnamHero from "@/assets/vietnam.jpg";

export const Route = createFileRoute("/international")({
  head: () => ({
    meta: [
      { title: "International Tour Packages — Fly n Feel Holidays" },
      { name: "description", content: "Five international routes designed around comfort, value and time well spent — Vietnam, Azerbaijan, Dubai, Singapore‑Malaysia and Thailand." },
      { property: "og:title", content: "International Tour Packages — Fly n Feel Holidays" },
      { property: "og:description", content: "Tailor‑made international holidays with visa, flights and on‑ground support." },
    ],
  }),
  component: InternationalPage,
});

function InternationalPage() {
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={vietnamHero}
        eyebrow="The World · International"
        title={<>The world, <span className="italic gold-gradient">tailored to you.</span></>}
        subtitle="Tell us how you like to travel — solo, with someone, or as a private group of family, friends or colleagues — and we'll compose a tailor‑made itinerary at our best negotiated rates."
        lightText
      />
      <Destinations
        items={internationalDestinations}
        eyebrow={`${internationalDestinations.length} international destinations`}
        title={<>Curated <span className="italic gold-gradient">international</span> escapes</>}
        subtitle="Prices are quoted from destination airports. We can build a complete package from Ahmedabad or any Indian city with the best airfares, visa and insurance."
      />
      <Footer />
    </main>
  );
}
