import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import source from './international-packages.json';
import { packagePhotoStop, destinationPhotoStop, photoFileForStop } from './international-photo-selection';

test('all six domestic destinations retain their licensed photo as a bundled image', () => {
  const data = readFileSync(new URL('./domestic-packages.ts', import.meta.url), 'utf8');
  for (const name of ['andaman', 'gangtok', 'goa', 'kashmir', 'kerala', 'uttarakhand']) {
    const bytes = readFileSync(new URL(`../assets/domestic/${name}-stock.webp`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    assert.ok(data.includes(`@/assets/domestic/${name}-stock.webp`));
    assert.equal(data.includes(`${name}-stock.jpg.asset.json`), false);
  }
});

test('every international package option and destination has its intended included-stop image', () => {
  for (const p of source) {
    for (let i = 0; i < p.options.length; i++) {
      const stop = packagePhotoStop(p.slug, i);
      assert.ok(stop, `${p.slug} option ${i}`);
      assert.ok(existsSync(new URL(`../assets/international/${photoFileForStop(stop)}`, import.meta.url)));
    }
    for (const name of [...p.cities, ...p.countries]) {
      const stop = destinationPhotoStop(name, p.slug);
      assert.ok(stop, name);
      assert.ok(existsSync(new URL(`../assets/international/${photoFileForStop(stop)}`, import.meta.url)), name);
    }
  }
});