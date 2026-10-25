# Roadmap

## Done: Compact hero booking card
- [x] Compact service tabs and single-row flight/hotel fields with travellers/rooms popovers.
- [x] Shared holiday search over both catalogues with Domestic/International labels.
- [x] Test search rules; browser-verify 360/390/430/768/1280/1440, popovers, long names, multi-room; document checks and deployment.

## Destination autocomplete
- [x] Index complete domestic and international destination/package catalogues separately.
- [x] Add accessible autocomplete above listing cards and international city package filtering.
- [x] Test search rules and navigation on desktop/mobile; document files, checks and deployment in DESTINATION_SEARCH_VERIFICATION.md.

## Done: Imagery & organisation for recently added (Oct 11) Domestic/International catalogues

- [x] Identified recent additions from git history: domestic-packages.ts + international-packages.json (2026-10-11); domestic images already corrected 2026-10-17 — left unchanged.
- [x] International grouping: one destination card per country (26 countries); packages listed inside; legacy city/country slugs (bali, dubai, uk, lucerne, …) alias to their country so old links keep working.
- [x] Accurate names: Bali→Indonesia, Dubai/Abu Dhabi→United Arab Emirates, UK→United Kingdom (Scotland folded in), "Swiss"→Switzerland in package names, Danang→Da Nang, Halong Bay→Ha Long Bay. Source itinerary text untouched.
- [x] Imagery: existing licensed bundled photos verified accurate per stop/country; no replacements needed; credits register + STOCK-LICENSES.md updated to corrected names; UAE country card uses dubai-source.jpg; bundled assets kept (Lovable-relative CDN URLs fail cross-host on Vercel).
- [x] Tests updated + new geographic-names test; 13 node/tsx tests + 1 bun domestic test pass.
- [x] Browser-verified /international, Switzerland/Indonesia/UAE/UK/Vietnam country pages, legacy /bali and /lucerne links, domestic page at 390 and 1280: no broken images, correct grouping and names.
- [x] AGENTS.md rule updated (country grouping + aliases).

Deployment: Vercel deploy required for the live site; no Android rebuild, no backend/DB changes.
