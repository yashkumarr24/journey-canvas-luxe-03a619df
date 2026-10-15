# Fly n Feel threat model

- **Audit date:** 2026-10-15 (UTC)
- **Git commit:** `c26dd1a` ("Fixed PayU type error"). The full history (1,152 commits) is available; the clone is not shallow.
- **Method:** read-only inspection of the repository only. No exploit attempts, no load tests, and no calls to PayU, TripJack, Resend or the production database.
- **What the repository does not prove:** that Vercel, the VPS or the FNF Supabase project run this commit, these migrations or these settings. Only code evidence (C) and test evidence (T) appear below. Nothing deployed was verified, so no deployed-behaviour evidence (D) exists.

## 1. Assets
| Asset | Where it lives | Why it matters |
|---|---|---|
| Customer money (PayU captures, refunds) | PayU; `payments`, `payment_refunds` (VPS migrations 0005, 0023, 0024) | Direct financial loss, double charges or double refunds |
| TripJack wallet balance | TripJack; debited by hotel Book/Confirm (`backend/app/services/hotel_booking.py`) | Bookings that nobody paid for cost real money |
| Traveller personal data: names, contact details, PAN/passport during booking | `bookings`, `hotel_bookings.guests`, booking travellers | Privacy, legal exposure. PAN/passport is scrubbed after booking (`_scrubbed_guests`) |
| Accounts and sessions | FNF Supabase Auth (production); Lovable Cloud Auth (preview) | Account takeover |
| Admin powers (refunds, support, catalogue sync, analytics) | `admin_users` + `backend/app/core/admin_auth.py` | Unauthorised refunds or data access |
| Secrets (service-role key, TripJack key, PayU salt, Resend key) | VPS `.env`, Vercel server variables | Full takeover of data or providers |
| Enquiries | FNF Supabase `enquiries` table, Resend | Spam, abuse of the email sender |
| Certification evidence (TC1/TC7/TC9) | `/mnt/documents` (Lovable Files), not the repository | Contains TripJack IDs and review data |

## 2. Actors
- **Anonymous visitor:** search, enquiry, guest checkout using a server-issued guest token.
- **Signed-in customer:** an FNF Supabase JWT, which the VPS checks by calling `/auth/v1/user`.
- **Admin:** a signed-in user with an active row in `admin_users`. Level comes from the role (`LEVEL_BY_ROLE`).
- **PayU:** browser return (surl/furl) and server-to-server webhook.
- **TripJack:** called outbound only. The VPS IP is whitelisted.
- **Operator:** has VPS shell access and runs the worker and diagnostics CLIs.
- **Attacker:** anonymous, a malicious customer, or someone holding a stolen token.

## 3. Trust boundaries and data flow
```text
Browser ──HTTPS──> Vercel (TanStack SSR + server functions: enquiries, packages)
   │                    └──> FNF Supabase (service role, server-only)  ──> Resend
   │
   └──HTTPS (VITE_BOOKING_API_URL, CORS allow-list)──> nginx ─> FastAPI (VPS)
                                                         ├──> FNF Supabase REST (service role)
                                                         ├──> FNF Supabase Auth /auth/v1/user (token check)
                                                         ├──> TripJack (flights / hotels, IP whitelisted)
                                                         └──> PayU (verify_payment, refunds)
PayU hosted page ──POST surl/furl──> FastAPI /api/v1/payments/payu/return ──303──> www.flynfeelholiday.com
PayU server      ──POST webhook────> FastAPI /api/v1/payments/payu/webhook/{path}
```
- **Browser to VPS:** all amounts and booking state are decided on the server (C: `services/payments.py`, `flight_booking.py` with `extra="forbid"`).
- **FNF vs Lovable Cloud:** the VPS accepts only tokens that its own `SUPABASE_URL` accepts (C: `core/auth.py:52-89`). A Lovable Cloud preview token is rejected by an FNF-configured VPS, so the user is treated as a guest. Which project the VPS actually points to is **not verified**.

## 4. Attack scenarios
| # | Scenario | Likelihood | Impact | Existing controls (evidence) | Remaining gap |
|---|---|---|---|---|---|
| A1 | Forge a PayU success to get a booking without paying | Medium | High | Reverse hash plus server `verify_payment`, same txnid and amount (C `payments.py` settle; T `test_tampered_hash_rejected_without_capture`, `test_amount_mismatch...`) | Never run against real PayU (F-PAY-01) |
| A2 | Replay or concurrent callbacks cause a double capture or double booking | Medium | High | `payu_capture` does compare-and-set capture and inserts one job; unique `payment_id` on jobs (C 0024; T `test_verified_success_captures_once...`) | Migration not confirmed applied on VPS (F-OPS-01) |
| A3 | Pay for, or read, someone else's booking using only its reference | Medium | Medium | `owns()` checks the user id or the guest-token hash (C; T `test_booking_reference_alone_grants_no_access...`) | Guest lookup accepts reference + email with no rate limit (F-AUTH-02) |
| A4 | Hotel instant booking without payment, debiting the TripJack wallet | Medium | High | `_payment_gate` refuses only when `is_production` is true (C `hotel_booking.py:353-357`; `/hotels/booking` passes `payment_verified=False`) | Production safety depends entirely on the VPS `APP_ENV` value (F-PAY-02) |
| A5 | PayU test money creates real TripJack bookings | Low | High | `fulfilment_allowed` requires TripJack UAT hosts in PayU test mode (C; T `test_test_payu_never_books_against_production_tripjack`) | Host check is a substring (`apitest`) match (F-PAY-04) |
| A6 | Unauthorised or excessive refund | Low | High | Admin level 2; refund allowed only after booking reconciliation; balance checked under a row lock; unclear results never re-sent (C 0024 `payu_reserve_refund`; T refund tests) | No two-person approval and no refund cap per admin (F-PAY-05) |
| A7 | Stolen JWT used after logout | Low | Medium | Token checked against Supabase; 60-second cache (C `auth.py:26`) | Revocation takes up to 60 s; accepted |
| A8 | Enquiry spam or using the email sender for abuse | High | Low–Medium | Zod length limits, a hidden honeypot field (C `enquiries.functions.ts:7-15,33`) | No rate limit or CAPTCHA (F-ABUSE-01) |
| A9 | Guest token leaked through URL logs | Medium | Medium | Header is the preferred way to send it | Hotel review also accepts `?guestToken=` (C `hotels.py:119`) (F-AUTH-03) |
| A10 | Debug or UAT tools exposed on production | Low | High | Diagnostics are command-line only (`backend/app/diagnostics/*`), not HTTP routes; `/docs` and `/openapi.json` are off when `is_production` (C `main.py:48-50`) | Depends on `APP_ENV` (F-PAY-02) |
| A11 | Leaked secret in history or the website bundle | Low | High | History scan found no secret values; the only `sb_secret_` match is a prefix check in generated code (commit `cd56c97`) | Vercel/VPS environments not inspected |

## 5. Key remaining gaps (see the checklist for the full finding format)
F-PAY-02 (APP_ENV dependency) and F-PAY-01 (no live PayU UAT) are the payment-launch blockers. Next come F-OPS-01 (migrations not confirmed applied), F-AUTH-02 and F-ABUSE-01.
