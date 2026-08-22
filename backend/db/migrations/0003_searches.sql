-- ---------------------------------------------------------------------------
-- 0003_searches.sql
-- Search analytics. Non-identifying by design: no names, emails or phones.
-- Rows are short-lived operational data (see retention note in README).
-- ---------------------------------------------------------------------------

create table if not exists public.flight_searches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete set null,
  origin         char(3) not null,
  destination    char(3) not null,
  departure_date date not null,
  return_date    date,
  trip_type      public.trip_type not null,
  adults         smallint not null default 1,
  children       smallint not null default 0,
  infants        smallint not null default 0,
  cabin_class    public.cabin_class not null default 'economy',
  currency       char(3) not null default 'INR',
  created_at     timestamptz not null default now(),
  constraint flight_searches_origin_chk       check (origin ~ '^[A-Z]{3}$'),
  constraint flight_searches_destination_chk  check (destination ~ '^[A-Z]{3}$'),
  constraint flight_searches_route_chk        check (origin <> destination),
  constraint flight_searches_adults_chk       check (adults between 1 and 9),
  constraint flight_searches_children_chk     check (children between 0 and 9),
  constraint flight_searches_infants_chk      check (infants between 0 and adults),
  constraint flight_searches_pax_total_chk    check (adults + children <= 9),
  constraint flight_searches_currency_chk     check (currency ~ '^[A-Z]{3}$'),
  constraint flight_searches_return_chk       check (
    (trip_type = 'oneway'    and return_date is null)
    or (trip_type = 'roundtrip' and return_date is not null and return_date >= departure_date)
  )
);

create index if not exists flight_searches_user_id_idx    on public.flight_searches (user_id);
create index if not exists flight_searches_created_at_idx on public.flight_searches (created_at desc);
create index if not exists flight_searches_route_idx      on public.flight_searches (origin, destination, departure_date);

grant all on public.flight_searches to service_role;
alter table public.flight_searches enable row level security;

-- ---------------------------------------------------------------------------

create table if not exists public.hotel_searches (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  destination  text not null,
  check_in     date not null,
  check_out    date not null,
  rooms        smallint not null default 1,
  adults       smallint not null default 1,
  children     smallint not null default 0,
  -- Per-room occupancy varies in shape; a small validated JSON array is the
  -- right trade-off vs. a child table for pure analytics data.
  -- Example: [{"adults":2,"childAges":[7]}]
  occupancy    jsonb,
  currency     char(3) not null default 'INR',
  created_at   timestamptz not null default now(),
  constraint hotel_searches_destination_chk check (length(btrim(destination)) between 2 and 120),
  constraint hotel_searches_dates_chk       check (check_out > check_in),
  constraint hotel_searches_rooms_chk       check (rooms between 1 and 9),
  constraint hotel_searches_adults_chk      check (adults between 1 and 30),
  constraint hotel_searches_children_chk    check (children between 0 and 30),
  constraint hotel_searches_currency_chk    check (currency ~ '^[A-Z]{3}$'),
  constraint hotel_searches_occupancy_chk   check (occupancy is null or jsonb_typeof(occupancy) = 'array')
);

create index if not exists hotel_searches_user_id_idx    on public.hotel_searches (user_id);
create index if not exists hotel_searches_created_at_idx on public.hotel_searches (created_at desc);

grant all on public.hotel_searches to service_role;
alter table public.hotel_searches enable row level security;

-- ---------------------------------------------------------------------------
-- Search RESULT references.
-- We deliberately do NOT persist full provider result sets. Only the opaque
-- provider tokens needed to re-price/book, plus the normalized price, with a
-- hard expiry so stale quotes can never be booked.
-- ---------------------------------------------------------------------------

create table if not exists public.search_result_refs (
  id                uuid primary key default gen_random_uuid(),
  search_kind       public.booking_type not null,
  flight_search_id  uuid references public.flight_searches(id) on delete cascade,
  hotel_search_id   uuid references public.hotel_searches(id)  on delete cascade,
  provider          public.provider_code not null default 'tripjack',
  provider_ref      text not null,           -- opaque fare/room token
  total_amount      numeric(12,2) not null,
  currency          char(3) not null default 'INR',
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now(),
  constraint search_result_refs_amount_chk   check (total_amount >= 0),
  constraint search_result_refs_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint search_result_refs_parent_chk   check (
    (search_kind = 'flight' and flight_search_id is not null and hotel_search_id is null)
    or (search_kind = 'hotel' and hotel_search_id is not null and flight_search_id is null)
  )
);

create index if not exists search_result_refs_flight_idx  on public.search_result_refs (flight_search_id);
create index if not exists search_result_refs_hotel_idx   on public.search_result_refs (hotel_search_id);
create index if not exists search_result_refs_expires_idx on public.search_result_refs (expires_at);

grant all on public.search_result_refs to service_role;
alter table public.search_result_refs enable row level security;
