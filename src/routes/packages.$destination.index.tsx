import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { SectionTitle } from "@/components/Section";
import { DestinationCard } from "@/components/Destinations";
import { listInternationalCatalogue } from "@/lib/packages/packages.functions";
import { formatDuration, formatPrice } from "@/lib/packages/types";
import fallbackHero from "@/assets/vietnam.webp";

export const Route = createFileRoute("/packages/$destination/")({
  loader: async ({ params }) => {
    const all = await listInternationalCatalogue();
    const d = all.find((x) => x.slug === params.destination);
    if (!d) throw notFound();
    return d;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Unavailable | Fly n Feel Holidays" }, { name: "robots", content: "noindex" }] };
    const t = `${loaderData.name} Holiday Packages | Fly n Feel Holidays`;
    const desc = loaderData.summary ?? `${loaderData.name} holiday packages.`;
    return {
      meta: [
        { title: t },
        { name: "description", content: desc },
        { property: "og:title", content: t },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center">
      <Link to="/international" className="text-gold">Destination not found — see all international escapes →</Link>
    </div>
  ),
  errorComponent: () => (
    <div className="grid min-h-screen place-items-center">
      <Link to="/international" className="text-gold">Something went wrong — return to international →</Link>
    </div>
  ),
  component: CatalogueDestinationPage,
});

function CatalogueDestinationPage() {
  const d = Route.useLoaderData();
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero
        image={d.image ?? fallbackHero}
        eyebrow={`International · ${d.country}`}
        title={<>{d.name}</>}
        subtitle={d.summary ?? undefined}
        height="80svh"
        lightText
      />
      <section className="relative mx-auto max-w-7xl border-t border-foreground/10 px-6 py-24 md:py-32">
        <SectionTitle
          eyebrow={`${d.packages.length} ${d.packages.length === 1 ? "package" : "packages"}`}
          title={<>{d.name} <span className="italic gold-gradient">packages</span></>}
          subtitle="Prices shown are indicative starting prices, subject to availability. Enquire for a confirmed quote."
        />
        <div className="mt-14 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {d.packages.map((p, i) => (
            <DestinationCard
              key={p.slug}
              index={i}
              badge={null}
              cta="View Package"
              priceNote={p.indicative_price_from != null ? "Indicative from" : undefined}
              link={{ to: "/packages/$destination/$package", params: { destination: d.slug, package: p.slug } }}
              p={{
                slug: p.slug,
                name: p.name,
                country: d.country,
                tagline: p.departure_city ?? "",
                price: formatPrice(p.indicative_price_from, p.currency) ?? "Price on request",
                nights: formatDuration(p.duration_nights, p.duration_days) ?? "",
                img: p.image ?? d.image ?? fallbackHero,
              }}
            />
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
