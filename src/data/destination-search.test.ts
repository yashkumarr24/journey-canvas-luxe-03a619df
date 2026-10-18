import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domesticDestinations, internationalDestinations } from './destinations';
import { domesticPackageDestinations } from './domestic-packages';
import trips from './international-packages.json';
import { domesticSearchIndex, internationalSearchIndex, matchDestinations } from '../lib/packages/destination-search';

test('complete current domestic catalogue supplies every group, region and hotel city', () => {
  const items = domesticSearchIndex(domesticDestinations, domesticPackageDestinations);
  for (const group of domesticPackageDestinations) {
    assert.ok(items.some(item => item.name === group.name));
    assert.ok(items.some(item => item.name === group.region));
    for (const p of group.packages) for (const o of p.options) {
      const column = o.columns.findIndex(c => /^(city|destination)$/i.test(c));
      if (column >= 0) for (const row of o.hotels) assert.ok(items.some(item => item.name === row[column]), row[column]);
    }
  }
  for (const d of domesticDestinations) assert.ok(items.some(item => item.name === d.name));
  assert.ok(matchDestinations(items, 'g').some(item => item.name === 'Goa'));
  assert.equal(matchDestinations(items, 'NaInItAl')[0]?.target.to, '/domestic-packages/$destination');
  assert.equal(matchDestinations(items, '  WEST   BENGAL ')[0]?.name, 'West Bengal');
  assert.deepEqual(matchDestinations(items, 'Lucerne'), []);
});

test('complete international catalogue retains old destinations alongside every country and city', () => {
  const internationalPackageDestinations = [...new Set(trips.flatMap(p => p.countries))].map(name => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), packages: trips.filter(p => p.countries.includes(name)) }));
  const items = internationalSearchIndex(internationalDestinations, internationalPackageDestinations, []);
  for (const d of internationalDestinations) assert.ok(items.some(item => item.name === d.name), d.name);
  assert.equal(matchDestinations(items, 'Lucerne').length, 1);
  assert.equal(matchDestinations(items, 'Lucerne')[0]?.location, 'Switzerland');
  assert.ok(matchDestinations(items, 'Thailand').length > 0);
  assert.ok(matchDestinations(items, 'Malaysia').length > 0);
  assert.deepEqual(matchDestinations(items, 'Uttarakhand'), []);
});