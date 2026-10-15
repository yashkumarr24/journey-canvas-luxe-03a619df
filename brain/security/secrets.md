# Secrets inventory and handling (commit c26dd1a, 2026-10-15)

No secret value was printed or copied while preparing this file.

## Expected locations
| Secret / config | Sensitivity | Where it belongs | Evidence in repo |
|---|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | **Public** (publishable/anon key, protected by RLS) | Vercel build env | `src/lib/supabase/client.ts` |
| `VITE_BOOKING_API_URL` | Public URL | Vercel build env | `src/lib/booking-api.ts` |
| `VITE_BOOKING_TEST_CHECKOUT`, `VITE_HOTEL_TEST_MODE`, `VITE_ASSISTANT_DEMO_MODE`, `VITE_ANALYTICS_TEST_MODE` | Public flags | Should be **unset** on Vercel production | Simulated checkout now only works in local development (`import.meta.env.DEV`) |
| `FNF_SUPABASE_URL`, `FNF_SUPABASE_SERVICE_ROLE_KEY` | **Privileged** | Vercel server-only env (no `VITE_`) | `src/lib/enquiry-store*` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ENQUIRY_NOTIFY_EMAIL` | Key = secret | Vercel server-only env | `src/lib/enquiries.functions.ts` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Service role = privileged | VPS `.env` | `backend/app/core/config.py:50-52` |
| `TRIPJACK_API_KEY` + host URLs | Secret | VPS `.env` | `config.py:62-76` |
| `PAYU_MERCHANT_KEY`, `PAYU_MERCHANT_SALT`, `PAYU_WEBHOOK_SECRET_PATH` | Salt = secret | VPS `.env` only | `config.py:97-110` |
| `RAZORPAY_KEY_ID/SECRET` (legacy) | Secret | Should be removed from VPS | `config.py:91-92` |
| Lovable Cloud keys (preview) | Publishable key in `.env` (auto-generated, not tracked by git) | Lovable | `.env` is not in `git ls-files` |

## Checks performed
- **Client bundle:** only the `VITE_*` names above are referenced (`rg import.meta.env.VITE_`). No service-role or provider key is read through `VITE_`. `VITE_FOO` appears in example code only.
- **Server-only imports:** Vercel server code reads `process.env` inside handlers (project rule). Bearer middleware is null-safe (`src/lib/auth/bearer-middleware.ts`).
- **Source maps:** `vite.config` does not enable `sourcemap`, so the Vite default (none in production) applies. Not verified on the deployed build.
- **Tracked env files:** only `.env.example` and `backend/.env.example` are tracked, and both contain empty values.
- **Git history:** all branches were searched for the patterns `sb_secret_`, service-role JWTs, `re_…` (Resend), `rzp_…`, `PAYU_MERCHANT_SALT=<value>`, `TRIPJACK_API_KEY=<value>`, `RESEND_API_KEY=<value>`, private-key headers and generic JWTs.
  - Result: one match. `sb_secret_` in commit `cd56c97` is a prefix check inside generated `auth-middleware.ts`, not a key.
  - No evidence of exposure, so no rotation is recommended on the basis of history.
- **Logs:**
  - The PayU client never logs hashes or salt (C `integrations/payu/client.py`).
  - The TripJack client logs the operation and status only (C `tripjack/client.py:226`).
  - The worker prints counts only.
  - `enquiries.functions.ts:26` puts up to 200 characters of the Resend error body into a thrown error. That body is not a secret, but it may reach server logs.
- **Test fixtures:** PayU tests use `TESTKEY`/`TESTSALT` placeholders.
- **Certification captures:** TC zips and screenshots live in Lovable Files (`/mnt/documents`). They are not in the repository and not in `public/`, so they are not served by the website.

## Not verified (read-only checks needed from you)
1. **Vercel → Project → Settings → Environment Variables (Production):**
   - Confirm that `FNF_SUPABASE_SERVICE_ROLE_KEY` and `RESEND_API_KEY` have no `VITE_` prefix.
   - Confirm that no `VITE_*_TEST*` flag is set.
2. **On the VPS:**
   - Run `grep -E '^(APP_ENV|PAYMENTS_ENABLED|PAYU_ENV|PAYU_PRODUCTION_APPROVED|PAYMENT_FULFILMENT_ENABLED)=' backend/.env`. These are not secrets.
   - Check `stat -c '%a %U' backend/.env`. Expect `600` and the service user.
3. **On the VPS:** check that journald/nginx logs do not record request bodies. Run `grep -i 'log_format' /etc/nginx/nginx.conf`.
4. **GitHub → Settings → Secrets and Security:** check whether secret scanning or push protection is enabled.

## Recommendations
- Remove the Razorpay variables once PayU passes UAT.
- Use a separate PayU **test** key/salt per environment. Never put the production salt on a staging VPS.
- Rotate any key that was ever pasted into chat or into a ticket (none was observed in this conversation's evidence).
