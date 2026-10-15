# PayU test-mode integration (replacing Razorpay)

Scope: PayU India **Hosted Checkout** (docs.payu.in/reference/_payment_payu_hosted_checkout), **test environment only**. Production payments and production bookings stay disabled. All secrets stay on the FastAPI backend (VPS).

## What exists today
- Frontend: `checkout-api.ts` → `booking-api.ts` calls `/api/v1/payments/order|confirm|failure` (not implemented in backend). `razorpay.ts` opens the Razorpay sheet; `TestPaymentSheet` simulates it. Flight/hotel checkout routes use these.
- Backend: `flight_booking.py` stops at `awaiting_payment`; `hotel_booking.py` refuses instant book / hold confirm in production. `config.py` has RAZORPAY_* fields only.
- Database: `payments` (0005) with `provider_code` enum (`tripjack, razorpay, manual`), `payment_status` enum, `booking_events` audit log; `hotel_bookings` (0018) compare-and-set statuses.

## Flow

```text
Checkout -> POST /payments/order (server builds txnid, amount from DB, SHA-512 hash)
        -> browser auto-posts form to test.payu.in/_payment
        -> PayU POSTs back to surl/furl (backend route, NOT the SPA)
        -> backend: reverse-hash check + verify_payment API (server-to-server)
        -> compare amount/txnid/status with DB -> mark captured (once)
        -> only then book/confirm with TripJack (UAT) -> redirect to /flights|hotels/confirmation
Webhook (PayU dashboard) -> same verification path, idempotent
```

## Backend (FastAPI)
1. `integrations/payu/client.py`: request hash `sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT)`; reverse-hash check `sha512(SALT|status||||||udf5..udf1|email|firstname|productinfo|amount|txnid|key)`; `verify_payment`, `cancel_refund_transaction`, `check_action_status` via `postservice?form=2` with `sha512(key|command|var1|salt)`. Test vs production base URL chosen by config.
2. `services/payments.py`:
   - `create_order(booking_ref)`: loads payable amount from DB (never from browser), creates `payments` row (`created`), unique txnid, returns form fields + hash.
   - `handle_return(form)` (surl/furl) and `handle_webhook(form)`: reverse hash -> verify_payment -> amount/txnid/currency match -> compare-and-set `created|pending -> captured` (or `failed`). Hash alone is never trusted.
   - Post-capture booking: triggers existing flight/hotel booking services; failure after capture -> `booking_events` + refund queue (no auto refund before reconciliation, per production rule).
   - `reconcile()`: scheduled job re-runs verify_payment for `pending`/stale `created` rows and bookings stuck between "paid" and "booked".
   - `refund(payment_id, amount, reason)`: staff-only, requires reconciled state, idempotent token id, tracks status via check_action_status and refund webhook.
3. Routes `api/v1/payments.py`: `POST /order`, `POST /payu/return` (surl+furl), `POST /payu/webhook`, `GET /status/{booking_ref}`, admin `POST /refunds`. Return route redirects (303) to `https://www.flynfeelholiday.com/...confirmation?ref=`.
4. Gates in `config.py`: `PAYMENTS_ENABLED`, `PAYU_ENV=test|production`; startup refuses `production` until UAT sign-off flag set. Existing production booking blocks remain.
5. Tests: hash vectors, tampered hash rejected, amount mismatch rejected, duplicate return/webhook captures once, verify failure leaves `pending`, refund idempotency, production gate.

## Database (new migration 0023, additive)
- Add `payu` to `provider_code` enum.
- `payments`: add `txnid` (unique), `provider_mihpayid` (unique where not null), `verified_at`, `verification_source` (`return|webhook|reconcile`), `raw_status`.
- New `payment_refunds`: payment_id, amount, request_token (unique), provider_request_id, status, reason, created_by, timestamps; service_role only.
- New `payment_webhook_events`: dedupe key (unique), received_at, processed; service_role only, no payload secrets/card data.
- RLS: customers read own payments only (existing); no client writes.

## Frontend
- `src/lib/payu.ts`: builds and auto-submits a hidden form to the URL returned by the backend (no hash computed in browser).
- `checkout-api.ts`/`types/booking.ts`: add `payu` to `PaymentProvider`; `PaymentOrder` gains `action` + `fields`. Confirm step becomes status polling (`GET /payments/status`) on the confirmation page instead of client-sent signatures.
- Flight/hotel checkout routes: swap Razorpay call for PayU redirect; keep TestPaymentSheet for when the backend is unconfigured. Remove `razorpay.ts` after PayU passes UAT.
- Confirmation pages: show "Payment received, confirming booking" / failed / pending states from the server only.

## Environment variables
Backend (VPS, server-only): `PAYU_MERCHANT_KEY`, `PAYU_MERCHANT_SALT`, `PAYU_ENV=test`, `PAYU_RETURN_BASE_URL` (backend public URL for surl/furl), `PAYU_WEBHOOK_SECRET_PATH` (unguessable webhook path segment), `PAYMENTS_ENABLED=false` by default, `PUBLIC_SITE_URL=https://www.flynfeelholiday.com`. Remove `RAZORPAY_*` later.
Vercel: no PayU values. Never `VITE_` for any of these.
PayU dashboard (test): set webhook URL; surl/furl are sent per request.

## Android/iOS return handling
- PayU returns to backend over HTTPS, which redirects to `https://www.flynfeelholiday.com/...confirmation?ref=`.
- In the app shell this URL opens via Universal Links (iOS, `apple-app-site-association`) / App Links (Android, `assetlinks.json`) served from the www domain; checkout opens in the system browser / in-app browser tab, not a WebView form post, so the bank 3-D Secure pages work.
- App reads booking status from the server on resume; never trusts the URL alone. Association files need Xcode/Android Studio signing details later (shell phase).

## Out of scope / stays off
Production PayU keys, production TripJack booking, auto refunds, any change to enquiries/packages/login.

## Needs from you before implementation
PayU test merchant key and salt (added as backend secrets on the VPS), PayU test dashboard access to set the webhook URL.
