-- Disposable database only; loaded after 0027 by the runner. Synthetic fixtures.
begin;
insert into public.hotel_regions(city_region_id, city_name, region_name, country_name)
values ('dup-small','Dubai','Dubai','United Arab Emirates'),       -- selected (like 147862)
       ('dup-large','  dubai ','Dubai city','united  arab emirates'), -- like 697010
       ('dup-empty','DUBAI','Dubai empty','United Arab Emirates'),  -- like 739718
       ('dup-other-country','Dubai','Dubai','Other country'),
       ('dup-other-city','Dubailand','Dubailand','United Arab Emirates');
insert into public.hotel_mappings(tj_hotel_id, region_id, country_name, is_deleted)
values ('s-1','dup-small','United Arab Emirates',false),
       ('s-3','dup-small','United Arab Emirates',false),
       ('l-2','dup-large','United Arab Emirates',false),
       ('l-4','dup-large','United Arab Emirates',false),
       ('l-del','dup-large','United Arab Emirates',true),
       ('l-inactive','dup-large','United Arab Emirates',false),
       ('x-country','dup-other-country','Other country',false),
       ('x-city','dup-other-city','United Arab Emirates',false);
insert into public.hotels(tj_hotel_id, name, is_active, city, country)
values ('l-inactive','Inactive',false,'Dubai','United Arab Emirates'),
       ('l-2','Active',true,'Dubai','United Arab Emirates');

create function pg_temp.ids(dest text, kind text, selected text, after_id text, lim integer)
returns text[] language sql as $$
  select coalesce(array_agg(tj_hotel_id), '{}'::text[])
  from public.hotel_catalogue_search_ids(dest, kind, selected, after_id, lim) $$;

do $$ declare got text[]; p1 text[]; p2 text[]; begin
  -- Selected small region resolves sibling regions; ordered, deleted/inactive excluded.
  got := pg_temp.ids('Dubai, United Arab Emirates','city','dup-small','',500);
  if got is distinct from array['l-2','l-4','s-1','s-3'] then
    raise exception 'sibling regions not merged: %', got; end if;
  -- Any sibling ID gives the same set when its own exact label matches.
  got := pg_temp.ids('DUBAI, United Arab Emirates','city','dup-empty','',500);
  if got is distinct from array['l-2','l-4','s-1','s-3'] then
    raise exception 'empty sibling failed: %', got; end if;
  -- Exact label validation still uses the selected row's label.
  if pg_temp.ids('Dubai, Other country','city','dup-small','',500) <> '{}' then
    raise exception 'label validation loosened'; end if;
  if pg_temp.ids('Dubai, United Arab Emirates','city','missing','',500) <> '{}' then
    raise exception 'unknown ID accepted'; end if;
  -- Other country and partial-name cities stay separate.
  got := pg_temp.ids('Dubai, Other country','city','dup-other-country','',500);
  if got is distinct from array['x-country'] then raise exception 'country isolation: %', got; end if;
  -- Keyset pagination across regions: no duplicates, no gaps.
  p1 := pg_temp.ids('Dubai, United Arab Emirates','city','dup-small','',2);
  p2 := pg_temp.ids('Dubai, United Arab Emirates','city','dup-small',p1[2],2);
  if p1 is distinct from array['l-2','l-4'] or p2 is distinct from array['s-1','s-3'] then
    raise exception 'cross-region pagination failed: % / %', p1, p2; end if;
end $$;

-- Duplicate HIDs: hotel_mappings.tj_hotel_id is a primary key, so one HID maps
-- to one region; assert that and that a large merged city never repeats an HID.
insert into public.hotel_mappings(tj_hotel_id, region_id)
select 'bulk-' || lpad(i::text,4,'0'), case when i % 2 = 0 then 'dup-large' else 'dup-small' end
from generate_series(1,1200) i;
do $$ declare total int := 0; distinct_total int; after_id text := ''; page text[]; all_ids text[] := '{}'; begin
  begin
    insert into public.hotel_mappings(tj_hotel_id, region_id) values ('s-1','dup-large');
    raise exception 'duplicate HID accepted';
  exception when unique_violation then null; end;
  loop
    page := pg_temp.ids('Dubai, United Arab Emirates','city','dup-small',after_id,500);
    exit when cardinality(page) = 0;
    all_ids := all_ids || page; after_id := page[cardinality(page)];
  end loop;
  select count(*), count(distinct x) into total, distinct_total from unnest(all_ids) x;
  if total <> 1204 or distinct_total <> total then
    raise exception 'merged paging returned % ids (% distinct), expected 1204', total, distinct_total; end if;
  if has_function_privilege('anon','public.hotel_catalogue_search_ids(text,text,text,text,integer)','execute')
    or not has_function_privilege('service_role','public.hotel_catalogue_search_ids(text,text,text,text,integer)','execute') then
    raise exception 'RPC permissions changed'; end if;
end $$;
rollback;
