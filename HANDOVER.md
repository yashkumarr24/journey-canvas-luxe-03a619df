# Fly n Feel Holidays — Project Handover & Continuation Blueprint

Documentation only. Contains no keys, passwords, tokens or connection strings — variable **names** only.
Last updated: 2026-09-18. Phases 1–11 complete.

---

## A. CURRENT STATE SUMMARY

Fly n Feel Holidays is a travel website with a full flight and hotel booking journey, a customer account area, a guest booking lookup, an operations/support desk for staff, and an analytics + activity admin panel.

The **frontend is complete and working end to end today** in test/mock mode. Every screen of both booking journeys, checkout, confirmation, my-trips, cancellation requests, support threads, the admin booking desk and the analytics dashboards can be walked through without any external credentials.

The **backend exists as code** (FastAPI, `backend/`) with the TripJack flight search + review integration, analytics, admin and operations endpoints written and syntax-verified — but it is **not deployed** and no provider credentials exist yet. The **database migrations exist as SQL files** (`0001` → `0009`) but **have not been applied** to any Supabase project from this environment.

So: UI and architecture done; live provider, live payment, live database and hosting are the remaining work.

---

## 1. Architecture & technology stack

**Frontend**
- TanStack Start v1 (React 19, SSR) built with Vite 7
- TanStack Router (file-based routing, `src/routes`) + TanStack Query for data
- Tailwind CSS v4 via `src/styles.css` (no `tailwind.config.js`)
- Radix UI / shadcn-style components, lucide-react icons
- framer-motion + lenis for the hero parallax and smooth scroll
- recharts for admin charts, sonner for toasts
- `@supabase/supabase-js` in the browser for **auth only** (anon key, RLS enforced)

**Backend** (separate service, `backend/`)
- FastAPI + uvicorn, pydantic v2 / pydantic-settings, httpx
- Owns all TripJack traffic, all privileged Supabase access (service-role), and later Razorpay

**Database**
- Supabase PostgreSQL. Numbered SQL migrations in `backend/db/migrations`.

**Request flow**
```text
Browser (React) ──HTTPS──▶ FastAPI (VPS, static IP) ──▶ TripJack / Supabase / Razorpay
Browser ──▶ Supabase Auth (anon key only, read-own RLS)
```
The browser never talks to TripJack, never holds a service-role key, and is never trusted for prices.

---

## 2. Folder / file structure (important files)

```text
src/
  routes/                 file-based pages (see section 3)
  components/             marketing UI (Hero, Nav, Footer, Destinations, ...)
    booking/              flight+hotel search forms, result cards, filters,
                          traveller/guest forms, fare breakdown, payment sheet
    ops/                  BookingCard, BookingTimeline, DocumentsPanel,
                          BookingDetailPanels, OpsBadges
    admin/                AdminShell, MetricCard, AnalyticsFilters,
                          LiveActivityTable, DemoActivityControls
    auth/                 AuthLayout, PasswordField
  lib/
    booking-api.ts        ONLY flight booking API boundary
    flight-search.ts / flight-filters.ts / review-session.ts
    hotel-api.ts / hotel-mock.ts / hotel-search.ts / hotel-session.ts
    checkout-api.ts / checkout-mock.ts / checkout-session.ts / razorpay.ts
    ops/                  ops-api.ts, ops-mock.ts, ops-store.ts,
                          notifications.ts, ops-demo.ts
    admin/                admin-roles.ts, admin-api.ts, admin-mock.ts,
                          admin-context.tsx
    analytics/            tracker.tsx, events.ts, session.ts,
                          analytics-api.ts, analytics-store.ts,
                          admin-analytics.ts, demo-seed.ts
    auth/                 auth-context.tsx, query-keys.ts, redirect.ts, messages.ts
    supabase/client.ts    browser Supabase client (anon key only)
    account/account-queries.ts
  types/                  booking.ts, operations.ts
  data/                   destinations.ts, posts.ts (marketing content)
  assets/                 bundled images
  router.tsx, server.ts, start.ts, styles.css, env.d.ts
  routeTree.gen.ts        GENERATED — never edit

backend/
  app/main.py             FastAPI app assembly
  app/api/health.py, app/api/v1/{flights,review,analytics,admin,operations}.py
  app/services/           flight_search, flight_booking, analytics_admin
  app/repositories/       bookings, searches, reviews, analytics, operations,
                          supabase_rest
  app/integrations/tripjack/  client, config, flights, review, schemas, exceptions
  app/core/               config, logging, security, auth, admin_auth,
                          errors, rate_limit
  app/middleware/request_context.py
  app/schemas/            flights, review, analytics, operations, common
  db/migrations/0001..0009 + db/README.md
  tests/                  test_health, test_flight_search, test_flight_review
  requirements.txt, .env.example

vite.config.ts, vercel.json, DEPLOYMENT.md, package.json, .env.example
```

