# iOS handoff development safety correction

Review-only on `ios-payu-handoff`. No SQL execution, production reads/configuration,
provider calls or repeat Safari mock tests. Shared payment modules are unchanged.
This supersedes the earlier Files preflight's payments.currency=text assertion.

## Currency contract

Source: `backend/db/migrations/0005_payments_events.sql:21,27` declares
`payments.currency char(3) NOT NULL DEFAULT 'INR'` with uppercase three-letter
CHECK. PostgreSQL information_schema calls this `character`; internal OID is
`pg_catalog.bpchar`, and pg_attribute.atttypmod is 7 (3 + 4). Unqualified
`character` defaults to width 1, so reported type alone does not establish width.
The corrected `DB_PREFLIGHT.sql` requires bpchar + typmod 7 + NOT NULL, never
ALTERs the column. Hotel currency remains the documented text type. bpchar is
blank-padded and trailing blanks are insignificant in some comparisons; casting
to text removes padding. Handoff SQL explicitly requires normalized INR. The
existing uppercase CHECK must be inspected in the privately reviewed schema
fingerprint; no production constraint/type/length was queried or changed here.

## Quarantined 0035 correction

- Same preflight assertion block inside migration transaction, before DDL.
- Explicit NULL/finite-value/digest checks; post-lock expiry/window evaluation.
- Immediate least-privilege table GRANT, RLS, client revokes and service-only RPCs.
- SECURITY INVOKER and pg_catalog,pg_temp search_path with fully qualified app
  objects remove definer-owner escalation. Require existing service_role RLS
  bypass; no role grants, owner changes or auth schema changes. Existing service
  role has broad authority; this does not authorize anonymous callers.
- Payment -> Hotel -> token locks inside both mutation RPCs; bounded transaction
  timeouts. Actual deployed capture/refund/cancellation lock compatibility remains
  unproven; offline parser tests are not database concurrency certification.
- Locked token is rechecked for existence, expiry/revocation/consumption. Burn
  precedes final payment-state refusal; an empty successful RPC response must
  commit burn. A transaction error rolls back; no signed form is returned then.
- Pending/non-created payments, provider booking and fulfilment jobs refuse.
- Replacement only after latest link expiry, minimum 10-second age, max 3 total
  links, and no consumed link anywhere. Fresh service Verify/not_found remains
  necessary. Once a signed form could have been delivered, no replacement is
  safe enough to recommend without provider duplicate-txn certification.
- **Initial issuance (n=0) is deliberately refused.** Current Python service is
  incompatible with this conservative candidate for first issue and must NOT be
  activated. Age, latest-payment lookup or a caller boolean cannot establish
  origin atomically with existing create_order. No first-link RPC/seed/backdoor
  is supplied; there is no runnable end-to-end release package yet.

Complete compatibility still requires reviewed exact unique-index predicates,
CHECKs/FKs, existing RPC signatures/owners/grants/bodies, defaults/triggers, role
inheritance and schema fingerprint. In particular one-open-PayU-per-Hotel and
exactly-one-subject semantics must be validated. Current guard prints definitions
for semantic review, not a claim to automatically prove those definitions.
Do not apply original or corrected 0035 until these and initial issuance pass
isolated PostgreSQL tests. Do not use migration runner or replay 0023/0024.

## Minimal initial-issuance design (NOT implemented)

An approved new reservation service/RPC must atomically reserve the payment
identity and first digest under a per-booking exclusion before any signed form
is exposed. Reuse server-owned amount/currency/owner evidence and existing txnid
rules. Return only one payment UUID/txnid and link. Website-created attempts
cannot acquire iOS origin later. Lost issue response must return status-only;
never infer a fresh attempt from absent link history. This needs shared
new-attempt entry-path review, not an overlay that replaces live payment files.

## Late-charge exclusion design — website AND iOS (NOT implemented)

One durable per-booking charge-reservation record coordinated with both entry
paths and settlement. Use a documented single global lock order chosen after
reviewing the actual VPS capture/cancellation/refund code. Do not change any of
those functions in this package.

| Evidence | New charge identity? | Recovery |
|---|---|---|
| No reservation and no prior provider-capable attempt | Atomically reserve once | Issue once |
| Reserved, never delivered signed form, provider not_found | Not a second attempt | Recover same reservation subject to approved policy |
| Signed form delivered, timeout, dropped, user cancellation, pending/auth or unknown Verify | NO; unresolved, not proven unpaid | Status/reconcile/manual review |
| Verified captured | NO | One fulfilment; reconcile booking |
| Prior terminal state but late capture remains possible | NO by default | Provider-finality/manual resolution required |
| Refunded | Not automatically eligible | Reconcile booking and every prior attempt before fresh approval |

