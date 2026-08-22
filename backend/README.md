# Fly n Feel Holidays — Booking Backend (FastAPI)

Phase 2: foundation only. No TripJack, Razorpay or Supabase integration yet.

## Why a separate backend

TripJack requires **IP whitelisting**. Vercel and Cloudflare egress IPs are not
static, so provider calls can never come from React, SSR, `createServerFn` or a
route loader. This service runs on a VPS with a static public IPv4 and is the
only component allowed to hold provider credentials.

```
React (Vercel)  ──HTTPS──▶  FastAPI (VPS, static IP)  ──▶  TripJack / Supabase / Razorpay
```

## Requirements

- Python **3.11+** (3.11 or 3.12 recommended)

## Run locally

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

- Liveness: http://localhost:8000/health → `{"status":"ok"}`
- Readiness: http://localhost:8000/health/ready
- Docs (non-production only): http://localhost:8000/docs

Tests: `pytest` from the `backend/` directory.

## Structure

```
backend/
  app/
    main.py                     app factory, middleware + handler wiring
    api/__init__.py             router aggregation
    api/health.py               /health, /health/ready
    core/config.py              env-driven settings, CORS origin resolution
    core/logging.py             JSON logging + request-ID + redaction
    core/errors.py              AppError types + centralised handlers
    core/security.py            CORS policy, timing-safe compare
    middleware/request_context.py  request ID, access log, security headers
    schemas/                    pydantic models
    services/                   business logic (later)
    integrations/               TripJack / Razorpay / Supabase clients (later)
    repositories/               persistence (later)
    utils/
  tests/
```

## Environment variables

See `.env.example`. All integration keys are declared but intentionally blank
in this phase. Secrets are never hardcoded and never shipped to the frontend.

## CORS

Origins come from `FRONTEND_URL` + `CORS_ALLOWED_ORIGINS` (comma-separated),
plus an optional regex for Lovable/Vercel preview subdomains. Localhost origins
are added automatically outside production. Wildcard `*` is rejected, and the
app refuses to start in production with an empty origin list.

## Error contract

```json
{ "success": false, "code": "INTERNAL_ERROR", "message": "Something went wrong.", "request_id": "..." }
```

Stack traces, env values, credentials and paths stay in server logs only.

## Deployment sketch (later)

nginx (TLS via certbot) → `uvicorn`/`gunicorn` on 127.0.0.1:8000, managed by
systemd. Only the VPS IP is whitelisted with TripJack.