---

## 3. Routes & pages

**Marketing**: `/` (index), `/about`, `/contact`, `/domestic`, `/international`, `/destinations/$slug`, `/blog`, `/blog/$slug`, `/privacy`, `/terms`, `/sitemap.xml`.
Shell/layout: `src/routes/__root.tsx` (nav, footer, providers, scroll-to-top).

**Flights**: `/flights` (search + results) → `/flights/review` (re-price + travellers) → `/flights/checkout` (payment) → `/flights/confirmation`.

**Hotels**: `/hotels` (search + results) → `/hotels/detail` (hotel + rooms) → `/hotels/review` (re-price + guests) → `/hotels/checkout` → `/hotels/confirmation`.

**Auth**: `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`.

**Customer account** (guarded by `src/routes/_authenticated.tsx`):
`/account` overview, `/account/profile`, `/account/travellers`, `/account/bookings` (my trips), `/account/bookings/$reference` (detail, documents, timeline, cancellation request), `/account/support`.

**Guest**: `/booking-lookup` — requires booking reference **and** the contact email on the booking.

**Admin**: `/admin/login`, `/admin` dashboard (operations metrics + analytics), `/admin/bookings`, `/admin/bookings/$reference`, `/admin/support`, `/admin/activity`, `/admin/sessions`, `/admin/funnel`, `/admin/analytics`, `/admin/booking-activity` (the original Phase 10 event list), `/admin/users`.

---

## 4. Frontend architecture & API boundaries

One module per domain is the **only** place network calls happen. Components never call providers directly.

| Boundary | Domain | Mock counterpart | Mock active when |
|---|---|---|---|
| `src/lib/booking-api.ts` | flight search / review / booking | (backend required) | n/a — returns a "not configured" error |
| `src/lib/hotel-api.ts` | hotel search/detail/review/book | `hotel-mock.ts` | API URL unset or `VITE_HOTEL_TEST_MODE` |
| `src/lib/checkout-api.ts` | payment order/confirm | `checkout-mock.ts` | API URL unset or `VITE_BOOKING_TEST_CHECKOUT` |
| `src/lib/ops/ops-api.ts` | bookings, support, cancellations, admin desk | `ops-mock.ts` + `ops-store.ts` | API URL unset |
| `src/lib/analytics/analytics-api.ts` | event/session ingest | `analytics-store.ts` | API URL unset or `VITE_ANALYTICS_TEST_MODE` |
| `src/lib/admin/admin-api.ts` | admin identity + dashboards | `admin-mock.ts` | API URL unset |

Session state between steps lives in `review-session.ts`, `hotel-session.ts`, `checkout-session.ts` (opaque references, never prices the server must trust).

---

## 5. FastAPI backend architecture & endpoints

Layering: `api/v1` (HTTP) → `services` (business rules) → `repositories` (Supabase REST) / `integrations/tripjack` (provider). `core` holds settings, structured logging, JWT verification (`auth.py`), admin level checks (`admin_auth.py`), rate limiting, and the safe error envelope `{success, code, message, request_id}`.

