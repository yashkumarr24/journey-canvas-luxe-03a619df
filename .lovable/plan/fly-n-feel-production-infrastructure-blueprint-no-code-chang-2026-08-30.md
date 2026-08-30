# Fly n Feel — Production Infrastructure Blueprint (no code changes)

Reference document only. Phase 8 (payments) stays untouched.

## 1. Where every part lives

| Layer | Platform | Notes |
|---|---|---|
| Web frontend | Vercel (`npm run build:vercel`, `vercel.json` already present) | `www.flynfeelholidays.com` |
| Backend API | GoDaddy VPS, static public IP | `api.flynfeelholidays.com` |
| Database + Auth | Supabase (one project per environment) | Postgres + RLS + Supabase Auth |
| Providers | TripJack, Razorpay, OpenAI | reached **only** from the VPS |
| Mobile apps | Capacitor wrapper of the same web app | same API + same Supabase |

## 2. Architecture diagram

```text
        Browser                     Android / iOS (Capacitor)
           |                                   |
           v                                   |
   Vercel (SSR frontend)                       |
           |                                   |
           |  HTTPS  (VITE_BOOKING_API_URL)    |
           +---------------+-------------------+
                           v
        api.flynfeelholidays.com  (DNS A -> VPS static IP)
                           |
                    Nginx (TLS, rate limit, proxy)
                           |
                 Uvicorn/Gunicorn -> FastAPI  [systemd]
                  |          |          |         |
                  v          v          v         v
             TripJack    Supabase   Razorpay   OpenAI
           (IP allowlist) (service   (webhook   (server
                           role key)  verified)  key)

   Supabase Auth is called directly by web/mobile (anon key) ->
   returns JWT -> sent as Bearer to FastAPI -> FastAPI verifies it.
```

## 3. Request flow (booking example)

1. User searches a flight in the browser/app.
2. Request goes to `booking-api.ts` → `POST https://api.flynfeelholidays.com/api/v1/flights/search`, with the Supabase JWT if signed in.
3. Nginx terminates TLS and proxies to FastAPI on `127.0.0.1:8000`.
4. FastAPI validates input, verifies the JWT, rate-limits, then calls TripJack from the VPS's static IP (the whitelisted one).
5. FastAPI normalizes results, stores the search + authoritative fare refs in Supabase via the service-role key.
6. Only normalized data + opaque tokens return to the client — never provider prices the client can tamper with.
7. Payment (Phase 8): FastAPI creates the Razorpay order, the client pays, Razorpay calls a signed webhook on FastAPI, FastAPI verifies the signature and only then issues the ticket with TripJack.

## 4. How FastAPI connects to Supabase securely

- Backend uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` over PostgREST (`app/repositories/supabase_rest.py`). Bypasses RLS by design; ownership is enforced in the service layer from the verified JWT.
- The service-role key exists only in the VPS `.env` (mode 600, owned by the app user). Never in Vercel, never in a `VITE_` variable, never in the repo.
- Frontend/mobile use only the anon/publishable key, and RLS restricts them to read-own rows.
- `SUPABASE_DB_URL` (direct Postgres) is used only to apply migrations, never at runtime.

## 5. TripJack and the static IP

TripJack allowlists exactly one egress IP per environment. Vercel and serverless platforms rotate IPs, so they can never be whitelisted. The VPS has one fixed public IP → give TripJack that IP for UAT and (later) the production IP. Every TripJack call leaves from there. If we ever add a second app server, both IPs must be registered, or all provider traffic must egress through one NAT IP.

## 6. Backend deployment on the GoDaddy VPS

```text
/opt/flynfeel/
  app/                 <- git clone of the backend/ folder
  venv/                <- python -m venv
  .env                 <- 600, secrets only here
  logs/
/etc/systemd/system/flynfeel-api.service
/etc/nginx/sites-available/api.flynfeelholidays.com
```

- Run: `gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 2 -b 127.0.0.1:8000`, supervised by systemd (`Restart=always`).
- FastAPI binds to localhost only; the firewall (ufw) opens 22/80/443 exclusively.
- Nginx: TLS via Let's Encrypt/certbot (auto-renew), HSTS, gzip, proxy headers, request-size limits, basic rate limiting.
- Set `TRUST_PROXY_HEADERS=true` (valid because Nginx is the only front door) and `CORS_ALLOWED_ORIGINS` to the exact Vercel/production origins.
- Deploy = `git pull && pip install -r requirements.txt && systemctl restart flynfeel-api`, later scripted or GitHub Actions over SSH.
- Mobile apps need CORS-free origin handling: Capacitor sends `capacitor://localhost` / `https://localhost` — add those origins explicitly.

## 7. Domain and DNS

At the DNS provider for `flynfeelholidays.com`:

| Record | Name | Value |
|---|---|---|
| A / CNAME | `@` and `www` | Vercel target (per Vercel's domain screen) |
| A | `api` | VPS static IP |
| A | `api-uat` | VPS static IP (or a second box) |

Frontend env: `VITE_BOOKING_API_URL=https://api.flynfeelholidays.com` in Vercel production, `https://api-uat...` in Vercel preview.

## 8. UAT vs Production separation

| Item | UAT | Production |
|---|---|---|
| Supabase | separate project | separate project |
| TripJack | `apitest.tripjack.com` + UAT key | prod host + prod key |
| Razorpay | test keys | live keys |
| API host | `api-uat.` (separate systemd unit + `.env`, port 8001) | `api.` (port 8000) |
| Frontend | Vercel preview env | Vercel production env |

Rules: migrations flow dev → UAT → prod, never edit tables by hand; production credentials never exist on a laptop; `APP_ENV=production` disables `/docs` and dev CORS.

## 9. GoDaddy VPS sizing

- **Now (UAT + early production):** 2 vCPU / 4 GB RAM / 80 GB SSD, Ubuntu LTS. FastAPI is I/O-bound (waiting on TripJack), so RAM and network matter more than CPU. Comfortably handles a few hundred concurrent searches.
- **Upgrade to 4 vCPU / 8 GB** when: sustained CPU > 60%, Nginx p95 latency climbs, or you add Redis + background workers on the same box.
- **Split into 2 machines (app + Redis/workers) or add a load balancer** past ~50 bookings/day with heavy search traffic, or when you need zero-downtime deploys.

## 10. What we need now vs later

**Now**
- Nginx + TLS, systemd, ufw, `.env` with 600 perms
- Structured JSON logs with rotation (already in `app/core/logging.py`)
- Supabase automated backups enabled (paid tier for PITR)
- Uptime check on `/health`

**Soon after go-live**
- Redis: search-result caching, distributed rate limiting (current limiter is in-process), idempotency keys
- Sentry for backend + frontend error tracking
- Cloudflare in front of `api.` for WAF, DDoS and bot protection (keep the origin IP allowlisted at TripJack)
- Nightly `pg_dump` to object storage as a second backup line

**Later / at scale**
- Background workers (Celery/RQ or Supabase cron) for ticket-status polling, refunds, email/WhatsApp notifications, debug-log purging
- Second app node + load balancer with a single NAT egress IP for TripJack
- Metrics dashboard (Prometheus + Grafana or a hosted APM)
- Staging clone of the full stack for release rehearsal

## 11. Mobile

Capacitor wraps the same web build; the apps talk to the exact same FastAPI + Supabase. Extra work at that phase: allowlisting Capacitor origins in CORS, deep links for Razorpay return URLs, and FCM/APNs for push. No backend redesign needed.

---
Nothing in this document changes code. Approve it as the shared reference, then we resume Phase 8 (Razorpay + ticket issuance).
