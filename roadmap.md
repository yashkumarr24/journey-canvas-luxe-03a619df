# Roadmap

## Current: Imagery & organisation for recently added (Oct 11) Domestic/International catalogues

Scope: static catalogues only (`src/data/domestic-packages.ts`, `src/data/international-packages.json` + assets/routes). No backend/, TripJack, booking, payments, contacts, policies.

- [x] Identify recent additions from git history: domestic-packages.ts + international-packages.json (added 2026-10-11); domestic images already corrected 2026-10-17.
- [ ] International country grouping: one destination card per country (currently one per country AND per city); packages accessible inside; keep package links working.
- [ ] Accurate names: Bali→Indonesia (country), Dubai/Abu Dhabi→UAE, UK→United Kingdom, "Swiss"→Switzerland in names, Danang→Da Nang, Halong Bay→Ha Long Bay; consistent country/city levels.
- [ ] Imagery: verify licences/accuracy for affected cards; replace only inaccurate/repetitive ones with verified free photos; keep credits register updated; bundled assets remain the durable store (Lovable-relative CDN URLs fail cross-host on Vercel — do not switch).
- [ ] Domestic: verify grouping/names/images already correct post Oct 17 fix; change only if inaccurate.
- [ ] Update tests (international-packages.test.ts, international-photo-selection.test.ts); run test suite.
- [ ] Browser-verify cards, country listings, package details at 360/768/1280; check image loading, cropping, grouping, names, links.
- [ ] Report affected records, sources, changed files, verification, deployment needs.