- `GET /health`, `GET /health/ready`
- `POST /api/v1/flights/search`
- `POST /api/v1/flights/review`, `GET /api/v1/flights/review/{id}`, `POST /api/v1/flights/review/travellers`
- `POST /api/v1/analytics/events`, `/session`, `/session/end`
- `GET /api/v1/admin/me`, `/analytics/overview`, `/analytics/activity`, `/analytics/funnel`, `/analytics/sessions`
- Customer ops: `GET /api/v1/bookings`, `GET /api/v1/bookings/{reference}`, `POST /api/v1/bookings/lookup`, `POST /api/v1/bookings/{reference}/cancellation-request`, `GET /api/v1/support`, `POST /api/v1/support`, `GET /api/v1/support/{id}`
- Admin ops: `GET /api/v1/admin/bookings`, `GET /api/v1/admin/bookings/{reference}`, `POST /api/v1/admin/bookings/{reference}/notes`, `GET /api/v1/admin/support`, `PATCH /api/v1/admin/support/{id}`, `GET /api/v1/admin/metrics`

Rules baked in: the acting user id comes from the verified bearer token (never the request body); ownership is part of every query predicate; guest reads need reference **and** email; internal notes/messages are never returned to a customer; hotel endpoints (`/api/v1/hotels/*`) are contract-only and not implemented yet.

---

## 6. Database structure & migrations

Apply **in numeric order**; each file is idempotent.

| # | File | Creates |
|---|---|---|
| 0001 | `0001_foundation.sql` | extensions, enums (booking_type, booking_status, payment_status, trip_type, cabin_class, booking_item_type, provider_code), `set_updated_at()`, `generate_booking_reference()` |
| 0002 | `0002_profiles_travellers.sql` | `profiles`, `travellers` |
| 0003 | `0003_searches.sql` | `flight_searches`, `hotel_searches`, `search_result_refs` |
| 0004 | `0004_bookings.sql` | `bookings`, `booking_items`, `booking_travellers` |
| 0005 | `0005_payments_events.sql` | `payments`, `booking_events` (the timeline), `provider_debug_logs` |
| 0006 | `0006_rls_policies.sql` | all RLS policies |
| 0007 | `0007_review_sessions.sql` | `review_status` enum, `flight_review_sessions`, `request_idempotency` |
| 0008 | `0008_analytics_admin.sql` | `admin_role` enum, `admin_users`, `user_sessions`, `activity_events`, `analytics_daily` |
| 0009 | `0009_operations.sql` | cancellation/refund/support enums, `cancellation_requests`, `support_requests`, `support_messages`, `booking_internal_notes`, `notification_events` |

Apply with `supabase db push`, or `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <file>`. **Never edit tables by hand in the dashboard** — add a new numbered migration.

Money is always `numeric(12,2)` + `char(3)` currency, never floating point. Flights and hotels **share** bookings/booking_items/booking_travellers/payments/booking_events — there is no separate hotel booking system.

---

## 7. Authentication, RLS & security

- Customer auth: Supabase Auth in the browser with the anon key. Session context in `src/lib/auth/auth-context.tsx`; protected subtree gate in `src/routes/_authenticated.tsx`.
- RLS is read/write-own: every customer policy requires `user_id = auth.uid()`. `booking_internal_notes` has no authenticated grant at all. Search tables and debug logs are internal only.
- FastAPI re-checks ownership on every booking/payment call; RLS is the last line of defence, not the only one.
- Guest bookings have `user_id = NULL` and are retrieved by reference **plus** matching contact email, verified server-side. A reference alone is not an access token.
- Admin: three levels (see section 10) enforced in the UI (convenience), in FastAPI (`require_admin(level)`) and in the database (`has_admin_level()` + RLS).
- Never stored anywhere: passwords, OTPs, card number/CVV/expiry, UPI PIN, API keys, service-role key. Passport fields are nullable, never logged, never in URLs.
- Service-role key is backend-only. There is deliberately no `VITE_SUPABASE_SERVICE_ROLE_KEY`; if one ever appears, treat it as a security incident.

---

## 8. Flight booking flow — status

Search form → results (filters, sorting) → review (server re-price + price-change consent) → traveller details → checkout → payment → confirmation → the booking appears in My Trips and on the admin desk.

