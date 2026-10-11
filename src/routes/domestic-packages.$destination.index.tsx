import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SmoothScroll } from "@/components/SmoothScroll";
import { ScrollProgress } from "@/components/ScrollProgress";
import { PageHero } from "@/components/PageHero";
import { SectionTitle } from "@/components/Section";
import { DestinationCard } from "@/components/Destinations";
import { findDomesticPackageDestination } from "@/data/domestic-packages";

export const Route = createFileRoute("/domestic-packages/$destination/")({
  loader: ({ params }) => {
    const d = findDomesticPackageDestination(params.destination);
    if (!d) throw notFound();
    return d;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Unavailable | Fly n Feel Holidays" }, { name: "robots", content: "noindex" }] };
    const t = `${loaderData.name} Holiday Packages | Fly n Feel Holidays`;
    const desc = `${loaderData.packages.length} ${loaderData.name} holiday packages with hotel details, day-wise itinerary, inclusions and exclusions.`;
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
      <Link to="/domestic" className="text-gold">Destination not found — see all India packages →</Link>
    </div>
  ),
  component: DomesticPackageDestinationPage,
});

function DomesticPackageDestinationPage() {
  const d = Route.useLoaderData();
  return (
    <main className="relative bg-background text-foreground">
      <ScrollProgress />
      <SmoothScroll />
      <Nav />
      <PageHero image={d.img} eyebrow={`India · ${d.region}`} title={<>{d.name}</>} height="80svh" lightText />
      <section className="relative mx-auto max-w-7xl border-t border-foreground/10 px-6 py-24 md:py-32">
        <SectionTitle
          eyebrow={`${d.packages.length} ${d.packages.length === 1 ? "package" : "packages"}`}
          title={<>{d.name} <span className="italic gold-gradient">packages</span></>}
          subtitle="Prices shown are as quoted, subject to availability. Enquire for a confirmed quote."
        />
        <div className="mt-14 grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {d.packages.map((p, i) => (
            <DestinationCard
              key={p.slug}
              index={i}
              badge={null}
              cta="View Package"
              priceNote={p.priceFrom ? "From" : undefined}
              link={{ to: "/domestic-packages/$destination/$package", params: { destination: d.slug, package: p.slug } }}
              p={{
                slug: p.slug,
                name: p.name,
                country: d.region,
                 tagline: p.tour.find((f) => /pax|persons|guests/i.test(f.label))?.value ?? "",
                price: p.priceFrom ?? "Price on request",
                nights: p.duration,
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
