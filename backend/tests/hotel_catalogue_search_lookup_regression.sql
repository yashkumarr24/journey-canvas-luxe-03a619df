-- Disposable database only; loaded after 0012, 0025 and 0026 by the runner.
-- The runner retains 0025's function as hotel_catalogue_search_ids_0025.
begin;
insert into public.hotel_regions(city_region_id, city_name, region_name, country_name)
values ('fixture-city','Dubai','Dubai region','United Arab Emirates'),
       ('fixture-other','Dubai','Other region','Other country');
insert into public.hotel_mappings(tj_hotel_id,region_id,country_name,is_deleted)
values ('fixture-a','fixture-city','United Arab Emirates',false),
       ('fixture-b','fixture-city','United Arab Emirates',false),
       ('fixture-c','fixture-city','United Arab Emirates',false),
       ('fixture-d','fixture-city','United Arab Emirates',true),
       ('fixture-e','fixture-other','Other country',false),
       ('fixture-f',null,'Fallback country',false);
insert into public.hotels(tj_hotel_id,name,is_active,city,country)
values ('fixture-a','Taj Dubai',true,'Dubai','United Arab Emirates'),
       ('fixture-c','Inactive property',false,'Dubai','United Arab Emirates'),
       ('fixture-d','Deleted property',true,'Dubai','United Arab Emirates'),
       ('fixture-e','Dubai',true,'Dubai','Other country'),
       ('fixture-f','Fallback property',true,'Fallback city','Hotel country');

create function pg_temp.expect_ids(dest text, kind text, selected text, after_id text,
  page_limit integer, expected text[]) returns void language plpgsql as $$
declare actual text[];
begin
  select coalesce(array_agg(tj_hotel_id), '{}'::text[]) into actual
    from public.hotel_catalogue_search_ids(dest,kind,selected,after_id,page_limit);
  if actual is distinct from expected then
    raise exception 'lookup assertion failed for %, %: expected %, got %', dest, kind, expected, actual;
  end if;
end $$;
-- Authoritative city ID; missing content included, inactive/deleted excluded.
select pg_temp.expect_ids('  dUbAi,   United Arab Emirates  ','city','fixture-city','',500,
  array['fixture-a','fixture-b']);
select pg_temp.expect_ids('Dubai, Other country','city','fixture-city','',500,'{}');
select pg_temp.expect_ids('Dubai, United Arab Emirates','city','missing','',500,'{}');
select pg_temp.expect_ids('Taj Dubai — Dubai, United Arab Emirates','hotel','fixture-a','',500,array['fixture-a']);
select pg_temp.expect_ids('Wrong name — Dubai, United Arab Emirates','hotel','fixture-a','',500,'{}');
select pg_temp.expect_ids('Inactive property — Dubai, United Arab Emirates','hotel','fixture-c','',500,'{}');
select pg_temp.expect_ids('Deleted property — Dubai, United Arab Emirates','hotel','fixture-d','',500,'{}');
select pg_temp.expect_ids('Fallback property — Fallback city, Fallback country','hotel','fixture-f','',500,array['fixture-f']);
select pg_temp.expect_ids('Taj Dubai — Dubai, United Arab Emirates','hotel','fixture-a','fixture-a',500,'{}');
-- Exact legacy names, deduplication across region and hotel match, no partials.
select pg_temp.expect_ids('Dubai',null,null,'',500,array['fixture-a','fixture-b','fixture-e']);
select pg_temp.expect_ids('Dubai region',null,null,'',500,array['fixture-a','fixture-b']);
select pg_temp.expect_ids('Dub',null,null,'',500,'{}');
select pg_temp.expect_ids('Dubai','unknown',null,'',500,'{}');
select pg_temp.expect_ids('Dubai',null,'fixture-city','',500,'{}');
select pg_temp.expect_ids(null,'city','fixture-city','',500,'{}');
select pg_temp.expect_ids('Dubai, United Arab Emirates','city','fixture-city','fixture-a',500,array['fixture-b']);
select pg_temp.expect_ids('Dubai, United Arab Emirates','city','fixture-city','',0,array['fixture-a']);

-- Synthetic large city with >500 IDs and no hotel rows: full keyset coverage.
insert into public.hotel_mappings(tj_hotel_id,region_id)
select 'page-' || lpad(i::text,4,'0'),'fixture-city' from generate_series(1,601) i;
do $$ declare first_page text[]; second_page text[]; begin
  select array_agg(tj_hotel_id) into first_page from
    public.hotel_catalogue_search_ids('Dubai, United Arab Emirates','city','fixture-city','',9999);
  if cardinality(first_page) <> 500 or first_page[500] <> 'page-0498' then
    raise exception '500-ID clamp or page boundary failed'; end if;
  select array_agg(tj_hotel_id) into second_page from
    public.hotel_catalogue_search_ids('Dubai, United Arab Emirates','city','fixture-city',first_page[500],500);
  if cardinality(second_page) <> 103 or second_page[1] <> 'page-0499'
    or second_page[103] <> 'page-0601' then
    raise exception 'second page lost or duplicated IDs'; end if;
end $$;

-- Exhaustive small input matrix: preserve 0025 output, including null inputs.
do $$ declare d text; k text; ident text; a text; lim integer; old_ids text[]; new_ids text[]; begin
  foreach d in array array[null,'','Dubai',' dubai ','Dubai region','Dub',
    'Dubai, United Arab Emirates','Dubai, Other country',
    'Taj Dubai — Dubai, United Arab Emirates','Fallback property — Fallback city, Fallback country'] loop
  foreach k in array array[null,'city','hotel','unknown'] loop
  foreach ident in array array[null,'fixture-city','fixture-other','fixture-a','fixture-c','fixture-f','missing'] loop
  foreach a in array array[null,'','fixture-a','page-0500'] loop
  foreach lim in array array[null,-1,1,500,9999] loop
    select array_agg(tj_hotel_id) into old_ids from public.hotel_catalogue_search_ids_0025(d,k,ident,a,lim);
    select array_agg(tj_hotel_id) into new_ids from public.hotel_catalogue_search_ids(d,k,ident,a,lim);
    if old_ids is distinct from new_ids then raise exception '0025 equivalence failed: %, %, %, %, %',d,k,ident,a,lim; end if;
  end loop; end loop; end loop; end loop; end loop;
  if has_function_privilege('anon','public.hotel_catalogue_search_ids(text,text,text,text,integer)','execute')
    or has_function_privilege('authenticated','public.hotel_catalogue_search_ids(text,text,text,text,integer)','execute')
    or not has_function_privilege('service_role','public.hotel_catalogue_search_ids(text,text,text,text,integer)','execute') then
    raise exception 'RPC permissions changed'; end if;
end $$;
rollback;