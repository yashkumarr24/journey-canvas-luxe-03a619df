# Fly n Feel — Project Handover / Continuation Blueprint

Documentation only. No code changes, no secrets, no keys.

## What will be produced

One master handover document, written as a project file so it travels with the code, plus a copy in Files for reading outside the project:

- `HANDOVER.md` at the project root (the authoritative copy that moves with the repo)
- A copy in Files (`/mnt/documents/flynfeel-handover.md`) so it can be opened and shared directly

Nothing else is created, edited or deleted.

## Document structure

1. **Current state summary (A)** — where the project stands today in a few paragraphs.
2. **Architecture and stack** — TanStack Start v1 (React 19, Vite 7), Tailwind v4, TanStack Router/Query, framer-motion, Radix/shadcn UI, Supabase JS on the client, separate FastAPI backend (Python) for all provider traffic.
3. **Folder / file map** — `src/routes`, `src/components`, `src/lib` (booking, hotel, ops, admin, analytics, auth), `src/types`, `src/data`, `src/assets`, `backend/app`, `backend/db/migrations`, config files; each important file with a one-line purpose.
4. **Routes and pages** — every file in `src/routes` (marketing, flights, hotels, auth, `_authenticated/account/*`, `booking-lookup`, `admin.*`, sitemap) with its URL and purpose.
5. **Frontend architecture and API boundaries** — the single-boundary rule: `src/lib/booking-api.ts` (flights), `hotel-api.ts` (hotels), `checkout-api.ts` (payment), `ops/ops-api.ts` (operations), `analytics/analytics-api.ts`, `admin/admin-api.ts`; each with its mock counterpart and the mock-mode switch.
6. **Backend architecture and endpoints** — `backend/app` layering (api/v1, services, repositories, integrations/tripjack, core, middleware, schemas) and the full endpoint list for health, flights, review, analytics, admin, operations.
7. **Database and migrations** — the nine migrations `0001_foundation` → `0009_operations`, the tables each creates, the reuse rule (bookings/booking_items/booking_travellers/payments/booking_events are shared by flights and hotels), grants and apply order.
8. **Auth, RLS and security architecture** — Supabase Auth on the client, JWT verification server-side, service-role key backend-only, read-own RLS, guest booking retrieval requiring reference + contact email, admin level checks in UI + API + RLS, and the data never stored (card data, provider secrets).
9. **Flight flow status** and **hotel flow status** — step-by-step journeys and what is live vs mock per step.
10. **Payment / checkout architecture and mock mode** — Razorpay-shaped structure, test payment sheet, what the mock does and does not do (no money, no cards).
11. **Admin panel** — routes, Level 1/2/3 roles, permission matrix, demo-account behaviour when the backend is not configured.
12. **Analytics and live activity** — event taxonomy, opaque sessions, non-blocking tracking, dashboards, planned realtime.
13. **Customer account / bookings / support** — list, detail, documents placeholders, cancellation request workflow, support threads, guest lookup.
14. **Mock and test adapters** — one table: adapter file, what it simulates, edge cases covered, how it is bypassed.
15. **Environment variables** — names only, split frontend (`VITE_*`) vs backend, with a note that values live in host config, never in the repo.
16. **External services** — connected vs not connected today (TripJack, Razorpay, Supabase project, email/SMS, Lovable Cloud).
17. **Deployment** — Vercel config and build presets; the planned GoDaddy VPS layout for FastAPI (Nginx, TLS, systemd, static IP for TripJack allow-listing); environment separation.
18. **GitHub / deployment workflow** — repo sync, branch → preview → production, how backend deploys separately.
19. **Phase roadmap (D)** — Phases 1–11 complete, with the planned next phases (real provider wiring, payments, documents, notifications, mobile app wrapper).
20. **Remaining work, known limitations, TODOs** — including: migration 0009 not yet applied to any database, no Supabase project connected in this environment so auth-gated screens can't be exercised here, hotel data mock-only and the keep/demo/hide decision still open, documents are placeholders, cancellation/refund is recorded-only, backend tests can't run in the current sandbox, guest-lookup form fields lack name/id attributes.
21. **Instructions for a new developer / new Lovable account** — clone, install, run, what to configure first, what to verify before touching booking code.
22. **Files that must not be deleted or replaced** — routing entry files, the API boundary files, migrations, backend core/auth, ops store/types.
23. **Dependencies and their purpose** — grouped: framework, routing/data, UI, forms/validation, motion/scroll, charts, Supabase, backend Python packages.
24. **Build / test commands and status** — dev, build, build:vercel, build:node, start, lint, format, typecheck; current results and what cannot be run here.
25. **Continuation checklist (B)**, **Migration checklist (C)**, **Critical warnings (E)** as their own closing sections.

## Accuracy rules for the write-up

- Every claim comes from reading the actual files; anything unverified is labelled as unverified rather than stated as fact.
- No credential values, tokens, passwords or connection strings — variable names only.
- Demo/test login identifiers already present in the codebase are referenced by file location, not repeated as usable credentials.
