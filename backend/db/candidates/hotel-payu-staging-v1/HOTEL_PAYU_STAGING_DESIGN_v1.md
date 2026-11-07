# Hotel → parent booking → PayU: staging-only proposal v1

## Status and scope
Prepared from current repository source and the user's verified VPS schema, NOT a new live audit. No SQL, database connection, secrets, provider calls, deployment, service execution or environment changes occurred. Production/backend executable source remains unchanged. 0033 remains quarantined; applied 0031/0032 are not modified. This is a proposed design and candidate patch, **not apply-ready or certified**.

## Authoritative baseline and contradictions
- Hotel tables absent. `payments.booking_id` references `bookings.id`.
- `provider_code` has tripjack/razorpay/manual, not payu. `payments.txnid` and `provider_mihpayid` absent.
- `bookings.guest_token_hash` absent. Parent references restricted to `FF-[0-9A-Z]{8}`.
- Local Hotel generator uses FNFH + six hex chars (`hotel_sessions.py:58–60`). Current PayU repo routes Hotels through `hotel_booking_id` and infers Flight from all parent IDs (`repositories/payments.py:60–82,105–112`). These assumptions are incompatible.
- Local 0033 assumes a parent hash and widens the shared reference constraint. Neither is retained in this proposal.
- Local 0024 drops payments.booking_id NOT NULL, introduces a second FK and labels all parent captures Flight: **do not replay it**.
- Hotel routes pass payment_verified=false. Production-labelled service pointing to apitest is an environment mismatch, not authorization to enable payment/provider execution.

## One target design
`bookings (hotel parent, FF reference) ← payments.booking_id`
`bookings.id ← hotel_bookings.booking_id (NOT NULL, UNIQUE)`
`payments.id ← hotel_payu_staging_jobs.payment_id (UNIQUE, manual_review only)`

1. New Hotels use the existing FF reference format, allocated with a cryptographically secure generator. Type comes from bookings.booking_type, never a prefix. Keep Flight references and the shared CHECK untouched. The unique parent reference constraint is the ultimate collision guard; a collision fails safely (bounded retry on confirmed reference unique violation is future hardening, not present in this patch). Existing FNFH sessions must be restarted; any later legacy import requires an explicit private alias/reconciliation plan—never rename Flight records.
2. One service-role-only transaction locks the durable Review row and serializes its review token, validates expiry/type/owner/accepted total/currency/provider option, creates the pending parent plus Hotel draft, and marks Review guests_submitted. Idempotent retry requires matching ownership, amount, contacts, guest evidence and provider option. No in-memory fallback, no awaiting_payment on transaction failure. Retry checks include special requests, snapshots and nationality; an unrelated colliding parent is never adopted. SQL concurrency behavior remains untested.
3. Guest ownership lives on private hotel_bookings.guest_token_hash copied from server Review, not a browser hash. PayU resolves the parent, exactly one Hotel child and matching amount/currency/owner/reference/contact, then uses the existing constant-time hash comparison against the supplied opaque guest token. Signed-in parents require the verified account owner. No reference/email fallback, no invented traveller/profile rows, and **no parent guest hash column**. Existing Flight authorization is unchanged; newly adding a parent hash would otherwise expose it through authenticated table SELECT grants.
4. Payment orders write only payments.booking_id=parent.id and server-owned amount. Add payu enum value and nullable PayU fields/indexes, without altering any existing FK or enum labels. No amount/ref/provider ID is accepted as browser authority. One live PayU attempt per parent prevents concurrent orders; errors fail closed.
5. Reuse existing PayU reverse-hash and server verify_payment checks. The proposed service also requires verified txnid equality. Capture is server-only and atomically locks payment/parent/Hotel, checks type/link/amount/currency/draft state, sets both gateway reference columns (including provider_payment_id required by the existing captured constraint), advances parent to payment_processing and creates one durable manual_review job. A failed CAS is reported captured only after durable payment and matching job reread. Separate refund/worker APIs stay unavailable: this isolated outbox is NOT compatible with old 0024 job claim/refund methods and must not be routed to them.
6. Hotel provider factory and paid boolean gate refuse unconditionally in the candidate. Keep original public routes passing false; do not turn this into true based on a request or status page. Flight remains disabled and unchanged. No worker is installed and no UAT flag is enabled.

