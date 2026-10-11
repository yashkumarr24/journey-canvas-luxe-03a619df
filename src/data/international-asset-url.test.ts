import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { internationalAssetUrl } from './international-asset-url';

describe('international image delivery', () => {
  it('resolves stored photos independently of the website host', () => {
    const path = '/__l5e/assets-v1/70434364-8abc-4e25-af4f-6ea2f4e124f7/city-lucerne.jpg';
    const url = internationalAssetUrl(path);
    assert.equal(new URL(url, 'https://example.com').origin, 'https://id-preview--a1b60d5f-b89e-4fb3-adfb-24bc8562dc84.lovable.app');
    assert.equal(new URL(url).pathname, path);
  });
  it('preserves already absolute photos and bundled images', () => {
    assert.equal(internationalAssetUrl('https://example.com/photo.jpg'), 'https://example.com/photo.jpg');
    assert.equal(internationalAssetUrl('/assets/swiss.webp'), '/assets/swiss.webp');
  });
});