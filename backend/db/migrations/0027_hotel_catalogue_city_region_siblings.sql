-- 0027 — City selection resolves duplicate normalized city/country regions.
-- Apply only to the VPS catalogue database. Additive: same RPC signature,
-- hotel and free-text branches unchanged from 0026. No catalogue data changed.
-- Run outside a transaction (CONCURRENTLY).
create index concurrently if not exists hotel_regions_city_country_norm_idx
  on public.hotel_regions (
    lower(regexp_replace(trim(city_name), '\s+', ' ', 'g')),
    lower(regexp_replace(trim(country_name), '\s+', ' ', 'g')));

create or replace function public.hotel_catalogue_search_ids(
  p_destination text, p_kind text default null, p_id text default null,
  p_after text default '', p_limit integer default 500)
returns table(tj_hotel_id text)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_term text := lower(regexp_replace(trim(p_destination), '\s+', ' ', 'g'));
  v_limit integer := least(greatest(p_limit, 1), 500);
  v_city text;
  v_country text;
  v_regions text[];
begin
  if p_kind = 'city' then
    -- Exact label validation against the selected ID (unchanged from 0026).
    select lower(regexp_replace(trim(r.city_name), '\s+', ' ', 'g')),
           lower(regexp_replace(trim(r.country_name), '\s+', ' ', 'g'))
      into v_city, v_country
      from public.hotel_regions r
      where r.city_region_id = p_id
        and v_term = lower(r.city_name || ', ' || r.country_name);
    if v_city is null or v_country is null then
      return;
    end if;
    -- All regions sharing the selected normalized city AND country.
    select array_agg(r.city_region_id) into v_regions
      from public.hotel_regions r
      where lower(regexp_replace(trim(r.city_name), '\s+', ' ', 'g')) = v_city
        and lower(regexp_replace(trim(r.country_name), '\s+', ' ', 'g')) = v_country;
    return query
      select distinct m.tj_hotel_id from public.hotel_mappings m
      where m.region_id = any(v_regions) and not m.is_deleted
        and m.tj_hotel_id > p_after
        and coalesce((select h.is_active from public.hotels h
          where h.tj_hotel_id = m.tj_hotel_id), true)
      order by m.tj_hotel_id limit v_limit;
  elsif p_kind = 'hotel' then
    return query
      select m.tj_hotel_id from public.hotel_mappings m
      join public.hotels h on h.tj_hotel_id = m.tj_hotel_id
      left join public.hotel_regions r on r.city_region_id = m.region_id
      where m.tj_hotel_id = p_id and not m.is_deleted and h.is_active
        and m.tj_hotel_id > p_after
        and v_term = lower(h.name || ' — ' || concat_ws(', ',
          coalesce(r.city_name, h.city), coalesce(r.country_name, m.country_name, h.country)))
      order by m.tj_hotel_id limit v_limit;
  elsif p_kind is null and p_id is null then
    return query
      with matched_regions as (
        select r.city_region_id from public.hotel_regions r where lower(r.city_name) = v_term
        union
        select r.city_region_id from public.hotel_regions r where lower(r.region_name) = v_term
      ), candidates as (
        select m.tj_hotel_id from matched_regions r
        join public.hotel_mappings m on m.region_id = r.city_region_id
        where not m.is_deleted and m.tj_hotel_id > p_after
        union
        select h.tj_hotel_id from public.hotels h
        join public.hotel_mappings m on m.tj_hotel_id = h.tj_hotel_id
        where lower(h.name) = v_term and h.is_active and not m.is_deleted
          and m.tj_hotel_id > p_after
      )
      select c.tj_hotel_id from candidates c
      left join public.hotels h on h.tj_hotel_id = c.tj_hotel_id
      where coalesce(h.is_active, true)
      order by c.tj_hotel_id limit v_limit;
  end if;
end;
$$;

revoke all on function public.hotel_catalogue_search_ids(text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.hotel_catalogue_search_ids(text, text, text, text, integer)
  to service_role;
