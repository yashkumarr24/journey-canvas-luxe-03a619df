# Optimize pending hotel-content lookup

## Audit finding

The current partial index supports the fixed pending predicates and `ORDER BY tj_hotel_id`, but it does not index `content_error_at`. As a run accumulates failures stamped at or after `run_started_at`, PostgreSQL may scan a large portion of roughly 739K pending mappings only to reject them against the `content_error_at` condition, eventually hitting the statement timeout.

## Change

- Add one additive migration (`0014`) with a partial composite B-tree index on `(content_error_at, tj_hotel_id)` for rows where `content_synced_at IS NULL AND is_deleted = false`.
- Build it concurrently so normal catalogue writes remain available while PostgreSQL scans the existing rows.
- Leave the repository query and all sync behavior unchanged.

## Why this exact index

The partial predicate removes synced and deleted rows before lookup. The leading `content_error_at` column supports both branches of the existing condition (`IS NULL` and `< run_started_at`), while `tj_hotel_id` supplies the requested identifier and provides ordering within matching error-time groups. PostgreSQL can use indexed scans/bitmap combination and a small top-N sort rather than walking many currently ineligible pending rows.

## Verification

- Check the migration is additive and contains no data-changing statements.
- Run a SQL syntax/static inspection locally; do not apply the migration or start a sync.
- Report expected production impact and the recommended `EXPLAIN (ANALYZE, BUFFERS)` verification after deployment.

## Production safety

For approximately 739K rows, this is a routine index size. `CREATE INDEX CONCURRENTLY` avoids blocking normal inserts/updates, though it uses temporary CPU, I/O, and disk and may take time. It must be applied outside a transaction; if the migration runner always wraps migrations in a transaction, run this migration with a supported no-transaction setting rather than dropping `CONCURRENTLY`.
