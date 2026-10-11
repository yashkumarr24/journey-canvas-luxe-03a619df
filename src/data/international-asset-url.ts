// Asset pointers are public, immutable files served by Lovable, not by external hosts.
const assetOrigin = 'https://id-preview--a1b60d5f-b89e-4fb3-adfb-24bc8562dc84.lovable.app';

export function internationalAssetUrl(url: string): string {
  return url.startsWith('/__l5e/assets-v1/') ? `${assetOrigin}${url}` : url;
}