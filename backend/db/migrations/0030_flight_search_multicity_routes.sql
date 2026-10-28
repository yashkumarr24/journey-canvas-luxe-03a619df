-- ---------------------------------------------------------------------------
-- 0030_flight_search_multicity_routes.sql
-- Record multi-city flight searches (Flight API v2.0: 2-6 routeInfos).
--
-- Additive only:
--   * new nullable `routes` jsonb column holds the ordered legs; existing
--     scalar columns (origin/destination/dates) stay populated as the search
--     summary (first origin, last destination, first travel date), so
--     historical rows and every existing reader keep working unchanged.
--   * the route/return CHECK constraints are re-created with a multicity
--     branch; every previously valid row remains valid (the change only
--     widens what is accepted).
--
-- Requires migration 0029 (enum value 'multicity') to be applied first.
-- ---------------------------------------------------------------------------

alter table public.flight_searches
  add column if not exists routes jsonb;

comment on column public.flight_searches.routes is
  'Ordered multi-city legs [{"from","to","travelDate"}] for trip_type=multicity; NULL for oneway/roundtrip.';

-- Circular multi-city trips (e.g. DEL->BOM->DEL) legitimately end where they
-- start, so the origin<>destination rule applies only to oneway/roundtrip.
alter table public.flight_searches drop constraint if exists flight_searches_route_chk;
alter table public.flight_searches add constraint flight_searches_route_chk check (
  trip_type = 'multicity' or origin <> destination
);

alter table public.flight_searches drop constraint if exists flight_searches_return_chk;
alter table public.flight_searches add constraint flight_searches_return_chk check (
  (trip_type = 'oneway'    and return_date is null and routes is null)
  or (trip_type = 'roundtrip' and return_date is not null and return_date >= departure_date and routes is null)
  or (trip_type = 'multicity' and return_date is null and routes is not null)
);

-- Leg shape: an array of 2-6 objects, each with distinct IATA from/to and an
-- ISO travelDate. PostgreSQL forbids subqueries in CHECK constraints, so the
-- array validation lives in a trigger; it mirrors the application-level
-- validation so a direct service-role write cannot store a malformed route set.
create or replace function public.validate_flight_search_routes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  leg jsonb;
  leg_date date;
  prev_date date;
begin
  if new.routes is null then
    return new;
  end if;
  if jsonb_typeof(new.routes) is distinct from 'array'
     or jsonb_array_length(new.routes) < 2
     or jsonb_array_length(new.routes) > 6 then
    raise exception 'invalid routes: expected an array of 2-6 legs';
  end if;
  for leg in select value from jsonb_array_elements(new.routes) loop
    -- NULL-safe: a missing key or JSON null makes each test NULL, which an
    -- IF would treat as "not true" and silently accept; coalesce to fail.
    if jsonb_typeof(leg) is distinct from 'object'
       or jsonb_typeof(leg -> 'from') is distinct from 'string'
       or jsonb_typeof(leg -> 'to') is distinct from 'string'
       or jsonb_typeof(leg -> 'travelDate') is distinct from 'string'
       or not coalesce((leg ->> 'from') ~ '^[A-Z]{3}$', false)
       or not coalesce((leg ->> 'to') ~ '^[A-Z]{3}$', false)
       or (leg ->> 'from') = (leg ->> 'to')
       or not coalesce((leg ->> 'travelDate') ~ '^\d{4}-\d{2}-\d{2}$', false) then
      raise exception 'invalid routes leg: %', leg;
    end if;
    -- Real calendar date (rejects 2026-02-30) and round-trips exactly.
    begin
      leg_date := to_date(leg ->> 'travelDate', 'YYYY-MM-DD');
    exception when others then
      raise exception 'invalid routes travelDate: %', leg ->> 'travelDate';
    end;
    if to_char(leg_date, 'YYYY-MM-DD') <> (leg ->> 'travelDate') then
      raise exception 'invalid routes travelDate: %', leg ->> 'travelDate';
    end if;
    if prev_date is not null and leg_date < prev_date then
      raise exception 'routes not chronological';
    end if;
    prev_date := leg_date;
  end loop;
  -- Scalar summary columns must mirror the legs (first origin, last
  -- destination, first travel date), as the application derives them.
  if new.origin is distinct from (new.routes -> 0 ->> 'from')
     or new.destination is distinct from (new.routes -> -1 ->> 'to')
     or new.departure_date is distinct from to_date(new.routes -> 0 ->> 'travelDate', 'YYYY-MM-DD') then
    raise exception 'routes do not match origin/destination/departure_date';
  end if;
  return new;
end;
$$;

drop trigger if exists flight_searches_routes_validate on public.flight_searches;
create trigger flight_searches_routes_validate
  before insert or update of routes, origin, destination, departure_date on public.flight_searches
  for each row execute function public.validate_flight_search_routes();