## Exact proposed code patch (against current repository backend)
- app/services/hotel_sessions.py: FF-format Hotel references only.
- app/repositories/payments.py: parent booking_type lookup and private Hotel consistency checks; parent-only inserts/filters; dedicated capture and outbox names.
- app/services/payments.py: explicit verified transaction identity; durable capture/outbox reread.
- app/services/hotel_booking.py: unconditional Hotel provider/paid execution refusal in staging candidate.

Patch is isolated, NOT copied over active backend source. Existing repository draft service/RPC caller remains the caller for the proposed replacement SQL contract. No frontend/Flight/Search/payment credential configuration edits.

## Migration reconciliation
- **0018**: original remains byte-identical. Candidate recreates its Hotel lifecycle shape only when tables are absent; adds mandatory parent FK at creation; uses plain user UUID (no auth.users FK); grants service_role then enables RLS, no customer policies. Certification table is structural only; no certification is run.
- **0023**: do not infer execution from its filename. Reuse only needed additive enum/PayU-field/index intent in a forward candidate; omit bookings.guest_token_hash and defer refund/webhook scaffolding to a separately reviewed phase. Existing return/reconcile flows can be exercised with mocked callbacks after authorization; webhook and refund endpoints must remain closed until their storage is reconciled.
- **0033**: superseded design; stays at its original quarantined .candidate path, never apply it. Do not widen FF reference CHECK or require the nonexistent parent guest hash.
- **0034a/0034b**: proposed numbering only; reserve actual next numbers using an authoritative staging ledger/catalog before apply. Enum addition commits separately before an index references payu; prevents PostgreSQL unsafe use of a new enum value in the same transaction. 0034b has a manual staging acknowledgement and absence/FK/session guard, but these are NOT a comprehensive schema audit or proof of staging isolation.
- **0011 and catalogue/search migrations**: Hotel tables being absent implies durable Review/session dependencies may also be absent. The provided candidate intentionally aborts without hotel_review_sessions. Prepare a separate reviewed session prerequisite migration from 0011 (plain owner UUID, explicit grants/RLS) and required nationality/context columns. Do NOT replay its shared booking_events CHECK replacement or replay 0012–0030 blindly. The full session/schema preflight remains a blocker.
- Applied Flight 0031/0032: preserve exact live definitions and data. No replay, edit or backfill.

## Staging-only apply plan — future authorized operator actions, not executed
1. Create a genuinely isolated staging environment/DB from reviewed schema-only definitions or a sanitized snapshot. Do not use production credentials/data. Verify database identity and APP_ENV via trusted operator controls. The SQL acknowledgement does not replace these controls.
2. Keep payments, refunds, jobs and all Hotel/Flight provider operations disabled. Use mocked HTTP transport initially; no TripJack or PayU network requests. Do not toggle production-labelled apitest settings to make tests pass.
3. Gather complete redacted staging catalog: required tables/columns/types/nullability/defaults/PK/FK/unique constraints; enum labels; function bodies/owners/search paths; grants/RLS; migration ledger; installed 0031/0032 and parent reference CHECK. Compare every object before DDL. Validate existing PayU refund/webhook/job definitions separately. Stop on divergence; don't auto-repair it with IF NOT EXISTS.
4. Complete missing private Hotel Review/session prerequisites and precision hardening: the current Review/draft model still uses float; capture SQL compares exact stored numeric values but frontend-model float serialization is NOT verified exact provenance. Use a server Decimal/numeric source without browser/fallback totals before acceptance. Add guest-doc encryption/retention controls before capturing real PAN/passport; raw guests JSON is not production-ready.
5. Review/add mocked and isolated PostgreSQL tests below. Only after passing, explicitly authorize staging apply. Establish a staging migration ledger and reserve candidate sequence numbers. Do not scan the generic repository migrations directory.
6. Apply 0034a to the confirmed staging database and commit. Apply reviewed session prerequisite(s), then 0034b with `SET fnf.staging_review='HOTEL-PAYU-STAGING-V1'` in that same staging connection. Use explicit file lists and stop-on-error. Never run these steps on production.
7. Apply code patch on staging ONLY with `patch --dry-run --fuzz=0 -p1` from backend root before applying; deploy only to isolated staging after separate authorization. Route allowlist: mocked create/status/return/reconcile only; webhook/refund/jobs/provider operations blocked. Do not wholesale deploy branch payment APIs.
8. Verify no Flight changes: refs/constraints/FKs/functions, private Review fields, existing owner reads and unconditional Book refusal. Only a later separately authorized phase can enable PayU test verification on staging; TripJack remains refused here.

