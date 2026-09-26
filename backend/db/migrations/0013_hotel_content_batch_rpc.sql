-- 0013 — Atomic, idempotent hotel content batch write for the FULL sync.
--
-- One call = one transaction: upsert hotels, replace their images/amenities/
-- rooms, mark their mappings content-synced. Any error rolls the whole batch
-- back, so no partial parent/child data survives. Re-running the same batch
-- yields the same rows (upsert + replace-children), never duplicates.
-- service_role only; no schema change to existing tables.

create or replace function public.hotel_catalogue_save_content_batch(
  p_hotels    jsonb,
  p_images    jsonb default '[]'::jsonb,
  p_amenities jsonb default '[]'::jsonb,
  p_rooms     jsonb default '[]'::jsonb
) returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids text[];
  v_ts  timestamptz := now();
begin
  select coalesce(array_agg(distinct h->>'tj_hotel_id'), '{}')
    into v_ids
    from jsonb_array_elements(coalesce(p_hotels, '[]'::jsonb)) h
   where coalesce(h->>'tj_hotel_id', '') <> '';

  if cardinality(v_ids) = 0 then
    return v_ids;
  end if;

  insert into public.hotels as t (
    tj_hotel_id, unica_id, name, is_active, star_rating, property_type, address,
    city, state, country, postal_code, latitude, longitude,
    descriptions, policies, contact, last_synced_at
  )
  select distinct on (h->>'tj_hotel_id')
    h->>'tj_hotel_id', h->>'unica_id', h->>'name',
    coalesce((h->>'is_active')::boolean, true),
    (h->>'star_rating')::numeric, h->>'property_type', h->>'address',
    h->>'city', h->>'state', h->>'country', h->>'postal_code',
    (h->>'latitude')::double precision, (h->>'longitude')::double precision,
    h->'descriptions', h->'policies', h->'contact', v_ts
  from jsonb_array_elements(p_hotels) h
  where coalesce(h->>'tj_hotel_id', '') <> ''
  on conflict (tj_hotel_id) do update set
    unica_id = excluded.unica_id, name = excluded.name, is_active = excluded.is_active,
    star_rating = excluded.star_rating, property_type = excluded.property_type,
    address = excluded.address, city = excluded.city, state = excluded.state,
    country = excluded.country, postal_code = excluded.postal_code,
    latitude = excluded.latitude, longitude = excluded.longitude,
    descriptions = excluded.descriptions, policies = excluded.policies,
    contact = excluded.contact, last_synced_at = excluded.last_synced_at;

  delete from public.hotel_images    where tj_hotel_id = any (v_ids);
  delete from public.hotel_amenities where tj_hotel_id = any (v_ids);
  delete from public.hotel_rooms     where tj_hotel_id = any (v_ids);

  insert into public.hotel_images (tj_hotel_id, position, url, caption)
  select distinct on (r->>'tj_hotel_id', (r->>'position')::int)
    r->>'tj_hotel_id', (r->>'position')::int, r->>'url', r->>'caption'
  from jsonb_array_elements(coalesce(p_images, '[]'::jsonb)) r
  where r->>'tj_hotel_id' = any (v_ids) and r->>'url' is not null;

  insert into public.hotel_amenities (tj_hotel_id, name)
  select distinct r->>'tj_hotel_id', r->>'name'
  from jsonb_array_elements(coalesce(p_amenities, '[]'::jsonb)) r
  where r->>'tj_hotel_id' = any (v_ids) and r->>'name' is not null;

  insert into public.hotel_rooms (tj_hotel_id, room_key, name, description, amenities, images)
  select distinct on (r->>'tj_hotel_id', r->>'room_key')
    r->>'tj_hotel_id', r->>'room_key', r->>'name', r->>'description', r->'amenities', r->'images'
  from jsonb_array_elements(coalesce(p_rooms, '[]'::jsonb)) r
  where r->>'tj_hotel_id' = any (v_ids) and r->>'room_key' is not null;

  update public.hotel_mappings
     set content_synced_at = v_ts, content_error_at = null
   where tj_hotel_id = any (v_ids);

  return v_ids;
end;
$$;

revoke all on function public.hotel_catalogue_save_content_batch(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.hotel_catalogue_save_content_batch(jsonb, jsonb, jsonb, jsonb) to service_role;
