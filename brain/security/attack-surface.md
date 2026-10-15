# Attack surface (commit c26dd1a, 2026-10-15)

Evidence comes from the code only. Deployed routing (nginx, Vercel) was not inspected.

## FastAPI (VPS), `backend/app/api`
| Endpoint | Method | Auth | Ownership / authorisation | Notes |
|---|---|---|---|---|
| `/health`, `/health/ready` | GET | none | — | No secrets in the response (`api/health.py`) |
| `/api/v1/flights/search` | POST | optional | rate limited (`rate_limit.py`, in-process) | Uses TripJack quota |
| `/api/v1/hotels/*` search, detail, review | POST/GET | optional | rate limited (`hotel_search.py:203,296,381`) | Review GET accepts `?guestToken=` in the URL (`hotels.py:119`) — F-AUTH-03 |
| `/api/v1/hotels/booking` | POST | optional | `owns()` = user id or guest-token hash | Sends `payment_verified=False` (`hotels.py:196`). Instant booking is blocked only when `is_production` — F-PAY-02 |
| `/api/v1/hotels/bookings/{ref}` (+ `/confirm`, `/cancel`) | GET/POST | optional | owner only (`_load_owned`) | Confirm is also behind `_payment_gate` |
| `/api/v1/review/*` (flight review / travellers) | POST/GET | optional | session owner via guest-token hash; extra fields refused | Amount decided on the server |
| `/api/v1/payments/order` | POST | optional | owner (`services/payments.owns`) | `extra="forbid"`, so no amount can be sent. 503 when payments are off |
| `/api/v1/payments/status/{ref}` | GET | optional + `X-Guest-Token` | owner | Returns statuses only |
| `/api/v1/payments/payu/return` | POST (form) | PayU | reverse hash + `verify_payment` | Redirects only to the fixed `PUBLIC_SITE_URL`, so no open redirect |
| `/api/v1/payments/payu/webhook/{path}` | POST (form) | PayU | path compare (noise filter only) + hash + verify | Not documented in the API schema |
| `/api/v1/payments/refunds` | POST | admin ≥2 | booking reconciliation + balance lock | Decimal string amount |
| `/api/v1/operations/bookings*` | GET | user | owner | |
| `/api/v1/operations/bookings/lookup` | POST | none | reference **and** contact email | No rate limit — F-AUTH-02 |
| `/api/v1/operations/support*`, cancellation requests | GET/POST | user | owner | |
| `/api/v1/operations/admin/*` | GET/PATCH/POST | admin | `require_admin(n)` | |
| `/api/v1/admin/*` (analytics, hotel catalogue sync) | GET/POST | admin | `require_admin` | Starting a sync costs TripJack quota |
| `/api/v1/notifications*` | GET/POST | user | owner | |
| `/api/v1/analytics/*` | POST | none | rate limited | Public write; no personal data expected |
| `/api/v1/assistant/*` | POST | optional | rate limited | |
| `/docs`, `/openapi.json` | GET | none | disabled when `is_production` | Depends on `APP_ENV` |

The CORS allow-list rejects `*` at startup and requires an explicit list in production. Credentials are allowed (`core/security.py:26-46`). Localhost origins are added only outside production.

## Vercel (TanStack Start)
- **Server functions:**
  - `enquiries.functions.ts`: public, validated with Zod, honeypot field, service-role insert, Resend.
  - `packages.functions.ts`: public reads.
  - `api/example.functions.ts`: a template greeting that returns `mode: nodeEnv`, which is information disclosure. Recommend removing it.
- **No `src/routes/api/*` server routes exist.**
- **`public/` contains only icons and `robots.txt`**, so no security docs or certification files are served. `brain/` sits outside `public/` and is not bundled.

## Storage and database
- **Package images:** a private `package-images` bucket with signed URLs (project rule).
- **Lovable Cloud migrations:** `enquiries` allows public insert only and no select (summary of the earlier audit). FNF RLS is **not verified**.
- **VPS migrations:** payment tables, refunds, webhooks and jobs are service-role only (0023/0024 grant nothing to anon or authenticated).

## Specific checks
- **Cross-user access:** every booking and payment route checks the owner. The exception is the guest lookup (reference + email).
- **XSS:** React escaping. A search for `dangerouslySetInnerHTML` was not repeated in this pass, so it is not verified.
- **SSRF:** outbound hosts come from settings, never from requests. The PayU form action is pinned to two hosts in the browser (`src/lib/payu.ts`).
- **Injection:** Supabase REST filters are built from validated values. Booking references are checked against `^(FF-…|FNFH…)$` on the payments endpoints.
- **CSRF:** the API uses bearer tokens, not cookies, so CSRF is low risk. The PayU return accepts a cross-site POST by design and is protected by the hash and server verify.
- **OAuth redirects:** Supabase `redirectTo` uses the site origin. FNF allowed redirect URLs are **not verified**.
- **UAT tools:**
  - `backend/app/diagnostics/*` are command-line only. Real booking requires explicit `--execute-uat-book --confirm` flags (earlier work).
  - None is mounted as an HTTP route; `rg @router` found none.
