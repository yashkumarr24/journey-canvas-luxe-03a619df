# iOS PayU Phase 1 — review only

Baseline: `61d4c22`, development branch `ios-payu-handoff`. No deployment, configuration activation, database execution, provider requests or real payments are authorized.

## Additions
- Backend config: `PAYU_HANDOFF_ENABLED` defaults false. New service refuses production app environments, production PayU and either canonical live frontend domain even if enabled.
- Frontend: `VITE_IOS_PAYU_HANDOFF_ENABLED` defaults false; only native iOS takes the new path. When off, iOS refuses before order creation instead of using the broken Safari handoff. Web and Android retain their existing path; `src/lib/payu.ts` is untouched.
- `POST /api/v1/payments/handoff`: existing owner/guest authorization, existing order creation/signing, then a 120-second capability bound to the existing payment. Any prior payment attempt blocks a new iOS handoff (including failed/pending). No automatic retry or token replacement.
- `GET /api/public/payu-handoff`: plain HTML, no React/analytics. Capability is in the URL fragment only, removed with `history.replaceState` before a real form POST.
- `POST /api/public/payu-handoff`: narrowly forwards the token body to the configured backend's new redeem endpoint. No cookies/guest pass/merchant secrets in this exchange. HTML security headers preserved; errors become generic unavailable text.
- `POST /api/v1/payments/handoff/redeem`: atomic single-use consume, fresh payment/booking checks, then HTML auto-post of existing signed field contract to PayU **test** only. Never invokes order creation, capture, verification, refunds or fulfilment.
- Native Browser dismissal and cold start open Hotel Confirmation by reference only. Reference is retained up to 48 hours; no payment state, signed fields, guest information or handoff token is persisted. Phase 1.1 removes foreground/resume redirects, clears recovery only for authoritative terminal backend states, and bounds iOS status reads with progressively slower checks plus a manual status-only refresh.

## Phase 1.1 frontend corrections
- `src/lib/native/ios-payu.ts` accepts only `FNFH[0-9A-F]{6}` and `FF-[0-9A-Z]{8}` through one shared validator. The issued handoff response must echo the exact intended reference before its URL is opened; a different valid reference is refused and never stored.
- `src/lib/native/native-shell.ts` listens only for Browser dismissal and performs one cold-start recovery. It has no app foreground/resume listener. Dismissal is never interpreted as payment success.
- `src/routes/hotels.confirmation.tsx` clears the saved reference only for backend `confirmed`, `payment_failed`, `failed`, `cancelled`, `expired` or `on_hold`. It retains recovery for unpaid, processing, cancellation-pending, missing, network-error and unauthorized states.
- Native iOS checks existing booking status after 5, 10, 20, 40 and 60 seconds, then stops. A Check status again button performs only another existing booking read. It does not call order creation, issue a handoff or enable a payment attempt. Website polling and website checkout remain unchanged.
- `payment_processing`, `booking_processing` and `confirming` remain nonterminal even if payment was captured; only `confirmed` produces confirmed-hotel wording.

## Replacement handoff token — DESIGN ONLY, NOT IMPLEMENTED
A later, separately approved backend change could recover the **same unpaid payment** without creating another charge or Hotel booking:

1. Authenticate the same owner/guest and resolve the existing payment by its server-side booking linkage and original idempotency identity. Never accept an amount, txnid, signed field or provider handle from the browser.
2. In one database transaction, lock the existing payment and linked Hotel booking in a consistent order. Require the same unpaid payment/booking, a reusable `created` payment state, no verified capture, no fulfilment/outbox job and no provider booking. Reconcile PayU first; captured, uncertain or conflicting evidence refuses replacement and enters the existing reconciliation path.
3. Reuse the existing payment UUID, txnid, amount, currency and signed-field builder. Never call order creation, Book, Hold or Confirm. Issue a fresh random 120-second capability bound to that payment; old digests remain invalid and consumed tokens are never revived.
4. Replace the payment's handoff record atomically (or insert its missing initial record when the original issue response was lost), incrementing a server-side generation. Allow at most three replacements, with a minimum interval and only when the prior capability is expired/consumed or absent. The transaction must refuse concurrent replacements so only one new capability is returned.
5. Return only the existing booking reference and new handoff URL. Recovery remains manual and status-only on the frontend until this design is separately reviewed; polling exhaustion or local expiry must never trigger replacement automatically.

This requires a reviewed replacement for quarantined 0035 and real isolated-database concurrency/permission tests. The current SQL's `payment_id UNIQUE` and service refusal still permit only one attempt; no backend code or SQL was changed in Phase 1.1.