Do not equate failed database status or Verify not_found with irreversible
no-charge finality. To authorize another txnid, require provider-documented
finality or explicitly reviewed operator process that accepts/manages remaining
risk; no invented timeout establishes finality. Capture arriving late must be
persisted as financial evidence even if superseded, with a durable conflict
queue, no second fulfilment, and reconciliation of every attempt including
failed/ambiguous ones. No automatic refund while provider booking is uncertain.
Keep existing reverse hash, exact Verify success/captured, identity and locked
refund balance rules. Their implementation remains separately approved work.

Acceptance cases: simultaneous website/iOS reserve; old failure/new identity/late
capture; newer failed/refunded attempt; two captured payments; callback/worker
race; lost issue/redeem/Verify response; uncertain booking; manual resolution.
Offline deterministic tests then actual isolated DB concurrency tests are required.

## Narrow activation design — backend-enforced (NOT implemented)

Issue requires BOTH verified authenticated tester account and enrolled signed
**iOS development build**. Guest token, request userId, header saying iOS,
Capacitor check, bundle-name string and embedded shared API key are insufficient.

1. Operator sets one approved immutable user UUID in private backend configuration
   (empty deny-all default), enrollment expiry, expected Team ID/Bundle ID,
   approved development build identity and default-off activation switch.
2. Enroll device Apple App Attest key after verifying Apple's attestation chain,
   expected app identity/development environment and server challenge. Bind key
   to authenticated tester UUID and approved enrollment record. Exact build
   approval requires trusted controlled enrollment/provisioning: App Attest app
   identity alone does not prove a specific build version. Do not trust a
   self-reported version header. If proof/enrollment unavailable, refuse.
3. Issue endpoint requires authenticated account equals enrolled tester and the
   booking owner, unexpired enrollment, fresh App Attest assertion covering a
   server nonce + canonical method/path/body hash + booking reference; verify
   signature, key binding and monotonic counter atomically. One-time nonce and
   rate limits prevent replay. No reusable secret is shipped in JS.
4. Only after authorization may reserve/issue occur. Replacement applies the
   same authorization and financial rules. Kill switch revokes issuance globally
   and enrollment can revoke one tester without affecting website/callbacks.
5. Safari redeem cannot provide native assertion; single-use token issued ONLY
   after authorized reservation is its scoped capability. Bind digest record to
   reservation/tester/enrollment, verify revocation/expiry at redeem; no guest
   credential in URL. Backend cannot cryptographically prove browser identity;
   bearer capability theft is still a risk managed by short TTL and no logging.
6. Frontend flag enables UX only; backend is authoritative. Shared hosted website
   normal checkout unchanged; signed development native build supplies assertion.
   This needs native bridge, enrollment/challenge endpoints/schema and Apple
   verification implementation with offline fixtures, then device verification.

No tester UUID/secrets/config values were set. No enforcement module is falsely
claimed to exist: current handoff remains gated only by earlier switches and
must stay OFF until this authorization design is approved and implemented.

## Validation and deployment prerequisites

Tests in `backend/tests/test_ios_payu_sql_candidate.py` parse outer SQL and
PL/pgSQL without executing it, test mocked currency metadata and replacement
policy cases, and check SQL contractual guards. No live catalog/DB locks tested.
Existing handoff/payment tests use offline fake repos/clients. No Safari rerun.

Results: 207 focused checks passed (23 new candidate checks plus existing
handoff, payment, isolation and Hotel fulfilment mocks); Ruff clean and
git diff --check clean. Outer PostgreSQL and PL/pgSQL parsing passed with
pglast 8.7; this is not SQL execution/type resolution/lock validation.
Only existing pytest-asyncio/Starlette deprecation warnings were emitted.
Reproduce in an isolated configuration-free backend copy using test-only
requirements-static.txt and the existing test dependencies:

```bash
python -m pytest -q tests/test_ios_payu_sql_candidate.py tests/test_payu_handoff.py \
  tests/test_payu_payments.py tests/test_payu_isolation.py tests/test_hotel_payment_fulfilment.py
ruff check tests/test_ios_payu_sql_candidate.py
```

Before any deployment: reconcile complete manually patched
`/home/flynfeel/releases/hotel-main-ec3a1e8/backend` source/unit/dependency delta;
prepare overlay against exact protected live copy, retain cancellation hashes;
approved live-schema fingerprint and isolated SQL permissions/concurrency;
initial reservation and shared late-charge design approval/implementation;
backend tester/attestation enforcement; worker scheduling/backlog recovery;
restore-tested backup and approved OFF-first deployment. Six known matching file
hashes are not the complete VPS ledger. Shared settlement/refund code stays intact.
