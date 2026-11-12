# iOS PayU Phase 1 — review only

Baseline: `61d4c22`, development branch `ios-payu-handoff`. No deployment, configuration activation, database execution, provider requests or real payments are authorized.

## Additions
- Backend config: `PAYU_HANDOFF_ENABLED` defaults false. New service refuses production app environments, production PayU and either canonical live frontend domain even if enabled.
- Frontend: `VITE_IOS_PAYU_HANDOFF_ENABLED` defaults false; only native iOS takes the new path. When off, iOS refuses before order creation instead of using the broken Safari handoff. Web and Android retain their existing path; `src/lib/payu.ts` is untouched.
- `POST /api/v1/payments/handoff`: existing owner/guest authorization, existing order creation/signing, then a 120-second capability bound to the existing payment. Any prior payment attempt blocks a new iOS handoff (including failed/pending). No automatic retry or token replacement.
- `GET /api/public/payu-handoff`: plain HTML, no React/analytics. Capability is in the URL fragment only, removed with `history.replaceState` before a real form POST.
- `POST /api/public/payu-handoff`: narrowly forwards the token body to the configured backend's new redeem endpoint. No cookies/guest pass/merchant secrets in this exchange. HTML security headers preserved; errors become generic unavailable text.
- `POST /api/v1/payments/handoff/redeem`: atomic single-use consume, fresh payment/booking checks, then HTML auto-post of existing signed field contract to PayU **test** only. Never invokes order creation, capture, verification, refunds or fulfilment.
- Native Browser dismissal, app resume and cold start open Hotel Confirmation by reference only. Reference is retained up to 48 hours; no payment state, signed fields, guest information or handoff token is persisted. Pending iOS confirmation polls existing backend reads; terminal states retain existing stop behavior.

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

## Remaining safeguards and staging prerequisites
1. Reconcile manually patched `hotel-main-ec3a1e8` files and actual schema before preparing any VPS patch. Do not replace production files from GitHub wholesale.
2. Independently verify an isolated backend and database, nonproduction public site and PayU test merchant/return URLs. Configuration labels alone cannot prove isolation. No Vercel Preview payment testing until this verification.
3. Separately review/approve and test the proposal on that isolated database: concurrent consume, payment/booking lock interaction, expiry while waiting on locks, service-role permissions and no anonymous reads.
4. Confirm ingress/proxy/APM never log bodies, full fragment-bearing client URLs or returned HTML. Raw capability is short-lived but bearer-authorizing. No app analytics are mounted on the raw handoff route.
5. Existing website retry/late-capture duplicate-charge gap is deliberately unchanged. iOS refuses all prior attempts, but simultaneous website activity and provider resubmission still need independent review. Single-use handoff cannot guarantee PayU never charges a repeated txnid.
6. Failed/lost issue or redeem responses can leave an unpaid attempt and block another iOS handoff; recovery checks status only. Staff reconciliation/lookup may be necessary. A burned token is never revived.
7. Recovery reference persists after terminal status until expiry, so later app reopen may return to the same status page. Shared-device booking access risks from Step 1 remain unchanged.
8. Device-test on Capacitor 7.6.9 with installed Browser plugin: dismissal, background/foreground, force-close, lost response, expired/replayed token, bank flow, verified capture and terminal polling. Universal Links/iOS signing remain separate setup. Android and website regression testing required before any later release.

No switches have been activated. This candidate is ready for code review, not production deployment or live payment testing.