import { createFileRoute, notFound, Link } from '@tanstack/react-router';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { PageHero } from '@/components/PageHero';
import { InternationalPhotoCredit } from '@/components/InternationalPhotoCredit';
import { packagePhotoStop, destinationPhotoStop } from '@/data/international-photo-selection';
import { SectionTitle } from '@/components/Section';
import { DestinationCard } from '@/components/Destinations';
import { findInternationalPackageDestination, internationalImage, internationalDestinationImage, internationalPrice } from '@/data/international-packages';
export const Route = createFileRoute('/international-packages/$destination/')({
  loader: ({ params }) => { const d = findInternationalPackageDestination(params.destination); if (!d) throw notFound(); return d; },
  head: ({ loaderData }) => {
    const title = `${loaderData?.name ?? 'International'} Holiday Packages | Fly n Feel Holidays`;
    const description = `${loaderData?.name ?? 'International'} source-quoted holidays with hotels, prices and complete day-wise itineraries. Enquire with Fly n Feel.`;
    const p = loaderData?.packages[0]; const image = p && loaderData ? internationalDestinationImage(loaderData.name, p) : '';
    return { meta: [{ title }, { name: 'description', content: description }, { property: 'og:title', content: title }, { property: 'og:description', content: description }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }, ...(image.startsWith('https://') ? [{ property: 'og:image', content: image }, { name: 'twitter:image', content: image }] : [])] };
  },
  notFoundComponent: () => <div className="grid min-h-screen place-items-center"><Link to="/international">See all international holidays →</Link></div>,
  component: Page,
});
function Page() {
  const d = Route.useLoaderData(); const first = d.packages[0];
  return <main className="relative bg-background text-foreground"><Nav />{first && <PageHero image={internationalDestinationImage(d.name, first)} eyebrow="International Holidays" title={d.name} height="80svh" lightText />}<section className="mx-auto max-w-7xl px-6 py-24"><InternationalPhotoCredit place={first ? destinationPhotoStop(d.name, first.slug) : undefined} /><SectionTitle eyebrow={`${d.packages.length} packages`} title={<>{d.name} <span className="italic gold-gradient">packages</span></>} subtitle="Prices shown are as quoted, subject to availability. Enquire for a confirmed quote." /><div className="mt-14 grid gap-7 md:grid-cols-2 lg:grid-cols-3">{d.packages.map((p,i) => <div key={p.slug}><DestinationCard index={i} badge={null} cta="View Package" link={{ to: '/international-packages/$destination/$package', params: { destination: d.slug, package: p.slug } }} p={{ slug: p.slug, name: p.name, country: p.countries.join(' · '), tagline: p.cities.join(' · '), price: internationalPrice(p), nights: p.duration, img: internationalImage(p) }} /><InternationalPhotoCredit place={packagePhotoStop(p.slug)} /></div>)}</div></section><Footer /></main>;
}
