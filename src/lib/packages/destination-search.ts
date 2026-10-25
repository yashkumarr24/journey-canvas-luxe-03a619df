export type SearchTarget =
  | { to: '/destinations/$slug'; params: { slug: string } }
  | { to: '/domestic-packages/$destination'; params: { destination: string } }
  | { to: '/international-packages/$destination'; params: { destination: string }; search?: { place: string } }
  | { to: '/packages/$destination'; params: { destination: string } };

export type DestinationSuggestion = {
  name: string; location: string; kind: string; target: SearchTarget;
  catalogue?: 'Domestic' | 'International';
};
type Classic = { slug: string; name: string; country: string; itinerary: { title: string }[] };
type Domestic = { slug: string; name: string; region: string; packages: { options: { columns: string[]; hotels: string[][] }[] }[] };
type Trip = { slug: string; name: string; countries: string[]; cities: string[] };
type CountryGroup = { slug: string; name: string; packages: Trip[] };
type CatalogueGroup = { slug: string; name: string; country: string; packages: unknown[] };

export const normalizeDestination = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function deduplicateDestinations(items: DestinationSuggestion[]) {
  const unique = new Map<string, DestinationSuggestion>();
  for (const item of items) {
    const key = `${normalizeDestination(item.name)}|${normalizeDestination(item.location)}`;
    if (item.name.trim() && !unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

export function matchDestinations(items: DestinationSuggestion[], text: string) {
  const query = normalizeDestination(text);
  if (!query) return [];
  return items.filter(item => normalizeDestination(`${item.name}, ${item.location}`).includes(query))
    .sort((a, b) => Number(normalizeDestination(b.name).startsWith(query)) - Number(normalizeDestination(a.name).startsWith(query))
      || a.name.localeCompare(b.name) || a.location.localeCompare(b.location));
}

// Geography in the older catalogue is recorded in day headings rather than city arrays.
// Only headings are split; descriptions, prices and incidental prose are never indexed.
function headingPlaces(title: string) {
  return title.split(/\s*[–→&]\s*|\s+to\s+/i).map(part => part
    .replace(/^(?:arrival|arrive|departure|depart)(?:\s+(?:in|at|to|from))?\s*/i, '')
    .replace(/\s+(?:local\s+)?(?:sightseeing|city tour|day trip|heritage day|overnight cruise|overnight|houseboat|at leisure|leisure|day tour).*$/i, '')
    .replace(/\s*\([^)]*\)/g, '').trim())
    .filter(place => place && !/^(?:arrival|departure|depart|arrive|leisure|desert safari)$/i.test(place));
}

function classicSuggestions(destinations: Classic[]): DestinationSuggestion[] {
  return destinations.flatMap(d => {
    const target: SearchTarget = { to: '/destinations/$slug', params: { slug: d.slug } };
    const name = d.name.split(',')[0].trim();
    return [
      { name: d.name, location: d.country, kind: 'Destination', target },
      ...d.name.split(/\s*[,&]\s*/).filter(part => part !== d.name).map(part => ({ name: part, location: d.country, kind: 'Destination', target })),
      { name: d.country, location: d.name, kind: 'Country / region', target },
      ...d.itinerary.flatMap(day => headingPlaces(day.title)).map(place => ({ name: place, location: name, kind: 'City / region', target })),
    ];
  });
}

export function domesticSearchIndex(classic: Classic[], groups: Domestic[]): DestinationSuggestion[] {
  return deduplicateDestinations([
    ...groups.flatMap(d => {
      const target: SearchTarget = { to: '/domestic-packages/$destination', params: { destination: d.slug } };
      const places = d.packages.flatMap(p => p.options.flatMap(option => {
        const column = option.columns.findIndex(c => /^(city|destination)$/i.test(c.trim()));
        return column < 0 ? [] : option.hotels.map(row => row[column]).filter((city): city is string => Boolean(city?.trim()));
      }));
      return [
        { name: d.name, location: 'India', kind: 'Destination', target },
        ...d.region.split(/\s*&\s*/).map(region => ({ name: region, location: d.region === region ? 'India' : `${d.name}, India`, kind: 'State / region', target })),
        { name: d.region, location: 'India', kind: 'State / region', target },
        ...places.map(name => ({ name, location: `${d.region}, India`, kind: 'City / island', target })),
      ];
    }),
    ...classicSuggestions(classic),
  ]);
}

export function internationalSearchIndex(classic: Classic[], groups: CountryGroup[], catalogue: CatalogueGroup[]): DestinationSuggestion[] {
  const allTrips = [...new Map(groups.flatMap(g => g.packages).map(p => [p.slug, p])).values()];
  // Use explicit single-country quotations as geographic evidence. For ambiguous
  // multi-country stops retain the complete source country label, never guess.
  const countriesByCity = new Map<string, Set<string>>();
  for (const p of allTrips.filter(p => p.countries.length === 1)) {
    for (const city of p.cities) {
      const key = normalizeDestination(city);
      const countries = countriesByCity.get(key) ?? new Set<string>();
      countries.add(p.countries[0]); countriesByCity.set(key, countries);
    }
  }
  const countryItems: DestinationSuggestion[] = groups.map(g => ({ name: g.name, location: 'International', kind: 'Country', target: { to: '/international-packages/$destination', params: { destination: g.slug } } }));
  const cityNames = [...new Set(allTrips.flatMap(p => p.cities))];
  const cities: DestinationSuggestion[] = cityNames.flatMap(city => {
    const covering = allTrips.filter(p => p.cities.includes(city)).sort((a, b) => a.countries.length - b.countries.length);
    const p = covering[0];
    if (!p) return [];
    const known = [...(countriesByCity.get(normalizeDestination(city)) ?? [])];
    const countries = known.length ? known : [p.countries[0]];
    return countries.flatMap(country => {
      const group = groups.find(g => g.name === country);
      return group ? [{ name: city, location: known.length ? country : p.countries.join(' · '), kind: 'City / region', target: { to: '/international-packages/$destination' as const, params: { destination: group.slug }, search: { place: city } } }] : [];
    });
  });
  const structuredNames = new Set([...countryItems, ...cities].map(item => normalizeDestination(item.name)));
  return deduplicateDestinations([
    ...countryItems, ...cities, ...classicSuggestions(classic).filter(item => !structuredNames.has(normalizeDestination(item.name))),
    ...catalogue.map(d => ({ name: d.name, location: d.country, kind: 'Destination', target: { to: '/packages/$destination' as const, params: { destination: d.slug } } })),
    ...catalogue.filter(d => !structuredNames.has(normalizeDestination(d.country))).map(d => ({ name: d.country, location: d.name, kind: 'Country / region', target: { to: '/packages/$destination' as const, params: { destination: d.slug } } })),
  ]);
}

// Homepage holiday search: one field over both catalogues. The per-catalogue
// indexes are still built separately, then tagged and merged so suggestions can
// be labelled Domestic/International and keep their existing navigation targets.
export function combinedSearchIndex(domestic: DestinationSuggestion[], international: DestinationSuggestion[]) {
  return deduplicateDestinations([
    ...domestic.map(item => ({ ...item, catalogue: 'Domestic' as const })),
    ...international.map(item => ({ ...item, catalogue: 'International' as const })),
  ]);
}

export function filterPackagesByPlace<T extends { cities: string[] }>(packages: T[], place: string) {
  const query = normalizeDestination(place);
  return query ? packages.filter(p => p.cities.some(city => normalizeDestination(city) === query)) : packages;
}