| Step | Status |
|---|---|
| Search UI + normalized types | done |
| TripJack search integration (backend code) | written, **not deployed**, no credentials |
| Review / re-price + traveller submission (backend code) | written, not deployed |
| Draft booking awaiting payment | done |
| Payment | mock only |
| Ticket / PNR | placeholder values |

Frontend runs on mock data until `VITE_BOOKING_API_URL` points at a live backend.

## 9. Hotel booking flow — status

Search → results → detail + rooms → review/re-price → guest details → checkout → confirmation. The frontend is real and complete; the **data provider is mock only** (`hotel-mock.ts`), covering no-results, expiry, price increase, room unavailable, booking failure and pending states. No hotel endpoints are implemented in FastAPI yet — only contracts. **Open decision:** keep hotels visible as a demo, add a "demo mode" notice, hide the nav link, or remove the module until TripJack hotels are live.

---

## 10. Payment / checkout architecture & mock mode

`checkout-api.ts` is the only payment boundary; `checkout-mock.ts` simulates order creation, processing, success, failure and retry; `TestPaymentSheet.tsx` is the visibly labelled test surface. `razorpay.ts` holds the integration shape only. The mock never touches card data and never moves money. Real work later: payment order/confirm/failure endpoints, signed webhook verification, invoice/ticket generation, refunds on failed issuance, then delete the mock adapter.

---

## 11. Admin panel, roles & permissions

Roles are defined in `src/lib/admin/admin-roles.ts` (UI convenience) and mirrored by the `admin_role` enum in migration 0008.

| Level | Role | Can |
|---|---|---|
| 1 | staff | dashboard, view bookings/customers/notes/support (read-only) |
| 2 | manager | + manage bookings, payments, analytics, activity, reports, notes, support, cancellations |
| 3 | owner | + manage admin users and platform settings |

When no backend is configured the panel uses demo admin accounts defined in `src/lib/admin/admin-mock.ts` with a sessionStorage session. These are test-only and must never exist in production. Real accounts live in `admin_users`.

## 12. Analytics & live activity

`analytics/tracker.tsx` records only meaningful business events (`events.ts`) with sanitized properties, opaque `ses_…` session ids (`session.ts`), deduplicated page views, and guest→authenticated association. Tracking is fully non-blocking and never affects search, checkout or booking. Dashboards: overview, live activity, sessions/journeys, funnel (flights and hotels separately), with date/product filters. Tables: `user_sessions`, `activity_events`, `analytics_daily`. Realtime is currently polling/mock; WebSocket `/api/v1/admin/analytics/live` and daily rollups are future work.

## 13. Customer account / bookings / support

My Trips buckets (upcoming, completed, cancelled, failed, pending, all), product filter, search, sort, load-more, and loading/empty/error/retry states. Detail shows flight or hotel specifics, fare/price breakdown, payment + booking status, documents panel (placeholders only — no fake tickets), the booking timeline, and a cancellation request form. Support: create a request (booking, category, message), track status (open, in progress, waiting for customer, resolved, closed), read replies. Cancellation and refund actions are **recorded requests only** — no provider cancellation and no refund happens.

---

## 14. Mock / test adapters

| Adapter | Simulates |
|---|---|
| `src/lib/hotel-mock.ts` | hotel listing, detail, rooms, review/re-price, price change, unavailable room, expiry, booking success/pending/failure |
| `src/lib/checkout-mock.ts` | payment order, processing, success, failure, retry; test booking references/PNR placeholders |
| `src/lib/ops/ops-mock.ts` + `ops-store.ts` | my-trips, booking detail/timeline/documents, guest lookup, cancellation requests, support threads, admin desk, operational metrics (localStorage-backed, shared across tabs) |
| `src/lib/ops/ops-demo.ts` | clearly labelled synthetic sample bookings, added/removed from the admin list |
| `src/lib/analytics/analytics-store.ts` + `demo-seed.ts` | local event/session capture and demo dashboard data |
| `src/lib/admin/admin-mock.ts` | demo admin identities and level checks |

