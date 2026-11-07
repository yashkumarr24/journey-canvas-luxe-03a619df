# Hotel-to-PayU parent linkage

## Changes
- `backend/app/repositories/hotel_bookings.py`: single `hotel_create_linked_draft` RPC, replacing separate lookup/insert in draft creation.
- `backend/app/services/hotel_booking.py`: retains private `booking_id`; draft creation requires a database result with both Hotel and parent IDs. Errors and missing configuration fail closed; no in-memory fallback.
- `backend/app/services/hotel_search.py`: guest submission stops on draft failure; records guest submission only after durable linkage and returns the canonical reference from the persisted draft on retries.
- `backend/db/migrations/0033_hotel_booking_parent_link.sql`: unapplied, forward-only migration. Adds a nullable unique Hotel-to-bookings FK, extends the parent reference constraint for Hotel references only, and adds a service-role-only transaction function. Creates a `booking_type='hotel'`, `status='pending'` parent with the same reference, owner/hash, Review amount/currency and contact email/phone. Full contact details including dial code remain on the Hotel row. No provider handles or identity documents are copied to customer-visible parent rows.
- `backend/tests/test_hotel_parent_link.py`: mocked RPC, owner/guest, authoritative amount/contact, canonical retry, missing/incomplete/error persistence and guest submission checks.
- `backend/tests/test_hotel_booking.py`: lifecycle fixtures explicitly seed mocked persisted-equivalent drafts rather than relying on production memory fallback.
- `AGENTS.md`, `roadmap.md`, this report: architecture and delivery notes.

## Atomicity and retries
The RPC takes a transaction-scoped lock keyed by the Review token; creates or verifies the bookings parent and creates/links the Hotel row in the same transaction. Any failure rolls the entire RPC back. Repeated requests use the already stored reference and parent, not a freshly generated reference. Owner, guest hash, accepted amount, currency, contact, guests and selected hotel/option mismatches are rejected rather than overwriting an existing draft. Existing unlinked DRAFT rows can be linked on a matching retry; existing unlinked non-DRAFT rows require manual reconciliation. No automatic historical backfill runs.

## Checks
- Hotel linkage, lifecycle and Review mocked suites: **66 passed**.
- Existing PayU isolation/payments and Flight Search/Multi-City/Review mocked suites: **254 passed**.
- Total: **320 passed**. No database connections, migration execution, external APIs, provider calls, environment/key changes or deployment performed.
- Migration transaction behavior, permissions and concurrent execution have **not** been database-tested. Mocked tests verify application contracts, not Postgres atomicity.
- Existing preview diagnostic: build OK. No frontend changes; authenticated live checkout was not exercised.

## Manual migration/deployment steps
1. Reconcile the actual deployed migration/schema state first, especially `bookings.guest_token_hash` from 0023, `bookings_reference_format_chk`, the owner/contact columns, and the Hotel/payment schema. Do not blindly replay older migrations.
2. Reserve 0033 after the separately delivered Flight 0031/0032 candidates; confirm that number is free in the actual VPS migration history. This repository only contains migrations through 0030; it is not an applied ledger.
3. Review/test 0033 on a disposable copy first, including concurrent same-Review calls, parent mismatch rejection, rollback after a Hotel insert failure and denied anon/authenticated RPC access. No such database execution happened in this task.
4. After independent authorization, apply only this forward migration to the intended VPS database using the existing migration process, then deploy the three Python changes. Migration must precede code: absent RPC/link columns intentionally cause guest submission to fail rather than offer payment.
5. Verify signed-in and guest capture read back the linked Hotel and parent IDs, same reference, owner/hash, Review total/currency and contacts. Repeat the same submission and confirm no duplicate parent or Hotel rows.

## Important deployed/repository compatibility difference
The user describes deployed PayU using `payments.booking_id -> bookings`. This repository's payment implementation already uses `hotel_booking_id -> hotel_bookings` for Hotels, and migration 0024 enforces exactly one of the two payment subject links. Creating a parent does not change that existing payment path. Neither payment repository/service nor 0024 capture/refund functions were changed. Do not set both payment FK columns on this repository schema or switch a Hotel payment into the Flight branch. The actual deployed PayU files/schema were not supplied in this request; compatibility with their parent-based lookup remains unverified. Existing Hotel references remain FNFH-prefixed; no new FF Flight references are created.

## Remaining payment-to-TripJack work
The live `UninstalledHotelPort` remains unavailable, so the fulfilment worker still refuses to claim jobs. Separate work is required to connect verified PayU capture to the Hotel lifecycle port, reconcile uncertain provider outcomes before retries/refunds, synchronize parent/Hotel outcome status, and verify durable exactly-once fulfilment and refund withdrawal rules under UAT. Parent linkage alone does not book, hold, charge or confirm a room. All existing payment/provider execution gates and Flight behavior are unchanged.