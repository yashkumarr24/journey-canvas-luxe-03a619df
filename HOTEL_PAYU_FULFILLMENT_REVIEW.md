# Hotel PayU fulfillment — code-only review

## Changes

- `backend/app/services/hotel_payment_fulfilment.py`: new VPS-only `DatabaseHotelPort` validates the job's captured PayU payment using `payments.hotel_booking_id -> hotel_bookings.id`. It rejects a simultaneous parent link, missing verification evidence, mismatched Hotel ID/reference/owner/amount/currency, malformed guest ownership, and refunds. Evidence is read again before entering booking.
- `backend/app/jobs/payments_worker.py`: installs that adapter instead of `UninstalledHotelPort`.
- `backend/app/services/hotel_booking.py`: extracts the existing authorized-record lifecycle into `_book_loaded`; its Review, request builders, payload validation, provider posts, status transitions and response parsing are unchanged. Browser ownership remains on the original entry point. Neither worker nor browser sets `payment_verified=True`.
- `backend/app/services/payment_fulfilment.py`: requires adapter authorization before processing Hotel jobs; evidence failures go to manual review, not automatic refund. Reclaimed/uncertain jobs still in DRAFT go to manual review rather than sending another Book. Non-DRAFT jobs only reconcile details.
- `backend/tests/test_hotel_payment_fulfilment.py`: mocked identity/payment/environment checks and a database-evidence-to-existing-wire-flow timeout regression.
- `backend/tests/test_payu_isolation.py`: updates the assertion for the now-present internal loaded-record seam and supplies explicit absent database configuration in worker isolation fixtures.

No Flight source, payment settlement/checkout source, API routes, TripJack integration/wire source, settings, SQL, migrations or quarantined 0033/0034 changed. No live providers, database connections, secrets or deployment were used.

## Execution gates

The installed adapter permits only non-production, PayU test, enabled payment/fulfillment flags, configured database persistence and the exact approved UAT Hotel HMS/OMS pair. It uses the existing surface-specific classifier and key selection; Flight URL/environment does not participate in this Hotel-only decision. Production Hotel Book/Confirm remain refused by both adapter availability and the unchanged Hotel lifecycle gate. No flags were enabled.

Checkout is unchanged: guest submission still requires `hotel_create_linked_draft` and a durable linked draft; failures stop submission. That unapplied RPC is a separate checkout prerequisite, **not** a requirement for validating an existing direct Hotel payment. This change does not install it or activate candidates.

## Ownership and capture boundary

The current payments schema has no independent owner or booking-reference snapshot columns. The trusted service-written direct FK binds the payment to its Hotel owner/reference. The adapter compares that resolved database subject with the separately loaded lifecycle record, including constant-time guest-hash equality; it never authenticates by email/reference or browser flags. An optional payment `user_id`, if returned, must also match.

Before approval, database protections must ensure the Hotel owner/reference/amount/currency and payment FK cannot change after capture. Two ordinary reads do not provide an atomic immutable capture snapshot; these checks do not prove the original payer after an authorized database rewrite. Missing capture-time identity/immutability guarantees remain a production blocker; no replacement SQL is included here.

## Database/runtime prerequisites — not applied or remotely verified

1. Existing `payments.hotel_booking_id` FK to the Hotel primary key, exclusive with `booking_id`; service-owned payment creation, no browser-writable capture/link fields.
2. Hotel lifecycle tables/events, unique booking references and persisted atomic compare-and-set transitions, with private ownership/guest hashes and server-authoritative totals.
3. PayU provider/transaction/verification fields: `provider`, `status`, `txnid`, `provider_mihpayid`, `provider_payment_id`, `verified_at`, `verification_source`, `raw_status`, `amount`, `currency`, `amount_refunded`. Capture requires existing reverse-hash plus server verification, atomically recorded with one job.
4. Durable job table and `payu_capture`, `payu_claim_jobs`, job update permissions; claim locking/attempt increments and uniqueness per payment must match the existing contract. These objects cannot be established by branch files alone.
5. Never permit owner/reference/payable changes after capture. Reconcile current service-role writes and refund/claim concurrency before production approval.
6. Separately review/install checkout's `hotel_create_linked_draft`; 0033/0034 remain untouched and unapplied. Existing Flight migrations must not be replayed.
7. Stored guest documents, GST-required bookings and paid hold confirmation need separate review. The adapter uses the existing stored guest fields, supplies no invented GST, and leaves ON_HOLD jobs with staff rather than auto-confirming.

## Verification performed

367 focused tests passed: new mocked Hotel adapter checks, PayU/payment isolation, Hotel lifecycle/host/parent-link regressions and all `test_flight*.py` suites. The full backend suite then passed 936 tests. This includes one captured-payment-to-existing-Hotel-payload flow with a mocked timeout and no second Book call. Dependency deprecation warnings only. No hosted payment/provider end-to-end or certification was performed.

Code patch assembled against the saved starting source and verified with a strict local zero-fuzz dry run. Certified integration files, Flight files and all database files remain outside the patch.

## Workspace scope

Changes were made only in this connected workspace, using its internal Lovable edit ref; no main checkout, branch switch, merge or deployment was performed. The sandbox exposes an internal edit ref rather than independently proving the named GitHub destination `hotel-payu-fix-review`; confirm the connected destination before accepting/syncing this code.