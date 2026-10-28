\set ON_ERROR_STOP 1
create type public.trip_type as enum ('oneway','roundtrip');
create table public.flight_searches(id serial primary key, origin text, destination text, departure_date date not null, return_date date, trip_type public.trip_type not null,
 constraint flight_searches_route_chk check (origin<>destination),
 constraint flight_searches_return_chk check ((trip_type='oneway' and return_date is null) or (trip_type='roundtrip' and return_date>=departure_date)));
\i /dev-server/backend/db/migrations/0029_flight_trip_type_multicity.sql
\i /dev-server/backend/db/migrations/0030_flight_search_multicity_routes.sql
\set ON_ERROR_STOP 0
insert into flight_searches(origin,destination,departure_date,trip_type) values('DEL','BOM','2026-11-01','oneway');
insert into flight_searches(origin,destination,departure_date,return_date,trip_type) values('DEL','BOM','2026-11-01','2026-11-05','roundtrip');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');
-- each below must FAIL
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":null,"to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-02-28','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-02-28"},{"from":"BOM","to":"DEL","travelDate":"2026-02-30"}]');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-13-01"}]');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-05','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-05"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','GOI','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','{"from":"DEL"}');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"}]');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity',null);
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','BOM','2026-11-01','oneway','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":20261103}]');
update flight_searches set departure_date='2026-11-02' where trip_type='multicity';
select count(*) as rows_kept from flight_searches;
