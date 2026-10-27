# Large-city hotel search: bounded work and honest partial results

## Diagnosis

Reported VPS trace: 6,684 mapped IDs, 67 planned batches, batch 37 failed, 705 partial results after 60,032 ms. The browser's generic 45-second deadline discarded that response before it arrived. The checked-in adapter had a 35-second Listing deadline, but lookup, rich static-content reads for all 6,684 hotels, enrichment and session persistence were outside it. The exact live timing cannot be attributed without inspecting the deployed VPS version and phase timings.

## Changes

- Listing-only worker pool: default 3 simultaneous requests, paced at 2 starts/second **across searches in one process**, never 67 tasks/requests fired at once. Every request has at most 100 unique IDs.
- These are application ceilings, **not documented TripJack account entitlements**. The supplied Hotel_V3.pdf specifies 100 IDs, `timeoutMs`, correlation reuse and 429/Retry-After; it does not specify a concurrency/QPS allowance. Configure downward to match the account, validate on UAT before increasing. No alternate provider pagination was invented.
- Each batch now receives its own random correlation ID (the shared wire helper otherwise uses the parent request ID). Response correlation wins when present; each hotel's originating batch remains server-side for the existing detail/review handoff. No booking/payment behavior changed.
- Documented Listing `timeoutMs` is at most 13,000ms and no longer than remaining budget; local batch timeout at most 14 seconds. Automatic Listing retries are disabled to prevent multiplied load. Individual failures do not discard successful or later batches.
- HTTP 429 stops new dispatch for the search; already-running requests may finish. Shared cooldown respects Retry-After seconds or HTTP date (invalid/missing uses 60 seconds). No immediate retry or rate-limit evasion.
- Listing budget at most 30 seconds; complete service budget 40 seconds, including catalogue reads and persistence. Deadline cancels and awaits outstanding workers. Incomplete counts include failed, cancelled and unstarted batches.
- Load lightweight catalogue names in 500-ID chunks, with a 3-second phase cap. Load rich static content only for returned hotels in 100-ID chunks, capped at 2 seconds. Missing static fields are never fabricated. Lookup is capped at 8 seconds. Session persistence is capped at 2 seconds, using the existing in-memory fallback on failure; on fallback, sessions remain process-local and restart-sensitive, not newly durable.
- Successful results return with `partial=true` and completed/failed counts. Both homepage and dedicated results show **Incomplete hotel search** plus a manual Retry hotel search button; Explore more retains the same cached response, warning and entered details. Retrying is a new search, not a promise to resume only missing batches.
- No usable results plus deadline exhaustion returns sanitized retryable HTTP 504 `PROVIDER_TIMEOUT`; upstream failures remain retryable 503. A completely successful empty search alone means no availability. A full-service deadline that prevents a usable response also returns 504.
- Hotel search browser budget is 50 seconds, longer than the backend 40-second budget; other booking/flight/payment timeouts are untouched. Existing proxy timeout remains 95 seconds.

At 2 starts/second, dispatching all 67 batches alone requires about 33 seconds, before last-response latency. Consequently this default intentionally **does not guarantee complete Dubai coverage within 30 seconds**: it prioritizes bounded load and honest partial results. Higher account-approved pacing/concurrency may improve completion, but only after measured UAT verification; never raise the ID cap or claim all city searches must return many hotels.

## Files changed

- `backend/app/core/config.py`
- `backend/app/integrations/tripjack/config.py`
- `backend/app/integrations/tripjack/listing_dispatch.py` (new)
- `backend/app/integrations/tripjack/hotels.py`
- `backend/app/integrations/tripjack/client.py` (Listing-only 429 metadata; other calls unchanged)
- `backend/app/repositories/hotel_catalogue.py` (read-only names method)
- `backend/app/services/hotel_search.py`
- `backend/app/services/hotel_sessions.py` (optional bounded search persistence; review untouched)
- `backend/.env.example`
- `backend/tests/test_hotel_listing_budget.py` (new)
- `src/lib/booking-api.ts`
- `src/lib/booking-api-hotel-budget.test.ts` (new)
- `src/components/HomeSearch.tsx`
- `src/routes/hotels.index.tsx`
- `AGENTS.md`, `roadmap.md`, this report.

## Checks

Synthetic, local-only tests cover 6,684 IDs/67 batches, 100-ID cap, out-of-order completion, deterministic deduplication, unique batch correlations, batch 37 failure, partial deadline results, no-result timeout→504, caller cancellation with no orphan tasks, process-shared concurrency/pacing, 429 dispatch stop/cooldown, Retry-After parsing, lightweight names/returned-only enrichment, full-service lookup deadline, slow persistence fallback and saved per-hotel context. Existing Listing, catalogue, detail, review and content-resilience tests are rerun.

Browser-request tests assert actual 50,000ms timer selection and unchanged 45,000ms default, plus partial payload retention; existing destination/date/multi-room handoff tests are rerun. Browser checks at 1280 and 390px show no page errors/overflow; preview is sample mode, **not live provider verification**. No fake live responses, production requests, database writes, syncs or deployments were made.

## Deployment and live acceptance (not performed)

1. Deploy the changed Python code to the VPS and frontend changes to Vercel together. No SQL migration, sync, catalogue change, Android rebuild or payment changes required.
2. Server-only VPS configuration: `HOTEL_LISTING_CONCURRENCY=3`, `HOTEL_LISTING_STARTS_PER_SECOND=2`, `HOTEL_SEARCH_BUDGET_SECONDS=40` are defaults; reduce to account limits. Start with **one VPS worker**: multiple workers/instances multiply the per-process ceilings; a shared distributed limiter is required before scaling. Existing frontend proxy origin stays unchanged.
3. Ensure nginx and Vercel request limits exceed 50 seconds; no proxy variable/host changes were made here. Do not increase provider account load beyond approved limits.
4. On UAT with approved credentials, search Dubai for varied dates/guest counts. Inspect sanitized mapped/planned/attempted/completed/failed/result counts, elapsed time, throttling and normalization drops—never raw IDs, payloads or correlations. Confirm either complete response, explicit partial warning + valid cards, or retryable 504/503 within budget.
5. Open Explore more, verify identical results/partial warning and dates/rooms/nationality/currency, then open a returned property to verify its originating correlation context. Verify retry after cooldown. Live service, hosting settings and Android checks remain unverified from this sandbox.