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
-- ISO travelDate. Mirrors the application-level validation so a direct
-- service-role write cannot store a malformed route set.
alter table public.flight_searches add constraint flight_searches_routes_chk check (
  routes is null or (
    jsonb_typeof(routes) = 'array'
    and jsonb_array_length(routes) between 2 and 6
    and (
      select bool_and(
        jsonb_typeof(leg) = 'object'
        and (leg ->> 'from') ~ '^[A-Z]{3}$'
        and (leg ->> 'to') ~ '^[A-Z]{3}$'
        and (leg ->> 'from') <> (leg ->> 'to')
        and (leg ->> 'travelDate') ~ '^\d{4}-\d{2}-\d{2}$'
      )
      from jsonb_array_elements(routes) as leg
    )
  )
);
