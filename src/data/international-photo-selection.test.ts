import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import packages from './international-packages.json';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { packagePhotoStop, destinationPhotoStop, photoFileForStop } from './international-photo-selection';

describe('international photo locations', () => {
  it('selects only a stop actually included in each trip', () => {
    for (const p of packages) {
      const stop = packagePhotoStop(p.slug);
      assert.ok(stop, p.slug);
      for (let o = 0; o < p.options.length; o++) {
        const place = packagePhotoStop(p.slug, o)!.replace(/ by night$/, '');
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
        const text = norm([...p.cities, ...p.countries, ...p.itinerary.map(d => d.text)].join(' '));
        assert.ok(text.includes(norm(place)), `${p.slug} option ${o + 1}: ${place}`);
      }
    }
  });
  it('never reuses a photo across packages or options', () => {
    const seen = new Map<string, string>();
    for (const p of packages) for (let o = 0; o < p.options.length; o++) {
      const file = photoFileForStop(packagePhotoStop(p.slug, o)!);
      const hash = createHash('md5').update(readFileSync(new URL(`../assets/international/${file}`, import.meta.url))).digest('hex');
      assert.ok(!seen.has(hash), `${p.slug} option ${o + 1} reuses photo of ${seen.get(hash)}`);
      seen.set(hash, `${p.slug} option ${o + 1}`);
    }
    assert.equal(seen.size, 44);
  });
  it('matches city cards to their own city rather than the first trip stop', () => {
    assert.equal(destinationPhotoStop('Lucerne', 'switzerland-7n-8d'), 'Lucerne');
    assert.equal(destinationPhotoStop('Zurich', 'switzerland-7n-8d'), 'Zurich');
    assert.equal(destinationPhotoStop('Switzerland', 'switzerland-7n-8d'), 'Switzerland (country)');
    assert.equal(destinationPhotoStop('Austria', 'prague-vienna-budapest-6n-7d'), 'Austria (country)');
    assert.equal(packagePhotoStop('paris-swiss-italy-11n-12d'), 'Venice');
    assert.equal(packagePhotoStop('paris-swiss-italy-12n-13d'), 'Florence');
  });
  it('gives every country card on the International page its own photo', () => {
    const names = Array.from(new Set(packages.flatMap(p => p.countries)));
    const seen = new Map<string, string>();
    for (const name of names) {
      const p = packages.find(p => p.countries.includes(name))!;
      const file = photoFileForStop(destinationPhotoStop(name, p.slug)!);
      const hash = createHash('md5').update(readFileSync(new URL(`../assets/international/${file}`, import.meta.url))).digest('hex');
      assert.ok(!seen.has(hash), `${name} repeats the photo of ${seen.get(hash)}`);
      seen.set(hash, name);
    }
  });
  it('uses correct geographic names at country and city level', () => {
    const countries = new Set(packages.flatMap(p => p.countries));
    assert.ok(countries.has('Indonesia') && countries.has('United Arab Emirates') && countries.has('United Kingdom'));
    for (const wrong of ['Bali', 'Dubai', 'Abu Dhabi', 'UK', 'Scotland']) assert.ok(!countries.has(wrong), `${wrong} is not a country entry`);
    const vietnam = packages.find(p => p.slug === 'vietnam-holiday-package-1320')!;
    assert.ok(vietnam.cities.includes('Da Nang') && vietnam.cities.includes('Ha Long Bay'));
    assert.ok(!packages.some(p => p.name.includes('Swiss Holiday') || p.name.includes('Swiss &')));
  });
});
