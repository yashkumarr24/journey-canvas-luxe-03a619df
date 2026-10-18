import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import trips from '../../data/international-packages.json';
import { domesticSearchIndex, internationalSearchIndex, matchDestinations, filterPackagesByPlace, deduplicateDestinations } from './destination-search';

const countries = [...new Set(trips.flatMap(p => p.countries))].map(name => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), packages: trips.filter(p => p.countries.includes(name)) }));
const international = internationalSearchIndex([], countries, []);
describe('catalogue destination search', () => {
  it('suggests Switzerland for a partial mixed-case name with extra spaces', () => {
    assert.equal(matchDestinations(international, '  sWiT  ')[0]?.name, 'Switzerland');
    assert.equal(matchDestinations(international, 'hA   lOnG   bAy')[0]?.name, 'Ha Long Bay');
  });
  it('indexes every source country and city without limiting the suggestion list', () => {
    for (const p of trips) {
      for (const name of [...p.countries, ...p.cities]) assert.ok(international.some(item => item.name === name), name);
    }
  });
  it('routes Lucerne to Switzerland and retains only complete trips including Lucerne', () => {
    const results = matchDestinations(international, 'Lucerne');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.location, 'Switzerland');
    assert.deepEqual(results[0]?.target, { to: '/international-packages/$destination', params: { destination: 'switzerland' }, search: { place: 'Lucerne' } });
    const swiss = countries.find(c => c.name === 'Switzerland'); assert.ok(swiss);
    const filtered = filterPackagesByPlace(swiss.packages, ' LUCERNE ');
    assert.equal(filtered.length, 9);
    assert.ok(filtered.every(p => p.cities.includes('Lucerne')));
    const interlaken = filterPackagesByPlace(swiss.packages, 'Interlaken');
    assert.equal(interlaken.length, 2);
  });
  it('country navigation carries no city filter', () => {
    assert.deepEqual(matchDestinations(international, 'swit')[0]?.target, { to: '/international-packages/$destination', params: { destination: 'switzerland' } });
  });
  it('returns no suggestions for blank or unmatched input and empty filters preserve all packages', () => {
    assert.deepEqual(matchDestinations(international, '   '), []);
    assert.deepEqual(matchDestinations(international, 'zzzz-no-destination'), []);
    assert.equal(filterPackagesByPlace(trips, '').length, 35);
    assert.deepEqual(filterPackagesByPlace(trips, 'zzzz'), []);
  });
  it('ranks name prefixes before embedded matches', () => {
    const results = matchDestinations(international, 'g');
    assert.equal(results[0]?.name, 'Galway');
    const firstEmbedded = results.findIndex(r => !r.name.toLowerCase().startsWith('g'));
    assert.ok(firstEmbedded > 0);
    assert.ok(results.slice(0, firstEmbedded).every(r => r.name.toLowerCase().startsWith('g')));
  });
  it('deduplicates normalized names and locations', () => {
    const first = international[0]; assert.ok(first);
    assert.equal(deduplicateDestinations([first, { ...first, name: ` ${first.name.toUpperCase()} ` }]).length, 1);
  });
  it('keeps domestic state and hotel-city suggestions separate from international', () => {
    const domestic = domesticSearchIndex([], [
      { slug: 'goa', name: 'Goa', region: 'Goa', packages: [] },
      { slug: 'gangtok-darjeeling', name: 'Gangtok with Darjeeling', region: 'Sikkim & West Bengal', packages: [{ options: [{ columns: ['Nights', 'City', 'Hotel'], hotels: [['2', 'Gangtok', 'Source hotel']] }] }] },
    ]);
    assert.equal(matchDestinations(domestic, 'G')[0]?.name, 'Gangtok');
    assert.ok(matchDestinations(domestic, 'G').some(r => r.name === 'Goa'));
    assert.equal(matchDestinations(domestic, 'WEST   BENGAL')[0]?.target.to, '/domestic-packages/$destination');
    assert.deepEqual(matchDestinations(domestic, 'Switzerland'), []);
    assert.deepEqual(matchDestinations(international, 'Goa'), []);
  });
  it('includes additional live catalogue destinations and older curated destinations', () => {
    const index = internationalSearchIndex([{ slug: 'baku', name: 'Baku, Azerbaijan', country: 'Caucasus', itinerary: [] }], countries, [{ slug: 'new-destination', name: 'New destination', country: 'Country', packages: [{}] }]);
    assert.equal(matchDestinations(index, 'New destination')[0]?.target.to, '/packages/$destination');
    assert.equal(matchDestinations(index, 'Baku')[0]?.target.to, '/destinations/$slug');
  });
});