# Roadmap

## Catalogue lookup timeout
- [x] Add 0026 with indexed, branch-specific exact selection and unchanged legacy/keyset behavior.
- [x] Run isolated SQL equivalence, pagination, permissions and large-catalogue checks; document deployment without applying to production in HOTEL_CATALOGUE_LOOKUP_OPTIMIZATION.md.

## Hotel catalogue search
- [x] Add synchronized hotel/city suggestions with selection validation and stale-ID clearing.
- [x] Audit synchronization and fix confirmed Listing batching/context issues.
- [x] Preserve Explore more stays details/results and distinguish failure states.
- [x] Run focused tests and browser checks; report VPS and synchronization requirements in HOTEL_CATALOGUE_SEARCH_VERIFICATION.md.
- [ ] Live catalogue/availability/handoff and Android verification: blocked until migration 0025 and VPS/frontend deployment; preview has no hotel API and its database has no catalogue tables.

## Mobile results reference
- [x] Collapse submitted searches into editable summaries below desktop; preserve mounted form values.
- [x] Image-left hotel cards and compact filter/sort rows; checked 360/390/430/768/1280/1440 with no overflow/page errors. Hotel checks used existing preview samples; live flight cards unavailable because flight service is not configured. Native Android device not tested.

## Results-page search layout
- [x] Replace expanded flight/hotel search boxes with compact rows, combined dates and traveller/room popovers; preserve existing handoff.
- [x] Browser-verified populated details, multi-room and traveller controls at 360/390/430/768/1280/1440; no overflow or page errors. Live provider result handoff not re-tested; provider logic unchanged.

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
