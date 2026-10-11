import source from './international-packages.json';
import swiss from '@/assets/swiss.webp';
import { packagePhotoStop, destinationPhotoStop } from './international-photo-selection';
import photoCredits from './international-photo-credits.json';

export type SourceTable = { columns: string[]; rows: string[][] };
export type InternationalOption = { name: string; tables: SourceTable[]; price: string[]; details?: string[] };
export type InternationalPackage = {
  slug: string; name: string; duration: string; source: string; countries: string[]; cities: string[];
  imageKey: string; tour: { label: string; value: string }[]; options: InternationalOption[];
  itinerary: { day: string; text: string; date?: string; meals?: string; remark?: string }[];
  inclusions: string[]; exclusions: string[]; notes: { title: string; items: string[] }[]; flights: SourceTable[];
};
const assets = import.meta.glob<{ default: { url: string } }>('../assets/international/*.asset.json', { eager: true });
export const internationalPackages: InternationalPackage[] = source;
export const internationalImage = (p: InternationalPackage) => {
  const stop = packagePhotoStop(p.slug);
  const photo = stop ? assets[`../assets/international/city-${stop.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg.asset.json`]?.default.url : undefined;
  if (p.slug === 'amsterdam-paris-6n-7d') return assets['../assets/international/france-stock.jpg.asset.json']?.default.url ?? photo ?? swiss;
  if (photo) return photo;
  const name = ['netherlands', 'spain', 'belgium'].includes(p.imageKey) ? `${p.imageKey}-landmark.jpg` : ['bali', 'dubai', 'georgia', 'singapore', 'vietnam'].includes(p.imageKey) ? `${p.imageKey}-source.jpg` : `${p.imageKey}-stock.jpg`;
  return assets[`../assets/international/${name}.asset.json`]?.default.url ?? swiss;
};
export const internationalDestinationImage = (name: string, p: InternationalPackage) => {
  const stop = destinationPhotoStop(name, p.slug);
  return assets[`../assets/international/city-${stop?.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg.asset.json`]?.default.url ?? internationalImage(p);
};
export const internationalPhotoCredit = (place: string | undefined) => {
  if (!place) return undefined;
  const credits: Record<string, { source: string; license: string; author?: string; licenseUrl?: string }> = photoCredits;
  const credit = credits[place];
  return credit && !credit.license.includes('unsplash.com') ? credit : undefined;
};
export const internationalPrice = (p: InternationalPackage, option = 0) => p.options[option]?.price[0] ?? 'On request';
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const internationalPackageDestinations = Array.from(new Set(internationalPackages.flatMap(p => [...p.countries, ...p.cities]))).map(name => ({
  name, slug: slugify(name), packages: internationalPackages.filter(p => [...p.countries, ...p.cities].includes(name)),
}));
export const findInternationalPackageDestination = (slug: string) => internationalPackageDestinations.find(d => d.slug === slug);
