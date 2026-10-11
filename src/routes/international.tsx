import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { Destinations, DestinationCard } from "@/components/Destinations";
import { SectionTitle } from "@/components/Section";
import { internationalDestinations } from "@/data/destinations";
import { listInternationalCatalogue } from "@/lib/packages/packages.functions";
import { formatPrice } from "@/lib/packages/types";
import vietnamHero from "@/assets/vietnam.webp";
import { internationalPackageDestinations, internationalDestinationImage, internationalPrice } from "@/data/international-packages";
import { destinationPhotoStop } from "@/data/international-photo-selection";
import { InternationalPhotoCredit } from "@/components/InternationalPhotoCredit";

export const Route = createFileRoute("/international")({
  loader: async () => {
    try {
      return await listInternationalCatalogue();
    } catch {
      return [];
    }
  },
  head: () => ({
    meta: [
      { title: "International Tour Packages — Fly n Feel Holidays" },
      { name: "description", content: "Five international routes designed around comfort, value and time well spent — Vietnam, Azerbaijan, Dubai, Singapore‑Malaysia and Thailand." },
      { property: "og:title", content: "International Tour Packages — Fly n Feel Holidays" },
      { property: "og:description", content: "Tailor‑made international holidays with visa, flights and on‑ground support." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: () => <div className="grid min-h-screen place-items-center text-gold">Something went wrong.</div>,
  notFoundComponent: () => <div className="grid min-h-screen place-items-center text-gold">Not found.</div>,
  component: InternationalPage,
});

function InternationalPage() {
  const catalogue = Route.useLoaderData();
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
      <section className="relative mx-auto max-w-7xl border-t border-foreground/10 px-6 py-24 md:py-32">
        <SectionTitle eyebrow="Countries & cities" title={<>Explore <span className="italic gold-gradient">international holidays</span></>} subtitle="Complete itineraries with source-quoted hotels and prices. Enquire for a confirmed quote." />
        <div className="mt-14 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {internationalPackageDestinations.map((d, i) => {
            const p = d.packages[0];
            if (!p) return null;
            return <div key={d.slug}><DestinationCard index={i} badge={null} cta="View Packages" link={{ to: "/international-packages/$destination", params: { destination: d.slug } }} p={{ slug: d.slug, name: d.name, country: p.countries.join(" · "), tagline: `${d.packages.length} packages`, price: internationalPrice(p), nights: "", img: internationalDestinationImage(d.name, p) }} /><InternationalPhotoCredit place={destinationPhotoStop(d.name, p.slug)} /></div>;
          })}
        </div>
      </section>
      {catalogue.length > 0 && (
        <section className="relative mx-auto max-w-7xl border-t border-foreground/10 px-6 py-24 md:py-32">
          <SectionTitle
            eyebrow={`${catalogue.length} destinations · ${catalogue.reduce((n, d) => n + d.packages.length, 0)} packages`}
            title={<>More <span className="italic gold-gradient">holiday packages</span></>}
            subtitle="Indicative starting prices, subject to availability. Enquire for a confirmed quote."
          />
          <div className="mt-14 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
            {catalogue.map((d, i) => {
              const priced = d.packages.filter((p) => p.indicative_price_from != null);
              const min = priced.length ? priced.reduce((a, b) => (Number(b.indicative_price_from) < Number(a.indicative_price_from) ? b : a)) : null;
              return (
                <DestinationCard
                  key={d.slug}
                  index={i}
                  badge={null}
                  cta="View Packages"
                  priceNote={min ? "Indicative from" : undefined}
                  link={{ to: "/packages/$destination", params: { destination: d.slug } }}
                  p={{
                    slug: d.slug,
                    name: d.name,
                    country: d.country,
                    tagline: d.summary ?? "",
                    price: min ? formatPrice(min.indicative_price_from, min.currency) ?? "" : "Price on request",
                    nights: `${d.packages.length} ${d.packages.length === 1 ? "package" : "packages"}`,
                    img: d.image ?? vietnamHero,
                  }}
                />
              );
            })}
          </div>
        </section>
      )}
      <Footer />
    </main>
  );
}
