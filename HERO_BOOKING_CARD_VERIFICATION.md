# Compact hero booking card — verification

Date: 2026-10-25. Scope: homepage hero booking interface only (layout, compact sizing, shared holiday search). Branding, colours, typography, icons, hero content and navbar unchanged. No backend, TripJack, TC certification, booking-service or payment changes.

## Changed files

- `src/components/HomeSearch.tsx` — compact booking card: 6 small service tabs (Flights, Hotels, Holidays + Car Rental, Visa, Cruise enquiry, all preserved); flight fields in one horizontal row on desktop with Travellers (adults/children/infants counters) in a popover and cabin class in a dropdown; multi-city mode unchanged; holidays panel gains one shared search field over both catalogues plus the existing Domestic/International browse links; hotel results panel unchanged.
- `src/components/booking/HotelSearchForm.tsx` — new `compact` prop: single-row layout (destination, check-in, check-out, Rooms & guests popover with per-room counters, child ages, add/remove room, nationality/currency, Search). Default layout used by /hotels is byte-for-byte the same; validation (hotelSearchSchema) untouched.
- `src/components/PackageDestinationSearch.tsx` — optional `className`, `label`, `placeholder` props; renders a Domestic/International badge when a suggestion is tagged.
- `src/lib/packages/destination-search.ts` — optional `catalogue` tag on suggestions; `combinedSearchIndex()` tags the separately built domestic and international indexes and merges them (deduplicated).
- `src/components/Hero.tsx` — accepts the international catalogue and passes it to HomeSearch; slightly tighter spacing above the card.
- `src/routes/index.tsx` — loader fetches the international catalogue (falls back to empty on error) for the shared holiday search.
- `src/lib/packages/destination-search.test.ts` — new test: combined index tags every suggestion Domestic/International, "swit" → Switzerland (International), "Goa" → Domestic with domestic route, "Lucerne" → Switzerland page with place filter.
- `roadmap.md` — task tracked.

## Checks

- 10 node/tsx destination-search tests pass; 2 bun catalogue tests pass; build log clean.
- Browser (Chromium, localhost): travellers popover +1 adult/+1 child → "3 travellers" and submitted search carries adults=2&children=1&cabinClass=business; empty flight submit shows validation alert; valid search navigates to /flights with all params.
- Holidays: "swit" → Switzerland first (International badge), ArrowDown+Enter opens /international-packages/switzerland; "g" → Goa present with Domestic badge; "Lucerne" → /international-packages/switzerland?place=Lucerne (filtered packages); "zzzz" → "No matching destinations" + clear control empties the field.
- Hotels: rooms popover add-room → "2 rooms · 4 adults"; empty submit shows validation alert.
- 360/390/430/768/1280/1440 px: no horizontal overflow, suggestion listbox stays inside the viewport at every width, mobile stacks fields with full-width Search, zero page errors.

## Deployment

Vercel deploy required for the live site. No Android rebuild (WebView loads the live site; popovers use the same viewport-safe patterns), no backend/DB changes.
