import { createFileRoute, notFound, Link } from '@tanstack/react-router';
import { findInternationalPackageDestination, internationalImage } from '@/data/international-packages';
import { InternationalPackageDetails } from '@/components/InternationalPackageDetails';
export const Route = createFileRoute('/international-packages/$destination/$package')({
  loader: ({ params }) => {
    const d = findInternationalPackageDestination(params.destination);
    const p = d?.packages.find(p => p.slug === params.package);
    if (!d || !p) throw notFound();
    return { d: { slug: d.slug, name: d.name }, p };
  },
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.p.name} — ${loaderData.p.duration} | Fly n Feel Holidays` : 'International package unavailable | Fly n Feel Holidays';
    const description = loaderData ? `${loaderData.d.name}: ${loaderData.p.name}, ${loaderData.p.duration}. Source-quoted hotels, prices, dates and itinerary; enquire with Fly n Feel.` : 'Explore international holidays with Fly n Feel.';
    const image = loaderData ? internationalImage(loaderData.p) : '';
    return { meta: [{ title }, { name: 'description', content: description }, { property: 'og:title', content: title }, { property: 'og:description', content: description }, { property: 'og:type', content: 'article' }, { name: 'twitter:card', content: 'summary_large_image' }, ...(image.startsWith('https://') ? [{ property: 'og:image', content: image }, { name: 'twitter:image', content: image }] : [])] };
  },
  notFoundComponent: () => <div className="grid min-h-screen place-items-center"><Link to="/international">See all international holidays →</Link></div>,
  component: Page,
});
function Page() { const { d, p } = Route.useLoaderData(); return <InternationalPackageDetails key={p.slug} p={p} destination={d.slug} />; }
