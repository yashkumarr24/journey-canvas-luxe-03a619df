# Destination search verification — 18 October 2026

## Changes
- `src/lib/packages/destination-search.ts`: catalogue-derived matching, whitespace/case normalization, prefix ranking, deduplication, separate catalogue indexes and whole-package city filtering.
- `src/components/PackageDestinationSearch.tsx`: labelled combobox, clear control, scrollable suggestions, keyboard navigation, touch selection, live result announcement and visual-viewport height handling.
- `src/components/Destinations.tsx`: optional content slot above cards.
- `src/routes/domestic.tsx` and `src/routes/international.tsx`: search above existing cards, using all current static groups, older destinations and the already-loaded international database catalogue.
- `src/routes/international-packages.$destination.index.tsx`: validated optional `place` query; matching full trips and Show all packages control. Existing paths/aliases unchanged.
- `src/lib/packages/destination-search.test.ts` and `src/data/destination-search.test.ts`: search rule and actual-catalogue coverage tests.
- `AGENTS.md`, `roadmap.md`: architecture rule and completion tracking.

## Data boundaries
No package text, prices, images, grouping, auth, native recovery, backend, provider integration, certification, booking, payment or database records changed. No additional server calls or provider search introduced.

All 35 static international trips / 26 country groups and every explicit city are indexed, along with older curated destinations. Domestic groups, regional labels and declared City/Destination hotel-table cells are indexed, plus older catalogue day headings. International geography not explicitly mapped to a country by a single-country source retains the source's complete multi-country label rather than inventing a city-country relationship. Live catalogue uses the destination names/country fields already returned by its existing loader; unavailable backend data cannot be tested as loaded data here. There is no new backend lookup of hotel-city fields.

## Checks
- 19 node/tsx tests and 3 Bun tests passed, covering every static country/city, domestic group/region/hotel city, prefix ranking, case/extra spaces, empty/no-match input, duplicate handling, catalogue separation and navigation targets.
- Browser flows passed at 1280×1800, 390×844, 360×640 and 430×700: swit, mixed-case Lucerne, Interlaken, G→Goa, Sikkim, West Bengal, Nainital, unmatched input, clear, ArrowDown/Enter/Escape and destination navigation.
- Lucerne opens Switzerland with 9 complete matching packages; Interlaken shows 2. Show all packages clears the filter.
- Touch selections verified for Switzerland, Goa and Lucerne; reduced 390×420 viewport used to simulate available space above a mobile keyboard. Dropdown bounds remain inside the viewport.
- Legacy bali, lucerne and uk paths remain functional.
- 200% root text size inspected; suggestion text wraps and dropdown scrolls. No horizontal page overflow.
- Combobox/listbox roles, active descendant, selected option, label and live announcements verified in browser DOM; no physical screen-reader or real mobile keyboard test claimed.
- Browser touch/legacy run recorded zero page errors. Latest automatic build check passed.

## Deployment
Deploy the frontend changes through the existing Vercel workflow for the live site. No database migration, VPS/backend rollout, payment switch or Android rebuild required. Nothing was published by this task.