## Verification checklist (not run this turn)
- Matching signed-in and guest Review creates exactly one parent/Hotel/link; owners, total, currency, contact and reference agree.
- Wrong/missing/cross-guest token, owner mismatch, expired Review, unaccepted price change, missing DB/session/table/link all fail with no awaiting_payment.
- Concurrent same Review retries create one parent and one child; mismatched retries refuse; failure after parent insert rolls back both.
- FF Hotel vs FF Flight resolves by booking_type; Flight reference/guest/auth paths unchanged.
- PayU duplicate orders return one txnid; amount comes from parent; decimal disagreement refuses. Bad callback hash, transaction/amount/merchant mismatch and verify timeout never capture.
- Concurrent return/reconcile/mock callback captures once and creates one Hotel manual_review job; capture failure returns pending, never false success.
- Gateway ID uniqueness and existing provider_payment_id captured constraint hold. No booking_type=flight can enter the Hotel capture RPC.
- anon/authenticated cannot read Hotel hashes, provider handles, guests, jobs or execute either RPC. Parent display/guest HTTP lookup must not accidentally expose Hotel private fields through existing operations code; complete that audit before release.
- Host checks use exact parsed HTTPS hostname allowlists and explicit staging designation. Existing substring 'apitest' checks are insufficient for future provider enablement. Cross-environment combinations and redirects refuse.
- Provider/pay/refund/job spies show zero external calls in mock staging; no boolean bypass, no payment simulation on a deployed public site.

## Rollback
Before any staging money: stop checkout/callback/worker exposure, revert only the staging candidate code and retain additive DB objects. Old staging Hotel code remains unusable against new FF references—do not restore it as an operational fallback. Disable Hotel draft routes as well. Leave original Flight code and refs intact.
If a later separately approved stage has payments: preserve all parents/payment rows/IDs/outbox and audit evidence; continue a separately reviewed verification-only callback/reconciliation service so late success is not lost. Never delete a captured transaction or replay Book. No automatic refunds; reconcile provider absence/uncertainty and gateway balances first.
Do not remove payu from the enum (PostgreSQL has no safe simple DROP VALUE), drop new columns/FKs/tables, or reverse data. Use forward corrective migrations. Production receives no rollback because production was not changed.

## Checks performed and blockers
Python AST syntax parsing only: four candidate files; no imports/service execution. Exact four-file patch dry-run: zero fuzz/offsets/failures. No SQL parsed/executed, tests or provider certification; migration acceptance and payment flow correctness remain unverified.
Blockers: full staging catalog/source parity; missing session schema; float-to-Decimal provenance; comprehensive preflight/retry tests; encrypted guest documents; route isolation for old webhook/refund/worker methods; exact host gates; later payment-to-TripJack paid port with durable DB proof instead of payment_verified boolean. Candidate is intentionally non-fulfilling, not an end-to-end paid booking release.
