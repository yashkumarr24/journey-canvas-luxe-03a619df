# Fly n Feel Holidays — Deployment Guide

A TanStack Start (React 19 + Vite 7) application configured to deploy **anywhere a Node.js process can run**. No vendor lock-in.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

## Deploy to Vercel

Push the repo to GitHub, then import into Vercel. The included `vercel.json` runs `npm run build:vercel`, which builds with the Nitro `vercel` preset. **No extra config needed.**

## Deploy to a Node.js host (Hostinger Node, VPS, GoDaddy VPS, Render, Railway, Fly, your own server)

```bash
npm install
npm run build:node   # builds .output/server/index.mjs
npm run start        # node .output/server/index.mjs
```

The server listens on `PORT` (default `3000`). Put nginx/Apache in front of it as a reverse proxy and use PM2 or systemd to keep it alive:

```bash
# PM2 example
pm2 start "npm run start" --name flynfeel
pm2 save && pm2 startup
```

## ⚠️ Hosting that will NOT work

- **GoDaddy shared hosting** (cPanel) — PHP/static only, no Node runtime.
- **Hostinger shared hosting** (cPanel) — same limitation.

These tiers cannot run any SSR React framework (Next, Remix, TanStack Start, Nuxt, SvelteKit). You need their "Node.js" / "Cloud" / "VPS" plans.

## Switching hosts later

The codebase is framework-neutral. To target a different host, just rebuild with the matching Nitro preset:

```bash
NITRO_PRESET=node-server   npm run build   # generic Node
NITRO_PRESET=vercel        npm run build   # Vercel
NITRO_PRESET=netlify       npm run build   # Netlify
NITRO_PRESET=cloudflare    npm run build   # Cloudflare Workers
```

No code changes required.

## Project structure

- `src/routes/` — file-based routes (pages + sitemap.xml)
- `src/components/` — UI components
- `src/data/` — destinations & blog content
- `src/assets/` — bundled images
- `public/` — static files (robots.txt)