All bypass automatically once `VITE_BOOKING_API_URL` is set (per-domain overrides listed in section 4).

---

## 15. Environment variables (names only)

**Frontend (`VITE_*`, public, embedded in the browser bundle)**
`VITE_BOOKING_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BOOKING_TEST_CHECKOUT`, `VITE_HOTEL_TEST_MODE`, `VITE_ANALYTICS_TEST_MODE`.

**Backend (`backend/.env`, server-only)**
`APP_ENV`, `APP_DEBUG`, `APP_HOST`, `APP_PORT`, `LOG_LEVEL`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `CORS_ALLOWED_ORIGIN_REGEX`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `TRIPJACK_BASE_URL`, `TRIPJACK_API_KEY`, `TRIPJACK_CONNECT_TIMEOUT`, `TRIPJACK_READ_TIMEOUT`, `TRIPJACK_WRITE_TIMEOUT`, `TRIPJACK_POOL_TIMEOUT`, `TRIPJACK_MAX_CONNECTIONS`, `TRIPJACK_SEARCH_RETRIES`, `TRUST_PROXY_HEADERS`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.

Never put a TripJack, Razorpay or service-role value in any `VITE_` variable. Values live in host config only, never in the repo.

## 16. External services: connected vs not

| Service | Status |
|---|---|
| TripJack flights | integration code written; **not connected** (no key, no static IP host yet) |
| TripJack hotels | **not connected**; frontend is mock |
| Razorpay | **not connected**; structure only |
| Supabase project | migrations written; **not applied / not connected** in this environment |
| Lovable Cloud | not enabled (this project uses its own Supabase + FastAPI design) |
| Email / SMS / WhatsApp / push | **not connected**; notification events recorded locally, undispatched |
| Vercel | configured via `vercel.json` (frontend host) |
| GoDaddy VPS | planned, not provisioned |

---

## 17. Deployment

**Frontend (Vercel)**: `vercel.json` runs `npm run build:vercel` (`NITRO_PRESET=vercel`). Any Node host works with `npm run build:node` then `npm run start` (`.output/server/index.mjs`, listens on `PORT`). Shared cPanel hosting cannot run this app. Other presets: `node-server`, `netlify`, `cloudflare`. See `DEPLOYMENT.md`.

**Backend (planned GoDaddy VPS)**: FastAPI behind Nginx with TLS on `api.<domain>`, run by systemd/uvicorn, `backend/.env` on the server only, `TRUST_PROXY_HEADERS=true` behind the proxy. The VPS static IP is what TripJack allow-lists — this is why provider calls must never come from the browser or a serverless function. Suggested size: 2 vCPU / 4 GB. Separate dev, UAT and production environments, each with its own Supabase project and its own TripJack key; migrations flow dev → UAT → prod.

**Workflow**: sync the Lovable project to GitHub (Plus menu → GitHub), Vercel builds `main` for production and branches for previews; the backend deploys separately (`git pull` + restart the service, or a small CI job). Frontend and backend versions must stay compatible — deploy the backend first when adding an endpoint.

---

## 18. Phases: completed and next (D. PHASE ROADMAP)

**Completed**
1. Marketing site, design language, hero/parallax, nav/footer
2. FastAPI backend foundation (config, logging, security, CORS, errors)
3. Frontend API layer + booking domain types + `/flights`
4. Supabase schema: profiles, travellers, bookings, payments + RLS
5. Auth, session, authorization, account routes
6. TripJack flight search integration (server-only)
7. Fare review, traveller details, pre-book validation, price-change consent
8. Payment/checkout frontend + confirmation (mock adapter)
9. Hotel booking module (mock provider, full journey)
10. Activity tracking, analytics, admin panel with 3 role levels
11. Customer & admin operations: my trips, guest lookup, documents placeholders, cancellation requests, support, admin booking desk, internal notes, timeline, notification foundation

