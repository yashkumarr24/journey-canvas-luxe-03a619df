-- 0014 — Optimize the full-sync pending hotel-content lookup.
--
-- Supports:
--   content_synced_at is null
--   and is_deleted = false
--   and (content_error_at is null or content_error_at < :run_started_at)
--   order by tj_hotel_id
--   limit 100
--
-- CONCURRENTLY keeps normal catalogue writes available while PostgreSQL builds
-- the index over the existing mapping rows. This statement must run outside an
-- explicit transaction block.

create index concurrently if not exists hotel_mappings_pending_content_error_idx
  on public.hotel_mappings (content_error_at, tj_hotel_id)
  where content_synced_at is null and not is_deleted;