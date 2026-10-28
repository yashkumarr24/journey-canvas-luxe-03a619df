-- Deploy on the existing VPS catalogue database, not the preview/auth database.
-- Additive; no synchronization or inventory changes.
-- Durable progress for progressive hotel searches: if the background Listing
-- continuation is interrupted (restart, worker loss), the stored session must
-- still say the search never finished, so the progress endpoint can report
-- partial/interrupted instead of presenting the initial batches as complete.
alter table public.hotel_search_sessions
  add column if not exists progress jsonb;
