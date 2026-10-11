import source from './international-packages.json';
import swiss from '@/assets/swiss.webp';

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
  const name = ['netherlands', 'spain', 'belgium'].includes(p.imageKey) ? `${p.imageKey}-landmark.jpg` : ['bali', 'dubai', 'georgia', 'singapore', 'vietnam'].includes(p.imageKey) ? `${p.imageKey}-source.jpg` : `${p.imageKey}-stock.jpg`;
  return assets[`../assets/international/${name}.asset.json`]?.default.url ?? swiss;
};
export const internationalPrice = (p: InternationalPackage, option = 0) => p.options[option]?.price[0] ?? 'On request';
const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const internationalPackageDestinations = Array.from(new Set(internationalPackages.flatMap(p => [...p.countries, ...p.cities]))).map(name => ({
  name, slug: slugify(name), packages: internationalPackages.filter(p => [...p.countries, ...p.cities].includes(name)),
}));
export const findInternationalPackageDestination = (slug: string) => internationalPackageDestinations.find(d => d.slug === slug);
