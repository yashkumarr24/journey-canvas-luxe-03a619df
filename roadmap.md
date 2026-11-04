# Roadmap

## Flight Book preflight naming-conflict correction
- [x] Rename record a to attr_row and remove unused n; correct two reproduced CHECK deparser comparisons; capture DDL and Book behavior unchanged.
- [x] Disposable PostgreSQL 17.11: 326 passed (1 positive, 325 fail-before-DDL); offline preflight 288 passed and full focused offline suite 488 passed. Strict 15-path patch check has zero fuzz/offsets/skips/failures.
- [x] Deliver v5 patch, migration, results and SHA-256; no VPS access or Book enablement, disposable server stopped.

## Flight Book relation-check correction
- [x] Correct only the 0031 relation null check in versioned v4 candidate; 15-path fresh archive dry-run has zero offsets/fuzz/skips/failures.
- [x] Execute all 306 DB regressions on disposable PostgreSQL 17.11: 156 passed, 150 failed; 288 offline tests passed. Missing booking_items rejects before DDL; good schema also stops before DDL on existing record/alias a.attrelid ambiguity.
- [x] Prepare corrected patch, SQL, report and new SHA-256; VPS untouched and Book disabled.
- [x] Additional pre-existing preflight ambiguity and good-schema acceptance resolved and verified in v5 above.

## Flight Book migration preflight candidate
- [x] Revise combined patch 0031 to check all capture/DDL prerequisites before DDL; other code and DDL/function body byte-identical to v2.
- [x] Pass 488 offline Flight/contract tests; 306 database scenarios skipped under no-SQL instruction. Fresh-archive 15-path patch dry-run has zero offsets/fuzz/failures.
- [x] Prepare versioned patch, migration, prerequisite report and checksums; Book remains disabled. Live catalog reconciliation, actual SQL regressions, UAT allowlist and keys remain blockers outside offline delivery.

## Flight Review-to-Book v2 candidate
- [x] Rebase requirements on the supplied VPS archive; preserve openai and fix only the private Flight RPC client compatibility.
- [x] Pass 141 focused tests including six RPC regressions; all 11 patch paths dry-run with zero offsets/fuzz and byte-identical round-trip. Unmodified auxiliary payment test has one VPS-settings mismatch, reported without changing it.
- [x] Deliver full replacement v2 patch, checksum and checks in Files; Book remains disabled. Actual DB/schema, raw conditions/expiry, UAT allowlisting and key/runtime readiness remain deployment blockers, outside this candidate task.

## Flight Review condition audit
- [x] Verify official PDF p4/p6/p22 visually: separate PAN, passport, document-ID and per-pax DOB flags; remove geography inference, retain unknown conditions without alias behavior.
- [x] Pass 198 focused condition/session and Flight compatibility regressions; preview checks build OK. No deployment/provider calls; actual live VPS files were not supplied or inspected. Existing booking enforcement and frontend remain unchanged.

## Flight V2 Review contract
- [x] Align selected server-side price IDs, returned booking handle and documented conditions with official Review docs.
- [x] Require review of FAREALERT updates; 83 focused adapter/session and compatibility tests plus 3 browser cases pass, preview build OK. Other flows preserved.
- [ ] Full official Review-response conformance: blocked pending an official JSON sample defining fare-total and FAREALERT structure; existing money/itinerary parsing preserved, not claimed newly documented.

## Flight Review fare-rule response
- [x] Reproduce the nested production response and normalize it before Review rendering; preserve request and other flows.
- [x] Pass 10 unit tests and 4 real Review-page browser tests (captured response, single-topic, all-empty, error), each verifying one selected-flight POST; preview checks report build OK.
- [ ] Deploy to the existing Vercel site: blocked by missing authorized Vercel connection/project access.

## Large-city hotel search budget
- [x] Bound Listing scheduling and full-request time; retain successful batch context and explicit incomplete status.
- [x] Test 6,684-ID searches, failures, throttling and cancellation: 129 Python + 5 frontend tests passed; deployment/limits documented in HOTEL_LARGE_CITY_SEARCH_VERIFICATION.md. Live verification awaits VPS/Vercel deployment and UAT account-rate confirmation.

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
