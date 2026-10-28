-- Run ONLY in a fresh isolated database:
-- psql -X -v ON_ERROR_STOP=1 -d <scratch_database> -f <path/to/this/file>
-- Do not use --single-transaction: 0029 must commit before 0030 uses the enum.
\set ON_ERROR_STOP 1
create type public.trip_type as enum ('oneway', 'roundtrip');
create table public.flight_searches (
  id serial primary key,
  origin text,
  destination text,
  departure_date date not null,
  return_date date,
  trip_type public.trip_type not null,
  constraint flight_searches_route_chk check (origin <> destination),
  constraint flight_searches_return_chk check (
    (trip_type = 'oneway' and return_date is null)
    or (trip_type = 'roundtrip' and return_date is not null and return_date >= departure_date)
  )
);
-- Seed legacy One-Way and Return rows before altering the constraints.
insert into flight_searches(origin,destination,departure_date,trip_type) values('DEL','BOM','2026-11-01','oneway');
insert into flight_searches(origin,destination,departure_date,return_date,trip_type) values('DEL','BOM','2026-11-01','2026-11-05','roundtrip');
\ir ../db/migrations/0029_flight_trip_type_multicity.sql
\ir ../db/migrations/0030_flight_search_multicity_routes.sql
-- Circular multi-city is valid; the legacy origin<>destination rule is widened.
insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');
do $$
begin
  if (select count(*) from public.flight_searches) <> 3
     or (select count(*) from public.flight_searches where trip_type = 'oneway' and routes is null) <> 1
     or (select count(*) from public.flight_searches where trip_type = 'roundtrip' and routes is null) <> 1
     or (select count(*) from public.flight_searches where trip_type = 'multicity') <> 1 then
    raise exception 'Expected all 3 valid rows (One-Way, Return, multi-city) to succeed';
  end if;
  -- Verify legacy rows remain writable under the migrated constraints too.
  update public.flight_searches set origin = origin where trip_type in ('oneway', 'roundtrip');
  raise notice 'PASS: 3/3 valid rows; existing One-Way/Return preserved and writable';
end;
$$;

-- Each attempted write runs in an exception subtransaction. Only the expected
-- constraint/route-validation errors count as rejection; other errors escape.
-- An unexpectedly accepted write raises OUTSIDE the exception handler.
do $regression$
declare
  test_case record;
  rejected boolean;
  rejected_count integer := 0;
begin
  for test_case in
    select * from (values
      ('missing origin', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');$sql$),
      ('null origin', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":null,"to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');$sql$),
      ('missing date', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');$sql$),
      ('impossible calendar date', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-02-28','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-02-28"},{"from":"BOM","to":"DEL","travelDate":"2026-02-30"}]');$sql$),
      ('invalid month', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-13-01"}]');$sql$),
      ('nonchronological legs', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-05','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-05"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');$sql$),
      ('destination summary mismatch', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','GOI','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');$sql$),
      ('non-array routes', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','{"from":"DEL"}');$sql$),
      ('too few legs', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"}]');$sql$),
      ('null multicity routes', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity',null);$sql$),
      ('routes on one-way', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','BOM','2026-11-01','oneway','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":"2026-11-03"}]');$sql$),
      ('non-string date', $sql$insert into flight_searches(origin,destination,departure_date,trip_type,routes) values('DEL','DEL','2026-11-01','multicity','[{"from":"DEL","to":"BOM","travelDate":"2026-11-01"},{"from":"BOM","to":"DEL","travelDate":20261103}]');$sql$),
      ('departure summary mismatch', $sql$update flight_searches set departure_date='2026-11-02' where trip_type='multicity';$sql$)
    ) as cases(label, statement)
  loop
    rejected := false;
    begin
      execute test_case.statement;
    exception
      when check_violation then
        if sqlerrm not like '%flight_searches_return_chk%' then
          raise;
        end if;
        rejected := true;
      when raise_exception then
        if sqlerrm not like 'invalid routes%' and sqlerrm not like 'routes %' then
          raise;
        end if;
        rejected := true;
    end;
    if not rejected then
      raise exception 'FAIL: invalid case was accepted: %', test_case.label;
    end if;
    rejected_count := rejected_count + 1;
    raise notice 'PASS: rejected invalid case %/13: %', rejected_count, test_case.label;
  end loop;
  if rejected_count <> 13 then
    raise exception 'Expected 13 rejections, got %', rejected_count;
  end if;
  if (select count(*) from public.flight_searches) <> 3
     or (select departure_date from public.flight_searches where trip_type = 'multicity')
        is distinct from date '2026-11-01' then
    raise exception 'Rejected writes must leave the 3 valid rows unchanged';
  end if;
  raise notice 'PASS: 13/13 invalid cases rejected; 3/3 valid rows retained';
end;
$regression$;
select version() as isolated_postgresql_version;
select count(*) as valid_rows_retained from public.flight_searches;
