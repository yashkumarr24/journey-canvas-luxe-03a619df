-- 0015 — Optimize the NORMAL pending hotel-content lookup (no prior error).
--
-- The normal full-sync path queries:
--   content_synced_at is null
--   and is_deleted = false
--   and content_error_at is null            -- the branch EXPLAIN showed slow (~4.3s)
--   order by tj_hotel_id
--   limit 100
--
-- The leading tj_hotel_id column matches ORDER BY tj_hotel_id exactly, so
-- PostgreSQL can walk this partial index in order and stop after LIMIT 100
-- rows with no sort and no recheck of ineligible rows. The stricter partial
-- predicate (content_error_at IS NULL) also keeps the index small: only the
-- truly-pending, never-failed rows are included.
--
-- CONCURRENTLY keeps normal catalogue writes available while PostgreSQL builds
-- the index over the existing mapping rows. This statement must run outside an
-- explicit transaction block.
--
-- Additive only: no existing index is dropped and the sync query is unchanged.

create index concurrently if not exists hotel_mappings_pending_error_free_idx
  on public.hotel_mappings (tj_hotel_id)
  where content_synced_at is null
    and not is_deleted
    and content_error_at is null;
