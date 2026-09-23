-- 0012 — TripJack Hotel API v3 static content catalogue + sync state.
--
-- Written ONLY by FastAPI (service_role) through the sync service. Browsers get
-- no grants at all: RLS is enabled with no client policy, so the catalogue can
-- neither be read in bulk nor modified from the frontend.
-- Static data here is NEVER authoritative for price or availability.
-- Additive only: no existing table is altered or dropped.

create table if not exists public.hotel_countries (
  name            text primary key,              -- exactly as TripJack returns it
  last_synced_at  timestamptz not null default now()
);

create table if not exists public.hotel_regions (
  city_region_id    text primary key,
  city_name         text,
  region_name       text,
  country_name      text,
  region_type       text,
  full_region_name  text,
  last_synced_at    timestamptz not null default now()
);
create index if not exists hotel_regions_city_idx    on public.hotel_regions (lower(city_name));
create index if not exists hotel_regions_region_idx  on public.hotel_regions (lower(region_name));
create index if not exists hotel_regions_country_idx on public.hotel_regions (country_name);

create table if not exists public.hotel_mappings (
  tj_hotel_id        text primary key,
  unica_id           text,
  region_id          text,                        -- soft link: region may sync later
  country_name       text,
  is_deleted         boolean not null default false,
  deleted_at         timestamptz,
  content_synced_at  timestamptz,                 -- null => static content pending
  content_error_at   timestamptz,
  last_synced_at     timestamptz not null default now()
);
create index if not exists hotel_mappings_region_idx  on public.hotel_mappings (region_id) where not is_deleted;
create index if not exists hotel_mappings_country_idx on public.hotel_mappings (country_name);
create index if not exists hotel_mappings_pending_idx on public.hotel_mappings (tj_hotel_id)
  where content_synced_at is null and not is_deleted;

create table if not exists public.hotels (
  tj_hotel_id     text primary key references public.hotel_mappings (tj_hotel_id) on delete cascade,
  unica_id        text,
  name            text,
  is_active       boolean not null default true,
  star_rating     numeric(3,1),
  property_type   text,
  address         text,
  city            text,
  state           text,
  country         text,
  postal_code     text,
  latitude        double precision,
  longitude       double precision,
  descriptions    jsonb,
  policies        jsonb,
  contact         jsonb,
  deleted_at      timestamptz,
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists hotels_active_idx on public.hotels (tj_hotel_id) where is_active;
create index if not exists hotels_city_idx   on public.hotels (lower(city));

create table if not exists public.hotel_images (
  tj_hotel_id  text not null references public.hotels (tj_hotel_id) on delete cascade,
  position     int  not null,
  url          text not null,
  caption      text,
  primary key (tj_hotel_id, position)
);

create table if not exists public.hotel_amenities (
  tj_hotel_id  text not null references public.hotels (tj_hotel_id) on delete cascade,
  name         text not null,
  primary key (tj_hotel_id, name)
);

create table if not exists public.hotel_rooms (
  tj_hotel_id  text not null references public.hotels (tj_hotel_id) on delete cascade,
  room_key     text not null,
  name         text,
  description  text,
  amenities    jsonb,
  images       jsonb,                             -- room-level image urls
  primary key (tj_hotel_id, room_key)
);

create table if not exists public.hotel_sync_state (
  sync_type          text primary key,            -- full | incremental_new | incremental_update | incremental_delete
  status             text not null default 'idle',-- idle | running | completed | partial | failed
  started_at         timestamptz,
  completed_at       timestamptz,
  last_success_at    timestamptz,
  last_update_time   text,                        -- TripJack lastUpdateTime watermark
  cursor             jsonb,                       -- resumable position
  processed_count    int not null default 0,
  failed_count       int not null default 0,
  error_summary      text,
  updated_at         timestamptz not null default now()
);

create or replace view public.hotel_catalogue_counts as
select
  (select count(*) from public.hotel_countries)                              as countries,
  (select count(*) from public.hotel_regions)                                as regions,
  (select count(*) from public.hotel_mappings)                               as mappings,
  (select count(*) from public.hotel_mappings where content_synced_at is null and not is_deleted) as content_pending,
  (select count(*) from public.hotels where is_active)                       as active_hotels,
  (select count(*) from public.hotels where not is_active)                   as inactive_hotels,
  (select count(*) from public.hotel_mappings where is_deleted)              as deleted_mappings;

-- service_role only.
grant all on public.hotel_countries, public.hotel_regions, public.hotel_mappings,
  public.hotels, public.hotel_images, public.hotel_amenities, public.hotel_rooms,
  public.hotel_sync_state to service_role;
grant select on public.hotel_catalogue_counts to service_role;
revoke all on public.hotel_catalogue_counts from anon, authenticated;

alter table public.hotel_countries  enable row level security;
alter table public.hotel_regions    enable row level security;
alter table public.hotel_mappings   enable row level security;
alter table public.hotels           enable row level security;
alter table public.hotel_images     enable row level security;
alter table public.hotel_amenities  enable row level security;
alter table public.hotel_rooms      enable row level security;
alter table public.hotel_sync_state enable row level security;
