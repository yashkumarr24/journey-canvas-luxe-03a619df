import packages from './international-packages.json';

// Spread distinct trips across their included stops, never across unrelated places.
const selectedStops: Record<string, string> = {
  'switzerland-6n-7d': 'Lucerne',
  'switzerland-7n-8d': 'Interlaken',
  'switzerland-9n-10d': 'Montreux',
  'france-6n-7d': 'Nice',
  'paris-switzerland-6n-7d': 'Paris',
  'paris-switzerland-7n-8d': 'Zurich',
  'amsterdam-paris-swiss-9n-10d': 'Amsterdam',
  'amsterdam-paris-6n-7d': 'Paris by night',
  'paris-swiss-italy-11n-12d': 'Venice',
  'paris-swiss-italy-12n-13d': 'Florence',
  'italy-7n-8d': 'Rome',
  'italy-9n-10d': 'Naples',
  'brussels-amsterdam-germany-7n-8d': 'Brussels',
  'prague-vienna-budapest-6n-7d': 'Prague',
  'prague-austria-budapest-9n-10d': 'Budapest',
  'austria-swiss-9n-10d': 'Salzburg',
  'iceland-6n-7d': 'Reykjavik',
  'turkey-8n-9d': 'Cappadocia',
  'turkey-9n-10d': 'Antalya',
  'greece-7n-8d': 'Santorini',
  'spain-6n-7d': 'Barcelona',
  'spain-8n-9d': 'Ibiza',
  'uk-7n-8d': 'London',
  'uk-scotland-13n-14d': 'Edinburgh',
  'portugal-5n-6d': 'Porto',
  'portugal-spain-9n-10d': 'Lisbon',
  'ireland-6n-7d': 'Dublin',
  'scandinavia-9n-10d': 'Copenhagen',
  'finland-9n-10d': 'Rovaniemi',
  'croatia-7n-8d': 'Dubrovnik',
  'bali-holiday-package-1295': 'Ubud',
  'dubai-abu-dhabi-holiday-package-1416': 'Abu Dhabi',
  'georgia-holiday-package-1423': 'Tbilisi',
  'singapore-holiday-package-1329': 'Singapore',
  'vietnam-holiday-package-1320': 'Ha Long Bay',
};

// Multi-option trips get one distinct included stop per selectable option (option 1 is the trip thumbnail).
const optionStops: Record<string, string[]> = {
  'bali-holiday-package-1295': ['Ubud', 'Kuta', 'Uluwatu', 'Tegenungan Waterfall'],
  'dubai-abu-dhabi-holiday-package-1416': ['Abu Dhabi', 'Dubai'],
  'georgia-holiday-package-1423': ['Tbilisi', 'Batumi', 'Gudauri', 'Kazbegi'],
  'singapore-holiday-package-1329': ['Singapore', 'Gardens by the Bay', 'Singapore Flyer'],
};
// Country cards get their own country photo so they never repeat a city card shown beside them.
const countryPhotos: Record<string, string> = {
  Switzerland: 'country-switzerland.jpg', France: 'france-stock.jpg', Netherlands: 'country-netherlands.jpg',
  Italy: 'italy-stock.jpg', Belgium: 'belgium-landmark.jpg', Germany: 'germany-stock.jpg',
  'Czech Republic': 'czech-republic-stock.jpg', Austria: 'austria-stock.jpg', Hungary: 'country-hungary.jpg',
  Iceland: 'iceland-stock.jpg', Turkey: 'turkey-stock.jpg', Greece: 'greece-stock.jpg', Spain: 'spain-landmark.jpg',
  UK: 'uk-stock.jpg', Scotland: 'country-scotland.jpg', Portugal: 'portugal-stock.jpg', Ireland: 'ireland-stock.jpg',
  Norway: 'norway-stock.jpg', Sweden: 'country-sweden.jpg', Denmark: 'country-denmark.jpg', Finland: 'finland-stock.jpg',
  Croatia: 'croatia-stock.jpg', Bali: 'country-bali.jpg', Georgia: 'country-georgia.jpg', Vietnam: 'country-vietnam.jpg',
};
const countryKey = (name: string) => `${name} (country)`;
const photoFiles: Record<string, string> = {
  'Paris by night': 'france-stock.jpg',
  ...Object.fromEntries(Object.entries(countryPhotos).map(([c, f]) => [countryKey(c), f])),
};
export const packagePhotoStop = (slug: string, option = 0) => optionStops[slug]?.[option] ?? optionStops[slug]?.[0] ?? selectedStops[slug];
export const photoFileForStop = (stop: string) => photoFiles[stop] ?? `city-${stop.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`;
const countryStops: Record<string, string> = {
  Switzerland: 'Lucerne', France: 'Paris', Netherlands: 'Amsterdam', Italy: 'Rome',
  Belgium: 'Brussels', Germany: 'Frankfurt', 'Czech Republic': 'Prague', Austria: 'Vienna',
  Hungary: 'Budapest', Iceland: 'Reykjavik', Turkey: 'Istanbul', Greece: 'Athens',
  Spain: 'Barcelona', 'United Kingdom': 'London', UK: 'London', Scotland: 'Edinburgh',
  Portugal: 'Lisbon', Ireland: 'Dublin', Norway: 'Oslo', Sweden: 'Stockholm',
  Denmark: 'Copenhagen', Finland: 'Helsinki', Croatia: 'Dubrovnik', Bali: 'Ubud',
  Indonesia: 'Ubud', 'United Arab Emirates': 'Dubai', UAE: 'Dubai', Georgia: 'Tbilisi',
  Singapore: 'Singapore', Vietnam: 'Halong Bay',
};
export const destinationPhotoStop = (name: string, slug: string) => {
  const p = packages.find(p => p.slug === slug);
  if (!p) return undefined;
  if (p.cities.some(city => city === name)) return name;
  if (countryPhotos[name]) return countryKey(name);
  return countryStops[name] ?? packagePhotoStop(slug);
};