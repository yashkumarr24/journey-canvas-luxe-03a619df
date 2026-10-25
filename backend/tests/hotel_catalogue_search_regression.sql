-- Run after 0025 in a disposable test database containing only synthetic fixtures.
begin;
insert into public.hotel_regions(city_region_id,city_name,region_name,country_name)
values ('test-region-a','Test Dubai','Test Dubai','Test country'),
       ('test-region-b','Test Dubailand','Test Dubailand','Test country');
insert into public.hotel_mappings(tj_hotel_id,region_id,country_name)
values ('test-hotel-a','test-region-a','Test country'),
       ('test-hotel-b','test-region-a','Test country'),
       ('test-hotel-c','test-region-b','Test country');
insert into public.hotels(tj_hotel_id,name,city,country)
values ('test-hotel-a','Test Taj Dubai','Test Dubai','Test country'),
       ('test-hotel-b','Test other property','Test Dubai','Test country'),
       ('test-hotel-c','Test area property','Test Dubailand','Test country');
do $$ begin
 if (select count(*) from public.hotel_catalogue_suggestions('  TeST Dub  ',24)) != 2 then
   raise exception 'partial mixed-case city lookup failed'; end if;
 if (select count(*) from public.hotel_catalogue_suggestions('test taj dub',24)) != 1 then
   raise exception 'partial hotel lookup failed'; end if;
 if (select count(*) from public.hotel_catalogue_search_ids('Test Dubai, Test country','city','test-region-a')) != 2 then
   raise exception 'city scope failed'; end if;
 if (select count(*) from public.hotel_catalogue_search_ids('Test Taj Dubai — Test Dubai, Test country','hotel','test-hotel-a')) != 1 then
   raise exception 'hotel scope failed'; end if;
 if (select count(*) from public.hotel_catalogue_search_ids('Test Dubailand, Test country','city','test-region-a')) != 0 then
   raise exception 'stale city ID accepted'; end if;
 if (select count(*) from public.hotel_catalogue_suggestions('zz-test-no-matches',24)) != 0 then
   raise exception 'no-match lookup failed'; end if;
 if has_function_privilege('anon','public.hotel_catalogue_suggestions(text,integer)','execute') then
   raise exception 'anonymous bulk catalogue access'; end if;
end $$;
rollback;