import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { SmoothScroll } from "@/components/SmoothScroll";
import { Cursor } from "@/components/Cursor";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Marquee } from "@/components/Marquee";
import { Destinations } from "@/components/Destinations";
import { Experiences } from "@/components/Experiences";
import { Testimonials } from "@/components/Testimonials";
import { Footer } from "@/components/Footer";
import { ScrollProgress } from "@/components/ScrollProgress";
import { SectionTitle } from "@/components/Section";
import { domesticDestinations, internationalDestinations } from "@/data/destinations";
import { posts } from "@/data/posts";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fly n Feel Holidays — Bespoke Luxury Travel, Since 2012" },
      { name: "description", content: "Hand‑crafted itineraries to Kashmir, Kerala, Vietnam, Dubai, Bangkok and beyond. Travel, beautifully designed." },
      { property: "og:title", content: "Fly n Feel Holidays — Bespoke Luxury Travel" },
      { property: "og:description", content: "Travel with trust. World‑class service, best‑price guarantee, fully customised tours since 2012." },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Index,
});

const valueProps = [
  { t: "World‑Class Services", d: "End‑to‑end service with hand‑picked classic hotels and advance planning for a seamless journey." },
  { t: "Best‑Price Guarantee", d: "Long‑standing tie‑ups with airlines, hotels and ground transport let us secure better rates for you." },
  { t: "Customised Tours", d: "Every itinerary is composed around your preferences — multiple options, one perfect trip." },
];

function ValueProps() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24 md:py-32">
      <SectionTitle
        eyebrow="Travel with Trust"
        title={<>Fly n Feel Holidays — <span className="italic gold-gradient">serving since 2012.</span></>}
        subtitle="A small studio of travel designers. We don't sell every destination — we go deep in the places we know best, and we design the rest around you."
      />
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {valueProps.map((v, i) => (
          <motion.div
            key={v.t}
            initial={{ y: 40, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.8, delay: i * 0.1 }}
            className="group rounded-3xl border border-foreground/10 bg-card/60 p-8 transition-all hover:border-gold/30"
          >
            <div className="font-display text-3xl text-gold">0{i + 1}</div>
            <h3 className="mt-4 font-display text-2xl">{v.t}</h3>
            <p className="mt-3 text-sm text-muted-foreground">{v.d}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function BlogTeaser() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24 md:py-32">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <SectionTitle
          eyebrow="The Journal"
          title={<>Stories from <span className="italic gold-gradient">the road.</span></>}
          subtitle="A growing library of field notes, planning guides and quiet recommendations from our travel desk."
        />
        <Link to="/blog" className="text-sm text-muted-foreground transition-colors hover:text-gold">View the journal →</Link>
      </div>

      <div className="mt-14 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
        {posts.map((p, i) => (
          <motion.div
            key={p.slug}
            initial={{ y: 50, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, delay: i * 0.1 }}
          >
            <Link to="/blog/$slug" params={{ slug: p.slug }} className="group block">
              <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-foreground/10">
                <img src={p.cover} alt={p.title} loading="lazy" className="size-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-110" />
              </div>
              <div className="mt-5 flex items-center justify-between text-xs uppercase tracking-[0.25em] text-muted-foreground">
                <span className="text-gold">Travel Guide</span>
                <span>{p.read}</span>
              </div>
              <h3 className="mt-3 font-display text-2xl leading-snug transition-colors group-hover:text-gold">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.excerpt}</p>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function CTABand() {
  return (
    <section className="relative overflow-hidden px-6 py-24">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_50%,oklch(0.82_0.13_85/0.12),transparent_65%)]" />
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="font-display text-4xl md:text-6xl">
          Let's plan something <span className="italic gold-gradient">beautiful.</span>
        </h2>
        <p className="mt-5 text-muted-foreground">
          Tell us how you like to travel — solo, with someone, or a private group — and we'll compose an itinerary with negotiated rates you won't find online.
        </p>
        <Link to="/contact" className="mt-8 inline-flex items-center gap-3 rounded-full bg-gold px-7 py-4 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]">
          Start a Journey →
        </Link>
      </div>
    </section>
  );
}

function Index() {
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Cursor />
      <Nav />
      <Hero />
      <Marquee />
      <ValueProps />
      <Destinations
        items={domesticDestinations}
        id="destinations"
        eyebrow="India · Domestic Tours"
        title={<>Hand‑picked escapes <span className="italic gold-gradient">across India</span></>}
        subtitle="From the Himalayas to the Arabian Sea — each itinerary is crafted with private guides, considered hotels and seamless transfers."
      />
      <Destinations
        items={internationalDestinations}
        eyebrow="The World · International Tours"
        title={<>The world, <span className="italic gold-gradient">tailored to you.</span></>}
        subtitle="Five international routes designed around comfort, value and time well spent — from Halong Bay to the Dubai dunes."
      />
      <Experiences />
      <Testimonials />
      <BlogTeaser />
      <CTABand />
      <Footer />
    </main>
  );
}
