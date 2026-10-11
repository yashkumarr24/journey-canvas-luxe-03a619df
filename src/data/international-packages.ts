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
export const internationalPackageDestinations = Array.from(new Set(internationalPackages.flatMap(p => [...p.countries, ...p.cities]))).map(name => ({
  name, slug: slugify(name), packages: internationalPackages.filter(p => [...p.countries, ...p.cities].includes(name)),
}));
export const findInternationalPackageDestination = (slug: string) => internationalPackageDestinations.find(d => d.slug === slug);
