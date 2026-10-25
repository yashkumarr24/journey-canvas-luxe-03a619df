# Hotel catalogue lookup timeout: additive 0026

## Diagnosis and scope

Reported VPS evidence: `hotel_catalogue_search_ids` for the selected Dubai city
times out with PostgreSQL `57014` after 8.19 seconds. No VPS or production
database was contacted during this change, so its actual execution plan remains
unverified.

0025 combines city, hotel and legacy text selection in one OR across joined
catalogue tables. This can produce broad scans/joins, especially with reusable
generic RPC plans. Its live `region_id` index does not also provide the ordered
hotel-ID keyset. Increasing timeouts would not address either problem.

## Exact files changed

- `backend/db/migrations/0026_hotel_catalogue_search_ids_lookup.sql`: adds a
  concurrent partial `(region_id, tj_hotel_id)` index and replaces only the ID
  lookup RPC with separate city/hotel/legacy branches. Leaves 0025 intact.
- `backend/tests/hotel_catalogue_search_lookup_regression.sql`: concrete
  selection/filter/pagination assertions and equivalence against original 0025.
- `backend/tests/run_hotel_catalogue_lookup_tests.py`: disposable PostgreSQL
  runner, migration rerun, existing SQL regressions, large-catalogue plan checks.
- `AGENTS.md`: records bounded, indexed branch-specific lookup architecture.
- `roadmap.md`: records this task and its verification.
- `HOTEL_CATALOGUE_LOOKUP_OPTIMIZATION.md`: this report.

## Behavior preserved

- City label validated once against its exact region primary key. IDs come from
  that region only; stale or mismatched city labels return no IDs.
- Hotel selection resolves one exact mapping/property ID and validates the same
  authoritative location label, including existing null/fallback behavior.
- Deleted mappings and inactive properties are excluded. City/legacy region
  mappings without static hotel content remain eligible, as in 0025.
- Ascending text-ID ordering, exclusive `p_after`, and the existing 1–500 limit
  clamp (including null input semantics) remain unchanged.
- Legacy text uses exact city/region/hotel names, deduplicated before global
  ordering/limiting. It never broadens into partial destination searches.
- RPC stays `STABLE SECURITY INVOKER`, executable only by `service_role`.
- No provider/booking/payment, API, browser, autocomplete or sync code changed.

The city branch uses an indexed scalar hotel-primary-key lookup rather than a
global hotel join. Local testing found that a normal left join could still hash
the entire hotels table before LIMIT; the scalar lookup avoids that shape.
Scanning extra city candidates is still necessary when many are inactive.

## Checks performed

Run with PostgreSQL tools installed:

```bash
python3 backend/tests/run_hotel_catalogue_lookup_tests.py
```

The runner creates and destroys a local UNIX-socket database, explicitly ignores
remote database configuration, and uses synthetic data only. It applies actual
0012/0025/0026 SQL, keeps an isolated copy of the original RPC for comparison,
and runs the existing `hotel_catalogue_search_regression.sql` as well.

Passed on PostgreSQL 17.9:

- Concrete exact city/property, stale selection, deleted/inactive, missing
  content, same-name cities, fallback location, partial rejection and duplicate
  matching assertions.
- 603 eligible city mappings paged as 500 + 103, with exact boundary assertions.
- 5,600 input combinations equal original 0025, covering nulls, mixed case,
  whitespace, invalid types/IDs, cursors and limits.
- RPC access checks; 0026 applied twice successfully in the disposable database.
- 760,620 synthetic mappings AND hotel rows (740,000 unrelated; 20,620 target-city
  rows). City branch used `hotel_mappings_live_region_hotel_idx`: 2,012 shared
  buffers, 1.063 ms EXPLAIN execution for 500 IDs.
- Forced generic-plan RPC runs as service_role: original 289.3 ms vs optimized
  12.2 ms, including local psql process startup. These are single local measurements,
  not production latency guarantees or a reproduction of the exact VPS timeout.

## Future deployment requirements — not executed

Apply 0026 to the existing VPS catalogue database, NOT the Lovable preview/auth
database. No resync or catalogue data changes are required. No frontend build,
provider integration changes or timeout settings are required.

The concurrent index must execute outside any transaction wrapper. An interrupted
concurrent build may leave an invalid index: inspect validity before retrying,
because `IF NOT EXISTS` will not repair it. Do not remove the existing index.
Building the new index uses temporary CPU/I/O/disk but avoids blocking normal
catalogue writes. The function replacement briefly locks its definition.

After authorized deployment, inspect index validity and table statistics and run
`EXPLAIN (ANALYZE, BUFFERS)` for the city branch with the actual selected region
and early/late cursors. Top-level EXPLAIN of PL/pgSQL shows only Function Scan,
so explain the branch query shown in the runner to inspect its underlying plan.
Retest the RPC via the VPS service_role API, then a real website hotel search and
Explore more stays. Do not infer availability from catalogue mapping counts.

No migration has been deployed, no production data changed, and live 503
resolution has not been claimed.