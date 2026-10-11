import { internationalPhotoCredit } from '@/data/international-packages';

export function InternationalPhotoCredit({ place }: { place: string | undefined }) {
  const credit = internationalPhotoCredit(place);
  if (!credit) return null;
  return <p className="mt-3 text-xs text-muted-foreground">
    Photo: <a href={credit.source} target="_blank" rel="noreferrer" className="underline">{credit.author ?? place}</a>
    {' · '}<a href={credit.licenseUrl ?? credit.source} target="_blank" rel="noreferrer" className="underline">{credit.license}</a>
    {credit.author && ' · Cropped to fit'}
  </p>;
}