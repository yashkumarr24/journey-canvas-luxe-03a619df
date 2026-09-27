-- 0016 — Read-only RPC for the full-sync pending hotel-content ID lookup.
--
-- Replaces the PostgREST table select (HTTP 500 after ~8.9s on ~739K rows)
-- with one function call running the two index-matched queries:
--   1. normal pending  (content_error_at IS NULL)            -> 0015 index
--   2. retryable       (content_error_at < p_run_started_at) -> 0014 index
-- Merged, de-duplicated, sorted by tj_hotel_id, at most p_limit.
-- STABLE + read-only: never modifies data. service_role only. No schema change.

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
