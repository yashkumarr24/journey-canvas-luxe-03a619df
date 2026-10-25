-- Deploy on the existing VPS catalogue database, not the preview/auth database.
-- Additive; no synchronization or inventory changes.
alter table public.hotel_search_sessions
  add column if not exists provider_search_ids jsonb not null default '{}'::jsonb,
  add column if not exists nationality text;

create index if not exists hotels_search_name_idx on public.hotels (lower(name) text_pattern_ops)
  where is_active;

create or replace function public.hotel_catalogue_suggestions(p_query text, p_limit integer default 12)
returns table(kind text, id text, name text, location text, label text)
language sql stable security invoker set search_path = public as $$
  with q as (select lower(regexp_replace(trim(p_query), '\s+', ' ', 'g')) as term),
  candidates as (
    select 'city'::text kind, r.city_region_id id, r.city_name name,
      r.country_name location, r.city_name || ', ' || r.country_name label
    from public.hotel_regions r, q
    where length(q.term) >= 2 and r.city_name is not null and r.country_name is not null
      and lower(r.city_name) like '%' || replace(replace(replace(q.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      and exists (select 1 from public.hotel_mappings m where m.region_id = r.city_region_id
        and not m.is_deleted)
    union all
    select 'hotel', h.tj_hotel_id, h.name,
      concat_ws(', ', coalesce(r.city_name, h.city), coalesce(r.country_name, m.country_name, h.country)),
      h.name || ' — ' || concat_ws(', ', coalesce(r.city_name, h.city), coalesce(r.country_name, m.country_name, h.country))
    from public.hotels h join public.hotel_mappings m using (tj_hotel_id)
      left join public.hotel_regions r on r.city_region_id = m.region_id, q
    where length(q.term) >= 2 and h.is_active and not m.is_deleted
      and lower(h.name) like '%' || replace(replace(replace(q.term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  )
  select d.kind, d.id, d.name, d.location, d.label from (
    select distinct on (lower(c.label), c.kind) c.* from candidates c
    order by lower(c.label), c.kind, c.id
  ) d, q
  order by case when lower(d.name) like q.term || '%' then 0 else 1 end,
    lower(d.name), lower(d.label), d.kind
  limit least(greatest(p_limit, 1), 24);
$$;

-- Exact IDs and exact free-text names only. Keyset pages avoid silent row caps.
create or replace function public.hotel_catalogue_search_ids(
  p_destination text, p_kind text default null, p_id text default null,
  p_after text default '', p_limit integer default 500)
returns table(tj_hotel_id text)
language sql stable security invoker set search_path = public as $$
  select m.tj_hotel_id from public.hotel_mappings m
  left join public.hotel_regions r on r.city_region_id = m.region_id
  left join public.hotels h on h.tj_hotel_id = m.tj_hotel_id
  where not m.is_deleted and coalesce(h.is_active, true)
    and m.tj_hotel_id > p_after
    and (
      (p_kind = 'hotel' and m.tj_hotel_id = p_id and h.is_active
        and lower(regexp_replace(trim(p_destination), '\s+', ' ', 'g')) = lower(h.name || ' — ' ||
          concat_ws(', ', coalesce(r.city_name, h.city), coalesce(r.country_name, m.country_name, h.country))))
      or (p_kind = 'city' and r.city_region_id = p_id
        and lower(regexp_replace(trim(p_destination), '\s+', ' ', 'g')) = lower(r.city_name || ', ' || r.country_name))
      or (p_kind is null and p_id is null and
        lower(regexp_replace(trim(p_destination), '\s+', ' ', 'g')) in
          (lower(r.city_name), lower(r.region_name), lower(h.name)))
    )
  order by m.tj_hotel_id limit least(greatest(p_limit, 1), 500);
$$;

revoke all on function public.hotel_catalogue_suggestions(text, integer) from public, anon, authenticated;
revoke all on function public.hotel_catalogue_search_ids(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.hotel_catalogue_suggestions(text, integer) to service_role;
grant execute on function public.hotel_catalogue_search_ids(text, text, text, text, integer) to service_role;