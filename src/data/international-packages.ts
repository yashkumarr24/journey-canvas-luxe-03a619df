import source from './international-packages.json';
import swiss from '@/assets/swiss.webp';
import { packagePhotoStop, destinationPhotoStop, photoFileForStop } from './international-photo-selection';
import photoCredits from './international-photo-credits.json';

export type SourceTable = { columns: string[]; rows: string[][] };
export type InternationalOption = { name: string; tables: SourceTable[]; price: string[]; details?: string[] };
export type InternationalPackage = {
  slug: string; name: string; duration: string; source: string; countries: string[]; cities: string[];
  imageKey: string; tour: { label: string; value: string }[]; options: InternationalOption[];
  itinerary: { day: string; text: string; date?: string; meals?: string; remark?: string }[];
  inclusions: string[]; exclusions: string[]; notes: { title: string; items: string[] }[]; flights: SourceTable[];
};
const photos = import.meta.glob<string>('../assets/international/*.jpg', { eager: true, query: '?url', import: 'default' });
const assetUrl = (path: string) => photos[`../assets/international/${path}`];
export const internationalPackages: InternationalPackage[] = source;
export const internationalImage = (p: InternationalPackage, option = 0) => {
  const stop = packagePhotoStop(p.slug, option);
  const photo = stop ? assetUrl(photoFileForStop(stop)) : undefined;
  if (photo) return photo;
  const name = ['netherlands', 'spain', 'belgium'].includes(p.imageKey) ? `${p.imageKey}-landmark.jpg` : ['bali', 'dubai', 'georgia', 'singapore', 'vietnam'].includes(p.imageKey) ? `${p.imageKey}-source.jpg` : `${p.imageKey}-stock.jpg`;
  return assetUrl(name) ?? swiss;
};
export const internationalDestinationImage = (name: string, p: InternationalPackage) => {
  const stop = destinationPhotoStop(name, p.slug);
  return (stop ? assetUrl(photoFileForStop(stop)) : undefined) ?? internationalImage(p);
};
export const internationalPhotoCredit = (place: string | undefined) => {
  if (!place) return undefined;
  const credits: Record<string, { source: string; license: string; author?: string; licenseUrl?: string }> = photoCredits;
  const credit = credits[place];
  return credit && !credit.license.includes('unsplash.com') ? credit : undefined;
};
export const internationalPrice = (p: InternationalPackage, option = 0) => p.options[option]?.price[0] ?? 'On request';
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// One destination entry per country; every package visiting that country is listed inside it.
export const internationalPackageDestinations = Array.from(new Set(internationalPackages.flatMap(p => p.countries))).map(name => ({
  name, slug: slugify(name), packages: internationalPackages.filter(p => p.countries.includes(name)),
}));
// Legacy city/country slugs keep working: they resolve to the country entry that now holds them.
const legacyDestinationSlugs: Record<string, string> = {
  uk: 'united-kingdom', scotland: 'united-kingdom',
  bali: 'indonesia', dubai: 'united-arab-emirates', 'abu-dhabi': 'united-arab-emirates',
};
export const findInternationalPackageDestination = (slug: string) => {
  const direct = internationalPackageDestinations.find(d => d.slug === slug);
  if (direct) return direct;
  const alias = legacyDestinationSlugs[slug];
  if (alias) return internationalPackageDestinations.find(d => d.slug === alias);
  const p = internationalPackages.find(p => p.cities.some(c => slugify(c) === slug));
  return p ? internationalPackageDestinations.find(d => d.slug === slugify(p.countries[0])) : undefined;
};