**Next (planned)**
12. Real payments (Razorpay orders, signed webhooks, refunds)
13. Documents: e-tickets, hotel vouchers, invoices + email delivery
14. TripJack hotel integration replacing the hotel mock
15. Live realtime analytics (WebSocket / Supabase Realtime) + daily rollups
16. Production hardening: VPS provisioning, migrations applied per environment, real admin accounts, monitoring
17. Mobile app wrapper (Capacitor) for Play Store / App Store

## 19. Remaining work, known limitations, TODOs

- Migrations `0001`–`0009` have **not been applied** to any database from this environment; `0009` in particular is untested against a live Postgres.
- No Supabase project is configured here, so auth-gated screens (`/account/*`) cannot be exercised in this sandbox.
- No TripJack or Razorpay credentials; flight search, review and payment run on mock data.
- Hotels are mock-only; the keep / demo-notice / hide / remove decision is still open.
- Documents (e-ticket, voucher, invoice) are placeholders by design — no fake documents are generated.
- Cancellations and refunds are recorded-only; nothing is cancelled and no money moves.
- Notification events are stored locally and never dispatched (no email/SMS provider).
- The cancellation-requests metric on the admin dashboard reads 0 until real data exists.
- `/booking-lookup` form inputs have no `name`/`id` attributes, which makes automated tests fill them by position.
- Backend `pytest` cannot run in this sandbox (FastAPI not installed); Python files were syntax-checked instead.
- Admin demo accounts in `src/lib/admin/admin-mock.ts` must be removed or disabled before production.
- Realtime analytics is polling/mock, not a WebSocket.

## 20. Files that must NOT be deleted or replaced

- `src/routes/__root.tsx`, `src/router.tsx`, `src/server.ts`, `src/start.ts` — app shell and entry points
- `src/routeTree.gen.ts` — generated; never hand-edit, never delete
- `src/routes/_authenticated.tsx` — the auth gate (contains a deliberate one-shot redirect guard; removing the `useRef` reintroduces a redirect loop)
- API boundaries: `src/lib/booking-api.ts`, `hotel-api.ts`, `checkout-api.ts`, `ops/ops-api.ts`, `analytics/analytics-api.ts`, `admin/admin-api.ts`
- `src/lib/ops/ops-store.ts`, `src/types/operations.ts`, `src/types/booking.ts`
- `src/lib/supabase/client.ts`, `src/lib/auth/auth-context.tsx`, `src/lib/admin/admin-roles.ts`
- All of `backend/db/migrations/*` — never renumber, never rewrite an applied migration
- `backend/app/core/*` (config, auth, admin_auth, security, errors), `backend/app/integrations/tripjack/*`
- `vite.config.ts`, `vercel.json`, `package.json`, `src/styles.css`

## 21. Dependencies & purpose

Framework: `@tanstack/react-start`, `@tanstack/react-router`, `@tanstack/router-plugin`, `react`, `react-dom`, `vite`, `nitro`.
Data: `@tanstack/react-query`, `@supabase/supabase-js`, `zod`.
UI: `tailwindcss` + `@tailwindcss/vite`, `tw-animate-css`, all `@radix-ui/*`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `cmdk`, `vaul`, `sonner`, `embla-carousel-react`, `react-day-picker`, `input-otp`, `react-resizable-panels`.
Forms: `react-hook-form`, `@hookform/resolvers`.
Motion/scroll: `framer-motion`, `lenis`. Charts: `recharts`. Dates: `date-fns`.
Tooling: `typescript`, `eslint` + plugins, `prettier`, `@types/*`, `@lovable.dev/vite-tanstack-config`.
Backend (`backend/requirements.txt`): `fastapi`, `uvicorn[standard]`, `pydantic`, `pydantic-settings`, `python-dotenv`, `httpx`, `pytest`, `pytest-asyncio`.

## 22. Build / test commands & current status

Frontend: `npm install`, `npm run dev`, `npm run build`, `npm run build:vercel`, `npm run build:node`, `npm run start`, `npm run lint`, `npm run format`; typecheck with `npx tsc --noEmit`.
Backend: `pip install -r backend/requirements.txt`, `uvicorn app.main:app --reload` from `backend/`, `pytest` from `backend/`.

