# Hotel-to-PayU VPS reconciliation — review-only v3

## Corrected deployment facts
The VPS uses `payments.booking_id -> bookings`, and migrations **0031 and 0032 are applied**, per the current user confirmation. No live database was inspected. The previous report confused branch file inventory with VPS state; its “through 0030” statement and description of Hotel-specific payment IDs are not deployed-state evidence.

Current user confirmation also establishes the intended deployed PayU contract: it checks `bookings.guest_token_hash`, added by VPS migration 0023. Local 0023 source confirms the nullable text column; local PayU `owns()` compares the supplied token's hash against the stored hash with `secrets.compare_digest`. Neither source nor the user confirmation is a fresh deployed catalog result. Live verification cannot be performed while external calls are prohibited; a redacted schema export is still required. The v2 removal of parent hash persistence was incompatible with this guest authorization contract and is superseded below.

The branch contains an alternate 0024 payment design. Do **not** deploy this branch wholesale, replay 0023/0024, rerun 0031/0032, or apply 0033. Do not create `payments.hotel_booking_id` or populate both payment subject columns.

## Compatible capture candidate and changed files
- `backend/db/candidates/0033_hotel_booking_parent_link.sql.candidate`: remains OUT of numbered migration inputs. Copies the existing server-owned Review guest hash into both the Hotel row and its bookings parent; signed-in parents have user_id and null guest hash. Existing-parent reuse requires an exact hash match, including null semantics, in addition to owner/reference/amount/contact matching. Missing or divergent hashes reject the transaction; no silent overwrite or reference/email-only fallback. A catalog preflight requires the nullable, ordinary text `bookings.guest_token_hash` column before DDL; it does not add it or replay 0023. Existing atomic capture, reference-rule guard and other flows are unchanged.
- `AGENTS.md`, `roadmap.md`, this report: corrected VPS facts, quarantine and blockers.
- Existing candidate capture code remains unchanged: `backend/app/repositories/hotel_bookings.py`, `backend/app/services/hotel_booking.py`, `backend/app/services/hotel_search.py`. It uses one RPC and requires both durable IDs before awaiting_payment; persistence failures stop submission. This code must not deploy until the RPC is separately authorized and verified.

This is a **branch-relative correction diff**, not an exact current-VPS patch: supplied Flight archives omit current Hotel/payment files. Parent capture is compatible in direction with the stated VPS linkage, but exact schema compatibility and end-to-end PayU compatibility remain unresolved. No claim of a deployable complete fix is made.

## Exact branch mismatches still quarantined
`backend/app/repositories/payments.py` still implements the branch 0024 dual-subject model:
- `_hotel()` uses the Hotel row ID, not the parent ID.
- `_subject_filter()` and `create_payment()` use `hotel_booking_id` for Hotels.
- `subject_for_payment()` assumes every booking_id is a Flight, rather than checking bookings.booking_type.
- `0024_payu_fulfilment.sql` branches capture/enqueue and withdrawal on direct Hotel payment IDs.

These files are **not changed or included for VPS deployment**. Blindly changing them without the deployed code/function definitions could change capture, refunds and Flight behavior. Parent linkage alone does not repair this branch's payment model.

## Migration plan — no execution authorization
1. Obtain redacted current VPS source for Hotel repository/service/guest submission, payment repository/service/fulfilment port, and the installed capture/claim/refund/withdraw function definitions. Use already authorized metadata exports; no queries are run here. Verify payments.booking_id type, FK, nullability, unique/open-payment indexes, statuses and grants; do not assume absence of other columns from the stated FK alone.
2. Compare bookings/Hotel columns, types, defaults, omitted NOT NULL columns, keys, triggers, policies, ownership and service_role privileges with every RPC read/write. Check exact reference constraint and enum labels hotel/pending; check existing parent link, index and RPC names. Confirm applied 0031/0032 filenames/hashes from supplied deployment records. Do not reconstruct a ledger from file presence.
3. Preserve applied Flight SQL/functions unchanged. Confirm 0033 is free; otherwise allocate the next free number. Keep this candidate outside runner inputs. Do not blanket-run pending branch migrations.
4. Preserve VPS PayU guest authorization through the parent: payments.booking_id uses parent.id, and the existing PayU check verifies the presented token against bookings.guest_token_hash. The capture candidate persists and compares the original server Review hash; never accept a browser-supplied hash or authorize by reference/email. Check the current VPS Hotel lookup/write/read-back and capture/enqueue paths for Hotel parents without misrouting to Flight. Preserve Flight lookup, refund balances and verification gates; branch payment code is not deployed or rewritten here.
5. After separate authorization, test on disposable PostgreSQL: owner/guest creation, concurrent identical Review retries, mismatched evidence, constraint/grant failures and rollback before any partial parent/Hotel survives; exact reference rule acceptance and divergent-rule rejection; failed persistence never returns awaiting_payment. Test Hotel parent-based payment lookup/write/read-back and unchanged Flight behavior with mocks. Prior tests do not validate this revised SQL.
6. Only after review/test approval: finalize a forward migration and rebase the three capture files against actual VPS source. Apply finalized SQL before capture code through the existing approved process. No automatic legacy backfill; inspect historical unlinked DRAFT/payment records separately. Never reverse a release by deleting paid parents or cascading financial records.

## Remaining payment-to-TripJack work
Parent identity does not authorize Book/Confirm or payment calls. Verified PayU capture must later feed durable idempotent Hotel fulfilment; synchronize parent/Hotel outcomes, refuse duplicate provider Book after leaving DRAFT, reconcile uncertain results before retries/refunds, and preserve locked refund balances. The branch's UninstalledHotelPort is not proof of the installed VPS port. VPS fulfilment remains unverified. Existing payment/provider flags stay unchanged; Flight Book stays disabled.

## Checks and scope
Local source inspection only. No external calls, live database commands, migration execution, deployment, environment/key changes or provider calls. Tests/certification remain deferred; earlier 320 mocked passes do not validate this revised SQL. The delivered one-file incremental code diff is against the quarantined v2 candidate, not an exact current-VPS Hotel baseline. Its strict local dry-run is not deployed-schema verification. Obtain redacted catalog evidence for bookings.guest_token_hash type/nullability/default/ACL/RLS and payments.booking_id FK plus installed PayU source before approval. Existing guests with missing/different parent hashes remain blocked for manual reconciliation; no historical backfill is included.
