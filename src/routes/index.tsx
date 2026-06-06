import { createFileRoute } from "@tanstack/react-router";
import { SmoothScroll } from "@/components/SmoothScroll";
import { Cursor } from "@/components/Cursor";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Marquee } from "@/components/Marquee";
import { Destinations } from "@/components/Destinations";
import { Experiences } from "@/components/Experiences";
import { Membership } from "@/components/Membership";
import { Testimonials } from "@/components/Testimonials";
import { Journal } from "@/components/Journal";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fly n Feel Holidays — Bespoke Luxury Travel, Since 2012" },
      { name: "description", content: "A small studio of travel designers crafting bespoke, considered journeys to India and across the world. Members‑only fares, private guides, and white‑glove service." },
      { property: "og:title", content: "Fly n Feel Holidays — Bespoke Luxury Travel" },
      { property: "og:description", content: "Hand‑crafted itineraries to Kashmir, Kerala, Vietnam, Dubai and beyond. Travel, beautifully designed." },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="relative bg-background text-foreground">
      <SmoothScroll />
      <Cursor />
      <Nav />
      <Hero />
      <Marquee />
      <Destinations />
      <Experiences />
      <Membership />
      <Testimonials />
      <Journal />
      <Contact />
      <Footer />
    </main>
  );
}
