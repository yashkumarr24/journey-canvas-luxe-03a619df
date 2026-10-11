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
  'amsterdam-paris-6n-7d': 'Paris',
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
  'vietnam-holiday-package-1320': 'Halong Bay',
};

export const packagePhotoStop = (slug: string) => selectedStops[slug];
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
  return p.cities.some(city => city === name) ? name : countryStops[name] ?? packagePhotoStop(slug);
};