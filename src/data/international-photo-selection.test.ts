import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import packages from './international-packages.json';
import { packagePhotoStop, destinationPhotoStop } from './international-photo-selection';

describe('international photo locations', () => {
  it('selects only a stop actually included in each trip', () => {
    for (const p of packages) {
      const stop = packagePhotoStop(p.slug);
      assert.ok(stop, p.slug);
      assert.ok([...p.cities, ...p.countries].includes(stop), `${p.slug}: ${stop}`);
    }
  });
  it('matches city cards to their own city rather than the first trip stop', () => {
    assert.equal(destinationPhotoStop('Lucerne', 'switzerland-7n-8d'), 'Lucerne');
    assert.equal(destinationPhotoStop('Zurich', 'switzerland-7n-8d'), 'Zurich');
    assert.equal(destinationPhotoStop('Switzerland', 'switzerland-7n-8d'), 'Interlaken');
    assert.equal(packagePhotoStop('paris-swiss-italy-11n-12d'), 'Venice');
    assert.equal(packagePhotoStop('paris-swiss-italy-12n-13d'), 'Florence');
  });
});