# Fix authoritative hotel-to-region linkage

## Implementation
- Tighten the countries parser so `hotelCountries` accepts country-name strings only.
- Keep the existing country-level hotel mapping pass, then add an authoritative region mapping pass that requests one `cityRegionId` at a time and stores that exact region and country on each returned `tjHotelId`.
- Reuse the existing `hotel_mappings.region_id` and `country_name` columns; no database migration is expected.
- Change NEW, UPDATE, and DELETE mapping synchronization to send TripJack's `cursor` and continue only from verified `nextCursor` / `hasMore`; remove page-number pagination from those endpoints.
- Preserve resumable state, soft deletion, 100-ID content batches, backend-only access, and all live Listing/Pricing/Review behavior.

## Verification
- Run focused parser/sync tests or lightweight backend checks without making TripJack calls.
- Confirm no frontend, pricing, availability, review, booking, payment, auth, or database schema files changed.
- Do not run any catalogue synchronization.
