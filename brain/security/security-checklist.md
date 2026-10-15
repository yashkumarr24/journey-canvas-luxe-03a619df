# Security checklist (commit c26dd1a, 2026-10-15)

- **Status values:** Pass / Fail / Partial / Not verified / N/A.
- **Evidence:** C = code, T = automated test, D = deployed (none collected).

## Summary table
| Area | Status | Evidence |
|---|---|---|
| Authentication: JWT checked by Supabase `/auth/v1/user` | Pass (C) | `backend/app/core/auth.py:52-89` |
| Which Supabase project the VPS trusts (FNF) | Not verified | Needs the VPS `SUPABASE_URL` host |
| Sessions: revocation | Partial | 60 s token cache (`auth.py:26`) |
| Authorisation: booking/payment ownership | Pass (C,T) | `services/payments.owns`; `test_booking_reference_alone_grants_no_access...` |
| Admin authorisation | Pass (C) | `core/admin_auth.py:113` `require_admin`; refunds need ≥2 |
| Input validation | Pass (C) | Pydantic `extra="forbid"`; Zod on enquiries |
| Rate limiting: search, assistant, analytics | Partial | In-process only (`rate_limit.py` docstring) |
| Rate limiting: guest lookup, enquiries, payments order | Fail (C) | No limiter found |
| CORS | Pass (C) | `core/security.py:26-46` |
| API docs in production | Partial | Hidden only when `APP_ENV=production/prod` |
| Uploads | N/A on the website | Only the importer CLI uploads, to a private bucket |
| DB policies: VPS payment tables | Pass (C) | 0023/0024 service_role only |
| DB policies: FNF production | Not verified | |
| Secrets in bundle or history | Pass (C) | See `secrets.md` |
| Encryption in transit | Not verified | nginx TLS described in `backend/README.md:79` |
| Dependencies | Partial | See below |
| Logging and redaction | Partial | Payment/TripJack logs redact. Resend error body is thrown (`enquiries.functions.ts:26`) |
| Admin security (MFA, audit) | Not verified | No MFA enforcement in code |
| Privacy: PAN/passport scrubbed after booking | Pass (C) | `hotel_booking._scrubbed_guests` |
| Backup and recovery | Not verified | No backup config in repo |
| Deployment parity | Not verified | No evidence that the VPS runs this commit or that 0023/0024 are applied |

## Payment and booking flows
| Control | Status | Evidence |
|---|---|---|
| Amount set by the server | Pass (C,T) | `create_order` reads the booking amount; `extra="forbid"`; `test_order_amount_comes_from_booking...` |
| Booking ownership on order and status | Pass (C,T) | `owns()`; API `status` route |
| PayU request/response hash per docs, including additionalCharges | Pass (C,T) | `integrations/payu/client.py`; 4 hash tests |
| Server `verify_payment` before capture | Pass (C,T) | `settle()` |
| Webhook authentication beyond the URL path | Pass (C) | settle checks hash + verify |
| Atomic capture + job enqueue | Pass (C), Not verified (D) | 0024 `payu_capture`; fakes only in tests |
| Duplicate order prevention | Pass (C,T) | unique open-payment indexes; `test_concurrent_order_returns_the_winning_attempt` |
| No downgrade of a captured payment | Pass (C,T) | `test_delayed_failure_never_downgrades_capture` |
| Durable processing across crashes | Partial | Jobs table + lock expiry (0024). Worker runs only if a systemd timer is installed — Not verified |
| Never rebook after a timeout | Pass (C,T) | `test_hotel_timeout_is_never_rebooked`, `test_crashed_worker_after_send_only_reconciles` |
| Reconcile before refund | Pass (C,T) | `refund_eligibility`; `test_refund_refused_until_booking_reconciled` |
| Cumulative refund limit | Pass (C,T) | `payu_reserve_refund` row lock; `test_partial_refunds_cannot_exceed_capture` |
| Unclear refunds not re-sent | Pass (C,T) | `test_ambiguous_refund_is_not_resent...` |
| Test/UAT vs production isolation | Partial | `fulfilment_allowed`; substring host check (F-PAY-04); depends on `APP_ENV` |
| Simulated payment cannot book | Pass (C,T) | Simulation only when `import.meta.env.DEV`; fulfilment only via `payu_capture`; `src/lib/payment-handoff.test.ts` |
| Flight fulfilment after payment | Fail (missing) | Flight jobs → `manual_review` (`payment_fulfilment.py`) |
| Live PayU UAT | Not verified | No real transaction run |

## Findings