## Migration proposal — NOT APPLIED
`backend/db/candidates/ios-payu/0035_payu_handoffs.PROPOSAL.sql` is outside migration runner inputs. Table contains SHA-256 token digest, payment UUID, creation/expiry/consumption timestamps only. Unique payment UUID prevents replacement capabilities. Service-role-only grants/RLS, lifetime trigger and atomic consume function are proposed.

The SQL references the **repository** payment/Hotel schema, including `payments.hotel_booking_id`. It is not evidence of the VPS schema. No SQL was executed, so real database locks, concurrency and privileges are not yet validated. Never apply this proposal to the patched production release without reconciliation and separate approval.

## Files
New: backend service/repository/router `payu_handoff.py`; proposal SQL; backend `test_payu_handoff.py`; frontend `src/lib/native/ios-payu.ts` and its tests; `src/lib/payu-form.test.ts`; raw HTML route `src/routes/api/public/payu-handoff.ts`; this report.

Modified: backend config and API router aggregation; frontend booking API, native shell, Hotel Checkout and iOS-only Hotel Confirmation polling; generated route tree (automatic); `AGENTS.md`, `roadmap.md`.

Existing payment service, payment router, PayU client, worker, capture/verification/refund/reconciliation and TripJack code are unchanged. No navigation allowlists, dependencies, Android configuration, environment files or live settings changed.

## Validation
- Final results: **104 backend tests passed, 37 frontend tests passed, zero final failures**; preview build OK. An initial HTTP test failed because its test dependency override exposed a keyword parameter to FastAPI; corrected the override and reran successfully. Python emitted dependency deprecation warnings only.
- Offline backend tests use temporary dependencies, an empty process environment and fake repositories/PayU clients. New tests block outbound HTTP. Coverage: default-off and production refusal, ownership, digest-only persistence, expiry/replay, prior-attempt refusal, unavailable storage, redemption HTTP form, changed booking/payment rejection and signed-field equality with existing website builder.
- Frontend tests cover default-off platform selection, reference-only recovery/expiry, exact website form POST, failed handoff/browser refusal without retry, and existing guest/confirmation regressions.
- Local browser check: valid mock fragment produced exactly one intercepted POST, fragment removed from address, mocked response displayed; missing fragment made no POST, unavailable text readable at 390px. All external requests blocked. This is not an iPhone or live payment test.

### Phase 1.1 validation
- **122 frontend tests passed, zero failures**, using `VITE_BOOKING_API_URL=https://booking.example.test` and mocked responses only. TypeScript project check passed. An initial run without that existing required public test setting produced 11 unrelated API-configuration failures; rerunning with the suite's fake host passed all 122.
- Coverage includes both reference formats, malformed/mismatched references, Safari dismissal before payment, repeated app resumes, force-close/relaunch, terminal and unresolved statuses, captured payment with pending fulfilment, bounded delays, network failure/timeout, and unchanged exact website PayU form posting.
- No backend tests were run because no backend file changed. No SQL, switches, deployment, payment endpoint, provider endpoint or production settings were used.

## Remaining safeguards and staging prerequisites
1. Reconcile manually patched `hotel-main-ec3a1e8` files and actual schema before preparing any VPS patch. Do not replace production files from GitHub wholesale.
2. Independently verify an isolated backend and database, nonproduction public site and PayU test merchant/return URLs. Configuration labels alone cannot prove isolation. No Vercel Preview payment testing until this verification.
3. Separately review/approve and test the proposal on that isolated database: concurrent consume, payment/booking lock interaction, expiry while waiting on locks, service-role permissions and no anonymous reads.
4. Confirm ingress/proxy/APM never log bodies, full fragment-bearing client URLs or returned HTML. Raw capability is short-lived but bearer-authorizing. No app analytics are mounted on the raw handoff route.
5. Existing website retry/late-capture duplicate-charge gap is deliberately unchanged. iOS refuses all prior attempts, but simultaneous website activity and provider resubmission still need independent review. Single-use handoff cannot guarantee PayU never charges a repeated txnid.
6. Failed/lost issue or redeem responses can leave an unpaid attempt and block another iOS handoff; recovery checks status only. Staff reconciliation/lookup may be necessary. A burned token is never revived.
7. Phase 1.1 clears recovery after authoritative terminal status and no longer redirects on resume. Shared-device booking access risks from Step 1 remain unchanged; expired or inaccessible recovery still requires booking lookup.
8. Device-test on Capacitor 7.6.9 with installed Browser plugin: dismissal, background/foreground, force-close, lost response, expired/replayed token, bank flow, verified capture and terminal polling. Universal Links/iOS signing remain separate setup. Android and website regression testing required before any later release.

No switches have been activated. This candidate is ready for code review, not production deployment or live payment testing.