# Scalability readiness (commit c26dd1a, 2026-10-15)

No measurements were taken. Everything here is either **observed in code** (O) or a **hypothesis** (H). No supported user count is claimed.

## 1. Processes and workers
- **(O)** The README describes nginx → uvicorn/gunicorn on 127.0.0.1:8000 under systemd (`backend/README.md:79`). The worker count is not in the repo, so it is **not verified**.
- **(O)** Rate limiters, the auth token cache and the hotel in-memory fallback store live in process memory (`core/rate_limit.py` docstring, `core/auth.py:26-28`, `hotel_booking._memory`). With more than one worker:
  - each process gets its own limits;
  - the `_memory` fallback (used only when the database is not configured) would split state.
  - The docstring says Redis is needed before scaling out.
- **(O)** The payment worker is a one-shot command line (`app/jobs/payments_worker.py`) meant for a once-a-minute timer. Database locks make it safe to run several copies (`payu_claim_jobs` SKIP LOCKED).

## 2. Connections and blocking
- **(O)** The TripJack client uses one pooled `httpx.AsyncClient` with limits (`integrations/tripjack/client.py:77-85`).
- **(O)** `SupabaseRest` opens a **new AsyncClient per request** (`repositories/supabase_rest.py:71`). The same happens in `searches.py:53`, the Resend provider and the PayU client. Each call pays for a new TLS handshake.
- **(H)** This adds latency and burns sockets under load. A shared pooled client would fix it.
- **(O)** Auth verification makes one HTTP call per new token, cached for 60 s.

## 3. Database
- **(O)** Indexes exist on payments (txnid, mihpayid, one live payment per booking), jobs (status, updated_at) and refunds (payment_id).
- **(O)** Stale-payment, refund and job scans are capped at 50, 50 and 10 rows.
- **(H)** The admin list endpoints' pagination was not reviewed here.
- **(Not verified)** FNF Supabase plan and connection limits. The REST gateway pools connections for us.

## 4. Timeouts and retries
- **(O)** Supabase REST timeout comes from settings, with an 8 s fallback. PayU timeout is 15 s. Auth check is 5 s.
- **(O)** TripJack Book/Confirm use `retries=0`, so the system waits for the outcome instead of retrying.
- **(O)** Hotel status polling: every 5 s, for at most 180 s.
- **(O)** Fulfilment re-checks run once per worker pass, up to 40 attempts, then go to staff.
- **(H)** There is no jittered backoff on worker re-checks. At one pass per minute this is acceptable.

## 5. Caching and personal data
- **(O)** No shared HTTP cache is configured for API responses.
- **(H)** Vercel SSR pages that include personal data (account, checkout) need `Cache-Control: private, no-store`. This was not verified on deployment.
- **(O)** Prices and availability are always re-checked with the provider before booking (hotel `_fresh_review`).

## 6. Frontend assets
- **(O)** Package photography is bundled JPGs under `src/assets/international` (85 files) plus domestic stock photos, served by Vercel's CDN.
- **(H)** The JPGs are not resized responsively; image weight on mobile is probably the main page-weight cost. Bundle size was not measured.

## 7. Monitoring and operations
- **(O)** Logging is structured (`log_extra`). No alerting, metrics or error-tracking integration was found in the repo.
- **Missing:**
  - alerts for `manual_review` or `uncertain` fulfilment jobs;
  - alerts for refunds stuck in `unknown`;
  - alerts for an amount mismatch;
  - alerts for the worker not running.

## 8. Later staging load-test plan (do not run against production)
1. **Environment:** a staging VPS with PayU **test**, TripJack **UAT**, a separate Supabase project, and `PAYMENT_FULFILMENT_ENABLED=false` at first.
2. **Measure:**
   - p50/p95 latency for flight/hotel search at 5 → 50 concurrent users, staying within TripJack UAT rate limits agreed in writing with TripJack;
   - order creation at 20 concurrent requests for the same booking (expect one txnid);
   - 100 duplicate webhook deliveries (expect one capture and one job).
3. **Fault injection:**
   - kill the worker during a hotel job (expect a re-check only, never a second Book);
   - make PayU unreachable during a refund (expect `unknown` and no re-send).
4. **Record:** CPU, memory, open sockets and Supabase REST error rates. Only after this can a capacity figure be stated.
