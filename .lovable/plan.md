# Project Audit — Fly n Feel Holidays (read-only, no changes made)

## A. Existing architecture

TanStack Start v1 (React 19 + Vite 7), file-based routing, SSR enabled. Not a plain CRA/Vite SPA.

```text
src/
  routes/          file-based routes (+ generated routeTree.gen.ts)
  components/      marketing components + components/ui (shadcn set)
  data/            destinations.ts, posts.ts (static content, no DB)
  assets/          bundled images
  lib/             utils, error reporting, config.server.ts, api/example.functions.ts
  styles.css       Tailwind v4 theme (CSS-first, no tailwind.config.js)
  router.tsx / start.ts / server.ts
```

Build target: Nitro, default preset `cloudflare-module`; `build:vercel` and `build:node` presets also wired.

## B. Routes / pages

`/`, `/about`, `/contact`, `/domestic`, `/international`, `/blog`, `/blog/$slug`, `/destinations/$slug`, `/privacy`, `/terms`, `/sitemap.xml` (server handler). Root shell: `src/routes/__root.tsx` (head meta, fonts, scroll-to-top on route change, error + 404 boundaries).

## C. Reusable components

- Layout/chrome: `Nav`, `Footer`, `PageHero`, `Section` (SectionTitle), `SmoothScroll` (Lenis), `ScrollProgress`, `Cursor`
- Content: `Hero`, `Marquee`, `Destinations`, `Experiences`, `Testimonials`, `Contact`
- Full shadcn/ui library in `src/components/ui` (button, input, select, calendar, dialog, drawer, tabs, form, popover, sonner…) — already sufficient for search forms, date pickers, filter panels and booking modals.

## D. Design system

Tailwind v4 via `@theme inline` in `src/styles.css`. Pearl-white/rich-black luxury palette: `--background #F8F8F6`, `--foreground #111111`, brand accent `--gold: #d62828` (logo red). Fonts: display = Helvetica Neue / Inter Tight, body = SF Pro / Inter. Semantic tokens only — new booking UI must use `bg-card`, `text-gold`, `border-foreground/10`, etc.

## E. API / backend functionality

Essentially none. One template file `src/lib/api/example.functions.ts` (`createServerFn` greeting demo) and `src/lib/config.server.ts` (server-only env reader stub). One server route handler: sitemap. All destination and blog content is static TypeScript.

## F. Supabase

Not integrated. No `src/integrations/supabase`, no client, no tables, no migrations, no dependency in package.json.

## G. Authentication

None. No login, no session, no protected routes, no `_authenticated` layout.

## H. Environment variables / configuration

No `.env` in the repo. Only `NITRO_PRESET` at build time. No secrets anywhere in the frontend today — clean starting point for the "no credentials in React" rule.

## I. Dependencies

React 19, TanStack Router/Start/Query, framer-motion, lenis, tailwindcss v4, full Radix set, react-hook-form + @hookform/resolvers + zod, date-fns, react-day-picker, embla, recharts, sonner, lucide-react. Notably absent: axios, supabase-js, razorpay, any auth lib. TanStack Query is installed and wired into the router context but currently unused for data fetching.

## J. Deployment

`vercel.json` → `npm run build:vercel` (Nitro vercel preset). `DEPLOYMENT.md` documents Node/VPS (`build:node` + `node .output/server/index.mjs`) and other presets. Lovable preview builds with the cloudflare preset.

## K. Recommended placement for booking functionality

- New routes: `src/routes/flights.tsx` (+ `flights.results.tsx`, `flights.review.tsx`), `src/routes/hotels.tsx` (+ results/detail/review), `src/routes/booking.$id.tsx` for confirmation/voucher, optionally `src/routes/manage-booking.tsx`.
- New folder `src/components/booking/` for search widgets, result cards, filter rails, traveller forms, fare/price breakdown — built from `components/ui`, styled with existing tokens.
- Single API layer: `src/lib/booking-api.ts` — a thin typed `fetch` wrapper pointing at `import.meta.env.VITE_BOOKING_API_URL` (public backend URL only). All calls go through it; no component calls the backend directly.
- Data fetching: TanStack Query (already in router context) — `useQuery` for searches, `useMutation` for booking/payment steps.
- Nav/Footer get "Flights" and "Hotels" links; the home Hero can host a compact search widget later, without altering existing copy or layout.

## L. Potential conflicts with the FastAPI architecture

1. **SSR loaders vs. IP whitelisting.** TanStack Start SSR runs on Vercel/Cloudflare with rotating IPs. Any booking call made inside a route `loader` runs server-side from a non-whitelisted host. Rule: all TripJack-backed calls must be client-side (`useQuery` in components) hitting the FastAPI VPS, which is the only whitelisted IP.
2. **Don't reintroduce a second backend.** The template pushes `createServerFn` for server logic; using it for TripJack would put logic on Vercel, defeating the VPS/IP model. Keep `createServerFn` unused for booking.
3. **CORS.** FastAPI must allow the Vercel prod domain, the Lovable preview domain, and localhost.
4. **HTTPS.** The VPS needs a real TLS cert (nginx + certbot); the browser will block plain-HTTP calls from the HTTPS site.
5. **Env exposure.** Only `VITE_`-prefixed values exist in the browser — the backend base URL and Razorpay *key_id* are fine there; nothing else.
6. **Long-running TripJack searches.** 10-30s responses need loading/pending UI and a client timeout; SSR prerender must never wait on them.
7. **Session/auth later.** Guest booking works today; if login is added, it belongs on FastAPI/Supabase, not the frontend.

## M. Do not change

`src/styles.css` tokens, `Nav`/`Footer`/`Hero`/`PageHero`/`Section` layout and copy, all existing routes and their `head()` metadata, `src/data/destinations.ts` and `posts.ts`, `src/routeTree.gen.ts` (generated), `vite.config.ts` Nitro/preset block, `vercel.json`, `src/routes/__root.tsx` shell, the hero alignment CSS media query for short laptop viewports.

## Next step (not executed)

Once TripJack staging IP whitelisting is resolved and the API key is issued, the first build step is the FastAPI service skeleton on the VPS plus `src/lib/booking-api.ts` and a `/flights` search route — additive only.
