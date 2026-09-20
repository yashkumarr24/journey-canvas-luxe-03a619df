import { createFileRoute, Link } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { ArrowRight, Globe2, MapPinned } from "lucide-react";
import holidaysHero from "@/assets/holidays-hero.jpg";
import kashmir from "@/assets/kashmir.jpg";
import maldives from "@/assets/maldives.jpg";

export const Route = createFileRoute("/holidays")({
  head: () => ({
    meta: [
      { title: "Holiday Packages — Fly n Feel Holidays" },
      { name: "description", content: "Choose from curated India domestic getaways and tailor-made international holidays — all with hand-crafted itineraries and guaranteed best prices." },
      { property: "og:title", content: "Holiday Packages — Fly n Feel Holidays" },
      { property: "og:description", content: "Domestic and international holiday packages designed around you." },
    ],
  }),
  component: HolidaysPage,
});

const options = [
  {
    label: "Domestic Holidays",
    detail: "India's signature destinations",
    to: "/domestic",
    icon: MapPinned,
    image: kashmir,
  },
  {
    label: "International Holidays",
    detail: "Curated escapes around the world",
    to: "/international",
    icon: Globe2,
    image: maldives,
  },
];

function HolidaysPage() {
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={holidaysHero}
        eyebrow="Holidays"
        title={<>Choose your next <span className="italic gold-gradient">holiday.</span></>}
        subtitle="Browse hand-crafted India packages or tailor-made international escapes — all designed around your dates, budget and travel style."
        lightText
      />

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
        <div className="grid gap-6 md:grid-cols-2">
          {options.map(({ label, detail, to, icon: Icon, image }) => (
            <Link
              key={label}
              to={to}
              className="group relative isolate flex min-h-[360px] flex-col justify-end overflow-hidden border border-foreground/10 bg-card p-8 transition-colors hover:bg-card/80 sm:p-10"
            >
              <img
                src={image}
                alt=""
                className="absolute inset-0 -z-20 size-full object-cover opacity-80 transition-transform duration-700 group-hover:scale-105"
              />
              <span className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/55 to-transparent/5" />
              <div className="relative z-10">
                <span className="mb-4 inline-flex size-12 items-center justify-center border border-foreground/10 bg-background text-gold">
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <h2 className="font-display text-3xl leading-none tracking-tight sm:text-4xl">
                  {label}
                </h2>
                <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {detail}
                </p>
                <span className="mt-6 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-foreground transition-colors group-hover:text-gold">
                  Explore packages <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
