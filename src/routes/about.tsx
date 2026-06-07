import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { Testimonials } from "@/components/Testimonials";
import { motion } from "framer-motion";
import hero from "@/assets/hero.jpg";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Fly n Feel Holidays — Travel Designers Since 2012" },
      { name: "description", content: "Ahmedabad‑based travel studio specialising in customised, group, corporate and personalised tours. End‑to‑end service since 2012." },
      { property: "og:title", content: "About Fly n Feel Holidays" },
      { property: "og:description", content: "Travel studio since 2012 — group, business, personalised and bespoke tours." },
    ],
  }),
  component: About,
});

const services = [
  "Domestic packages",
  "International packages",
  "Private tours",
  "Group tours",
  "Corporate tours",
  "Customised tours",
];

const offers = [
  { t: "Always available for assistance", d: "A real travel desk that answers — before, during and after your trip." },
  { t: "Affordable exotic vacations", d: "Years of preferred‑rate relationships with hotels, airlines and transport." },
  { t: "Customers at the core", d: "We don't sell every destination. We go deep in the places we know best." },
];

function About() {
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={hero}
        eyebrow="About Us"
        title={<>A travel studio <span className="italic gold-gradient">since 2012.</span></>}
        subtitle="Ahmedabad‑based, with desks in Dubai and Bangkok. We specialise in group tours, business tours, personalised tours and custom tours."
      />

      <section className="mx-auto max-w-4xl px-6 py-20">
        <p className="text-lg leading-relaxed text-foreground/90">
          Fly n Feel Holidays is your trusted partner in creating unforgettable travel experiences. Founded with a passion for exploring the world and a commitment to providing exceptional service, we are a premier travel agency dedicated to turning your dream vacations into reality.
        </p>
        <p className="mt-6 text-muted-foreground leading-relaxed">
          We are an Ahmedabad‑based travel company providing services from Ahmedabad or any city in Gujarat to your selected destinations. We also provide on‑arrival services at the destination — customised tours, airline tickets and accommodation.
        </p>
        <p className="mt-6 text-muted-foreground leading-relaxed">
          We offer holiday packages and tailor‑made tours across India, Nepal, Bhutan, Tibet, Sri Lanka and the Maldives at competitive prices. Rather than offering every possible destination, we focus on the places where we have genuine expertise — and provide comprehensive guidance for every itinerary. Our end‑to‑end services include flight booking, visa, airport transfers, hotel bookings, meals, sightseeing and proper GST billing.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="font-display text-3xl md:text-5xl">Since 2012 we have served</h2>
        <div className="hairline mt-6" />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {services.map((s, i) => (
            <motion.div key={s} initial={{ y: 30, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.05 }} className="rounded-2xl border border-foreground/10 bg-card/60 p-6">
              <div className="font-display text-3xl text-gold">0{i + 1}</div>
              <div className="mt-3 font-display text-xl">{s}</div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {offers.map((o) => (
            <div key={o.t} className="rounded-3xl border border-foreground/10 bg-card/60 p-8">
              <h3 className="font-display text-2xl text-gold">{o.t}</h3>
              <p className="mt-3 text-sm text-muted-foreground">{o.d}</p>
            </div>
          ))}
        </div>
      </section>

      <Testimonials />
      <Footer />
    </main>
  );
}
