-- 0017 — Distinct CONTENT_UNAVAILABLE state for hotel static content.
--
-- TripJack can answer HTTP 200 with an empty/partial hotels[] for a valid
-- mapping. Those IDs are neither synced nor failed: they are stamped
-- content_unavailable_at and skipped by the pending lookup until the mapping
-- is refreshed (full/NEW/UPDATE), which clears the stamp.
--
-- Additive only. No existing rows are modified: the current failed hotels keep
-- content_error_at and stay eligible, so they are classified only from a real
-- TripJack response on the next full sync.

alter table public.hotel_mappings
  add column if not exists content_unavailable_at timestamptz;

alter table public.hotel_sync_state
  add column if not exists unavailable_count int not null default 0;

-- Small partial index for admin counts of unavailable hotels.
create index if not exists hotel_mappings_content_unavailable_idx
  on public.hotel_mappings (tj_hotel_id)
  where content_unavailable_at is not null and content_synced_at is null and not is_deleted;

-- Pending lookup (replaces 0016 body; same signature/grants). Unavailable rows
-- are excluded. The 0015/0014 partial indexes still drive both queries; the
-- extra predicate is a cheap filter over few rows.
create or replace function public.hotel_catalogue_pending_content_ids(
  p_run_started_at timestamptz,
  p_limit integer default 100
) returns text[]
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit  integer := greatest(coalesce(p_limit, 100), 0);
  v_normal text[];
  v_retry  text[] := '{}';
begin
  if v_limit = 0 then
    return '{}';
  end if;

  select coalesce(array_agg(t.tj_hotel_id order by t.tj_hotel_id), '{}')
    into v_normal
    from (
      select m.tj_hotel_id
        from public.hotel_mappings m
       where m.content_synced_at is null
         and not m.is_deleted
         and m.content_error_at is null
         and m.content_unavailable_at is null
       order by m.tj_hotel_id
       limit v_limit
    ) t;

  if cardinality(v_normal) < v_limit then
    select coalesce(array_agg(t.tj_hotel_id order by t.tj_hotel_id), '{}')
      into v_retry
      from (
        select m.tj_hotel_id
          from public.hotel_mappings m
         where m.content_synced_at is null
           and not m.is_deleted
           and m.content_error_at < p_run_started_at
           and m.content_unavailable_at is null
         order by m.tj_hotel_id
         limit v_limit - cardinality(v_normal)
      ) t;
  end if;

  return coalesce((
    select array_agg(x order by x)
      from (
        select distinct x
          from unnest(v_normal || v_retry) as x
         order by x
         limit v_limit
      ) d
  ), '{}');
end;
$$;

revoke all on function public.hotel_catalogue_pending_content_ids(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.hotel_catalogue_pending_content_ids(timestamptz, integer) to service_role;

-- Atomic content save (replaces 0013 body; same signature): success also
-- clears any unavailable classification.
do $mig$
declare v_src text;
begin
  select pg_get_functiondef('public.hotel_catalogue_save_content_batch(jsonb,jsonb,jsonb,jsonb)'::regprocedure)
    into v_src;
  if position('content_unavailable_at' in v_src) = 0 then
    v_src := replace(
      v_src,
      'set content_synced_at = v_ts, content_error_at = null',
      'set content_synced_at = v_ts, content_error_at = null, content_unavailable_at = null'
    );
    if position('content_unavailable_at' in v_src) = 0 then
      raise exception '0017: could not patch hotel_catalogue_save_content_batch';
    end if;
    execute v_src;
  end if;
end
$mig$;

-- Admin counts: existing columns keep their names/order; "pending" now
-- excludes unavailable; new columns appended.
create or replace view public.hotel_catalogue_counts as
select
  (select count(*) from public.hotel_countries)                              as countries,
  (select count(*) from public.hotel_regions)                                as regions,
  (select count(*) from public.hotel_mappings)                               as mappings,
  (select count(*) from public.hotel_mappings
     where content_synced_at is null and not is_deleted and content_unavailable_at is null) as content_pending,
  (select count(*) from public.hotels where is_active)                       as active_hotels,
  (select count(*) from public.hotels where not is_active)                   as inactive_hotels,
  (select count(*) from public.hotel_mappings where is_deleted)              as deleted_mappings,
  (select count(*) from public.hotel_mappings where content_synced_at is not null and not is_deleted) as content_synced,
  (select count(*) from public.hotel_mappings
     where content_synced_at is null and not is_deleted and content_unavailable_at is null
       and content_error_at is not null)                                     as content_failed,
  (select count(*) from public.hotel_mappings
     where content_synced_at is null and not is_deleted and content_unavailable_at is not null) as content_unavailable;

grant select on public.hotel_catalogue_counts to service_role;
revoke all on public.hotel_catalogue_counts from anon, authenticated;