Status: typecheck passes; browser walkthroughs of the admin desk, booking detail, timeline, notes, support and guest lookup pass with no console errors; backend tests not runnable in this sandbox.

---

## B. CONTINUATION CHECKLIST

1. Get the code into the new place (GitHub → clone, or import into the new Lovable account). Run `npm install`, `npm run dev`, confirm `/`, `/flights`, `/hotels`, `/admin/login` all render.
2. Create a Supabase project for **development**. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; leave the service-role key out of the frontend entirely.
3. Apply migrations `0001` → `0009` in order to that project. Verify the tables and RLS policies exist.
4. Register a test customer, confirm `/account`, `/account/bookings` and `/account/support` load.
5. Insert a real row in `admin_users` for yourself (level 3), then disable the demo admin accounts.
6. Stand up the FastAPI backend locally (`backend/.env` from `.env.example`), point `VITE_BOOKING_API_URL` at it, and confirm mock mode switches off.
7. Provision the VPS with a static IP, get that IP allow-listed by TripJack, add the staging TripJack key on the server only, and test flight search end to end.
8. Decide the hotel module's fate (keep demo / notice / hide / remove) and, if keeping, build the TripJack hotel endpoints.
9. Add Razorpay: order + confirm endpoints, signed webhook, then remove `checkout-mock.ts`.
10. Add document generation and email delivery; replace the placeholder document states.
11. Repeat steps 2–3 for UAT and production Supabase projects with their own keys.
12. Only then consider the mobile wrapper.

## C. MIGRATION CHECKLIST (moving accounts / to VS Code)

Preserve, in full:
- The whole `src/` tree, including `routeTree.gen.ts` and `src/styles.css`
- The whole `backend/` tree, especially `db/migrations/*` and `app/core/*`
- Config: `package.json`, `package-lock`/`bun.lock`, `vite.config.ts`, `vercel.json`, `tsconfig.json`, `components.json`, `eslint.config.js`, `.prettierrc`, `bunfig.toml`
- Docs: this file, `DEPLOYMENT.md`, `backend/db/README.md`, `src/routes/README.md`, `.env.example`, `backend/.env.example`, `.lovable/plan/*`
- `public/` (favicons, robots.txt) and `src/assets/` images
- Environment **variable names** — re-enter values in the new host's settings; `.env` files are never committed
- Supabase: move or recreate the project, then re-apply migrations in order. Database data does not travel with the code.

Do not carry over: `node_modules`, `.output`/`dist`/`.vercel`, any `.env` file, browser localStorage test data.

After the move: `npm install`, `npm run dev`, typecheck, then walk one flight and one hotel journey plus `/admin/login`.

## E. CRITICAL WARNINGS

- **Never put TripJack, Razorpay or Supabase service-role values in a `VITE_` variable or any frontend file.** They would be readable by anyone.
- **Do not rewrite or renumber an applied migration.** Add a new numbered file instead; editing history breaks environments that already ran it.
- **Do not edit `src/routeTree.gen.ts`.** It regenerates; hand edits break routing.
- **Do not remove the one-shot redirect guard in `src/routes/_authenticated.tsx`** — it prevents an infinite login redirect loop.
- **Do not delete an API boundary file** (`booking-api.ts`, `hotel-api.ts`, `checkout-api.ts`, `ops/ops-api.ts`) and call providers from components; that breaks mock mode and the security model.
- **Do not remove the mock adapters before their real endpoints exist** — the app would lose its entire testable flow.
- **Never trust prices, fare ids, amounts or `user_id` from the browser.** The server must re-price and re-check ownership every time.
- **Clearing browser localStorage deletes all test bookings, support threads and notes** — the mock store is browser-local, not a database.
- **Disable the demo admin accounts before going live**, and never rely on frontend role checks alone.
- **Renaming or removing a route file breaks every link to it**; also update the nav, footer and sitemap.
- **CORS must never be `*`**, and `TRUST_PROXY_HEADERS` must only be true behind a trusted proxy, or rate limiting can be bypassed.
- **Cancellation/refund screens are recorded requests only.** Do not tell customers a refund happened until a payment provider is actually connected.