**F-PAY-02: Hotel booking without payment outside "production"**
- **Classification:** Potential risk requiring verification
- **Severity:** High · **Confidence:** High (code)
- **Evidence:** `backend/app/services/hotel_booking.py:353-357` refuses only when `settings.is_production`. `is_production` is true only when `APP_ENV ∈ {production, prod}` (`core/config.py:143-145`). `/hotels/booking` always sends `payment_verified=False` (`api/v1/hotels.py:196`).
- **Exploit condition:** the VPS that serves www has `APP_ENV` unset or set to something like `live`. Any guest could then instant-book a hotel and debit the TripJack wallet.
- **Mitigation:** the default `APP_ENV` value (unverified).
- **Fix:** fail closed. Allow unpaid booking only when an explicit `TRIPJACK_UAT_BOOKING_ALLOWED=true` is set and the hosts are UAT.
- **Verify:** `grep ^APP_ENV= backend/.env` on the VPS.

**F-PAY-01: No live PayU UAT evidence**
- **Classification:** Missing control (verification)
- **Severity:** High (launch blocker) · **Confidence:** High
- **Evidence:** all payment tests use fakes (`backend/tests/test_payu_payments.py`).
- **Impact:** the real PayU field formats (`verify_payment` amount, `check_action_status` shape, webhook fields) are unconfirmed.
- **Fix and verify:** run the staging plan in `scalability-readiness.md` §7 with PayU test credentials.

**F-OPS-01: Migrations 0023/0024 and the worker timer not confirmed deployed**
- **Classification:** Potential risk
- **Severity:** High · **Confidence:** Medium
- **Impact:** if the code is deployed without 0023, guest flight drafts fail (they now write `guest_token_hash`). Without 0024, capture fails.
- **Verify:** on the VPS database, `select to_regclass('public.payment_fulfilment_jobs')` and `\df public.payu_*`. Also `systemctl list-timers | grep payments`.

**F-AUTH-02: Guest booking lookup has no rate limit**
- **Classification:** Missing control
- **Severity:** Medium · **Confidence:** High
- **Evidence:** `api/v1/operations.py:230-240`; no limiter.
- **Exploit:** enumerate references against a known email, or the reverse. References have about 8 base-36 characters.
- **Fix:** per-IP and per-email limiter plus a constant-time "not found" response.
- **Verify:** unit test with the limiter.

**F-ABUSE-01: Enquiry form has no rate limit or CAPTCHA**
- **Classification:** Missing control
- **Severity:** Medium · **Confidence:** High
- **Evidence:** `src/lib/enquiries.functions.ts` (honeypot only).
- **Impact:** inbox flooding, Resend quota exhaustion and sender reputation damage.
- **Fix:** IP-hash limiter in the database, or Turnstile.

**F-AUTH-03: Guest token accepted in the query string**
- **Classification:** Security weakness
- **Severity:** Medium · **Confidence:** High
- **Evidence:** `api/v1/hotels.py:119-126`.
- **Impact:** tokens end up in nginx logs, browser history and Referer headers.
- **Fix:** accept the header only.

**F-PAY-04: UAT host detection is a substring match**
- **Classification:** Security weakness
- **Severity:** Low · **Confidence:** High
- **Evidence:** `services/payments._is_uat_host` (`"apitest" in url`).
- **Fix:** exact allow-list of UAT hostnames.

**F-PAY-05: A single admin can refund**
- **Classification:** Recommendation
- **Severity:** Low
- **Fix:** require two-person approval above a threshold, and alerting.

**F-PAY-06: Flight payment has no TripJack fulfilment**
- **Classification:** Missing control
- **Severity:** Medium (business) · **Confidence:** High
- **Evidence:** `payment_fulfilment.run_once` sends flights to `manual_review`.
- **Impact:** customers are charged and staff must book by hand. Do not enable flight payments before this exists.

**F-DEP-01: Build-time dependency advisories**
- **Classification:** Potential risk
- **Severity:** Low (build-time) · **Confidence:** Medium
- **Evidence:** the Lovable dependency scanner on `bun.lock` reported:
  - `@tailwindcss/vite` 4.2.4 → source-map-js < 1.2.2 (DoS)
  - `@tanstack/react-start` 1.168.60 and `@tanstack/router-plugin` 1.168.42 → browserslist ≤ 4.28.6, js-yaml < 4.3.2, baseline-browser-mapping < 2.11.0
- **Applicability:** all are build-tool parsers that do not handle untrusted runtime input, so they are not exploitable by visitors.
- **Fix:** upgrade in a later change.
- **Backend:** `requirements.txt` (fastapi 0.115.6, uvicorn 0.34.0, httpx 0.28.1, pydantic 2.10.5) was not checked against advisories. Run `pip-audit -r backend/requirements.txt`.

**F-INFO-01: Example server function exposes `nodeEnv`**
- **Classification:** Recommendation
- **Severity:** Low
- **Evidence:** `src/lib/api/example.functions.ts`.
- **Fix:** remove it.
