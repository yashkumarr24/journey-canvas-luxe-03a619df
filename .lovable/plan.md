## Goal

Make the project deploy cleanly to **Vercel** today, and stay portable to any **Node.js host** (Hostinger Node plans, VPS, Render, Railway, etc.) tomorrow — with no Vercel-specific lock-in.

## Important honesty up front

- **GoDaddy shared hosting and Hostinger shared (cPanel) hosting cannot run this app.** They only serve static files / PHP. Any SSR React app (Next, Remix, TanStack Start, Nuxt, SvelteKit) needs a Node runtime. If you want to host on those, you need their "Node.js hosting" / "Cloud Hosting" / "VPS" tiers — not the basic shared plans.
- What I *can* guarantee: the build output will run on **any host that gives you a Node process** (Vercel, Hostinger VPS/Node, GoDaddy VPS, Render, Railway, Fly, your own server).

## Changes I'll make

### 1. Switch SSR target from Cloudflare Workers → Node
- Configure Nitro preset via `vite.config.ts` to build a portable Node server (`node-server`) by default, with Vercel auto-detected when deploying there (Nitro handles this natively — same codebase, different output per host, zero lock-in).
- Remove the Cloudflare Worker entry wrapper (`src/server.ts`) and the `server.ts` Nitro entry override — those are Workers-specific.
- Keep `src/lib/error-capture.ts` / `error-page.ts` only if they remain useful for Node; otherwise remove.

### 2. Add `npm run start` and a real production server script
- After `npm run build`, output goes to `.output/server/index.mjs` (Nitro convention).
- `npm run start` → `node .output/server/index.mjs`.
- Works identically on Vercel, VPS, Hostinger Node, Docker, etc.

### 3. Vercel deployment files
- Add a minimal `vercel.json` only if needed (usually Nitro's Vercel preset needs nothing). Vercel auto-detects Vite + Nitro.
- No `@vercel/*` packages, no Vercel Edge functions, no `next.config` — keep it framework-neutral.

### 4. Portability audit
- Confirm no imports from `cloudflare:*`, `@cloudflare/*`, `wrangler`, or `@vercel/*`.
- Confirm no usage of Workers-only APIs (KV, Durable Objects, R2 bindings) — there are none.
- Confirm all `process.env` reads happen inside server function handlers (already the pattern).
- Lovable asset URLs (`/__l5e/assets-v1/...`) — verify these resolve when self-hosted. If they don't, swap to bundled imports.

### 5. Build & route verification
- Run production build, fix any TS/ESLint errors that surface.
- Verify every route renders: `/`, `/about`, `/contact`, `/domestic`, `/international`, `/destinations/$slug` (all 9 slugs), `/blog`, `/blog/$slug`, `/terms`, `/privacy`.
- Check SSR head metadata (titles, OG tags) is emitted in the rendered HTML.

### 6. SEO basics
- Add `public/robots.txt`.
- Add a dynamic `src/routes/sitemap[.]xml.ts` listing all static + destination + blog routes.

## What I will NOT change
- Animations (Lenis, Framer Motion, GSAP) — already portable, pure JS.
- Components, content, design system, routes — untouched.
- TanStack Start framework — staying on it; just retargeting the server output.

## Deployment instructions you'll get at the end

**Vercel:** push to GitHub → import repo → deploy. No config needed.

**Hostinger Node / VPS / GoDaddy VPS / any Node host:**
```bash
npm install
npm run build
npm run start   # serves on PORT env var, default 3000
```
Put it behind nginx/Apache reverse proxy, use PM2 or systemd to keep it alive. Standard Node app deployment — no framework-specific tooling.

**Shared cPanel hosting (basic GoDaddy/Hostinger plans):** not supported by any SSR React framework. If that's a hard requirement, the only path is converting to a static SPA, which we'd discuss separately.

## Risk

The biggest unknown is whether the Lovable preview environment continues to work after switching off the Cloudflare Worker preset, since the in-editor preview is built around that runtime. I'll verify after the switch and revert/adjust if the live preview breaks.
