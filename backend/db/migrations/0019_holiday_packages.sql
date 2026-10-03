-- ---------------------------------------------------------------------------
-- 0019_holiday_packages.sql   (additive — touches no existing table)
--
-- Holiday package catalogue imported from source DOCX files:
--   destinations → packages → package_options → package_option_hotels
--   plus itinerary, inclusions/exclusions, images, flights, notes,
--   departures and enquiries.
--
-- Prices are INDICATIVE only. There is no booking status, payment field or
-- provider handle here: packages are enquiry-only.
--
-- Writes: FastAPI (service_role) only. Reads: anon/authenticated may SELECT
-- published content. package_sources is internal. Enquiries are inserted by
-- FastAPI (validated + rate-limited); a signed-in user may read their own.
-- ---------------------------------------------------------------------------

-- prerequisites (idempotent; this database may not have 0001 applied)
create extension if not exists citext;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---- destinations ----------------------------------------------------------
create table if not exists public.destinations (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  country         text not null,
  region          text not null check (region in ('domestic','international')),
  state_or_area   text,
  hero_image_url  text,
  summary         text,
  sort_order      integer not null default 0,
  is_published    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---- source files (internal provenance) -----------------------------------
create table if not exists public.package_sources (
  id                 uuid primary key default gen_random_uuid(),
  original_filename  text not null unique,
  file_checksum      text not null,
  parsed_at          timestamptz,
  parse_status       text not null default 'pending'
                     check (parse_status in ('pending','parsed','needs_review','failed')),
  parse_warnings     jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---- packages --------------------------------------------------------------
create table if not exists public.packages (
  id                     uuid primary key default gen_random_uuid(),
  destination_id         uuid not null references public.destinations(id) on delete restrict,
  source_id              uuid references public.package_sources(id) on delete set null,
  package_code           text unique,
  name                   text not null,
  slug                   text not null unique,
  duration_nights        smallint check (duration_nights >= 0),
  duration_days          smallint check (duration_days >= 0),
  departure_city         text,
  travel_validity_from   date,
  travel_validity_to     date,
  indicative_price_from  numeric(12,2) check (indicative_price_from >= 0),
  currency               char(3) not null default 'INR',
  price_basis            text,
  meal_plan              text,
  overview               text,
  highlights             text[] not null default '{}',
  is_published           boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (travel_validity_to is null or travel_validity_from is null
         or travel_validity_to >= travel_validity_from)
);

-- ---- options (hotel/pricing tiers) ----------------------------------------
create table if not exists public.package_options (
  id                 uuid primary key default gen_random_uuid(),
  package_id         uuid not null references public.packages(id) on delete cascade,
  option_name        text not null,
  sort_order         integer not null default 0,
  indicative_price   numeric(12,2) check (indicative_price >= 0),
  currency           char(3) not null default 'INR',
  price_basis        text,
  child_price_notes  text,
  single_supplement  numeric(12,2) check (single_supplement >= 0),
  valid_from         date,
  valid_to           date,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.package_option_hotels (
  id           uuid primary key default gen_random_uuid(),
  option_id    uuid not null references public.package_options(id) on delete cascade,
  city         text,
  hotel_name   text not null,
  star_rating  smallint check (star_rating between 1 and 7),
  room_type    text,
  nights       smallint check (nights >= 0),
  meal_plan    text,
  is_similar   boolean not null default false,
  sort_order   integer not null default 0
);

-- ---- package detail children ----------------------------------------------
create table if not exists public.package_itinerary_days (
  id              uuid primary key default gen_random_uuid(),
  package_id      uuid not null references public.packages(id) on delete cascade,
  day_number      smallint not null check (day_number >= 1),
  title           text not null,
  description     text,
  meals           text[] not null default '{}',
  overnight_city  text,
  unique (package_id, day_number)
);

create table if not exists public.package_inclusions (
  id          uuid primary key default gen_random_uuid(),
  package_id  uuid not null references public.packages(id) on delete cascade,
  kind        text not null check (kind in ('inclusion','exclusion')),
  text        text not null,
  sort_order  integer not null default 0
);

create table if not exists public.package_images (
  id          uuid primary key default gen_random_uuid(),
  package_id  uuid not null references public.packages(id) on delete cascade,
  url         text not null,
  alt         text,
  is_cover    boolean not null default false,
  sort_order  integer not null default 0
);

create table if not exists public.package_flights (
  id           uuid primary key default gen_random_uuid(),
  package_id   uuid not null references public.packages(id) on delete cascade,
  option_id    uuid references public.package_options(id) on delete cascade,
  sector       text,
  airline      text,
  flight_no    text,
  depart_time  text,
  arrive_time  text,
  is_included  boolean not null default true,
  notes        text,
  sort_order   integer not null default 0
);

create table if not exists public.package_notes (
  id          uuid primary key default gen_random_uuid(),
  package_id  uuid not null references public.packages(id) on delete cascade,
  kind        text not null check (kind in ('visa','gst','tcs','payment','cancellation','other')),
  text        text not null,
  sort_order  integer not null default 0
);

create table if not exists public.package_departures (
  id              uuid primary key default gen_random_uuid(),
  package_id      uuid not null references public.packages(id) on delete cascade,
  departure_date  date not null,
  seats_note      text,
  price_override  numeric(12,2) check (price_override >= 0),
  unique (package_id, departure_date)
);

-- ---- enquiries (no booking, no payment) -----------------------------------
create table if not exists public.package_enquiries (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid not null references public.packages(id) on delete restrict,
  option_id     uuid references public.package_options(id) on delete set null,
  user_id       uuid references auth.users(id) on delete set null,
  name          text not null check (char_length(name) between 1 and 120),
  email         citext,
  phone         text,
  travel_month  text,
  adults        smallint not null default 2 check (adults between 1 and 30),
  children      smallint not null default 0 check (children between 0 and 30),
  message       text check (message is null or char_length(message) <= 2000),
  status        text not null default 'new'
                check (status in ('new','contacted','quoted','closed')),
  source        text not null default 'web' check (source in ('web','whatsapp')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (email is not null or phone is not null)
);

-- ---- indexes ---------------------------------------------------------------
create index if not exists destinations_region_pub_idx    on public.destinations (region, is_published, sort_order);
create index if not exists packages_destination_idx        on public.packages (destination_id);
create index if not exists packages_source_idx             on public.packages (source_id);
create index if not exists packages_published_idx          on public.packages (is_published, destination_id);
create index if not exists package_options_package_idx     on public.package_options (package_id, sort_order);
create index if not exists package_option_hotels_opt_idx   on public.package_option_hotels (option_id, sort_order);
create index if not exists package_inclusions_package_idx  on public.package_inclusions (package_id, kind, sort_order);
create index if not exists package_images_package_idx      on public.package_images (package_id, sort_order);
create index if not exists package_flights_package_idx     on public.package_flights (package_id);
create index if not exists package_notes_package_idx       on public.package_notes (package_id, kind);
create index if not exists package_enquiries_package_idx   on public.package_enquiries (package_id, created_at desc);
create index if not exists package_enquiries_user_idx      on public.package_enquiries (user_id);
create index if not exists package_enquiries_status_idx    on public.package_enquiries (status, created_at desc);

-- ---- updated_at triggers ---------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['destinations','package_sources','packages','package_options','package_enquiries'] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---- grants ----------------------------------------------------------------
grant select on public.destinations, public.packages, public.package_options,
               public.package_option_hotels, public.package_itinerary_days,
               public.package_inclusions, public.package_images, public.package_flights,
               public.package_notes, public.package_departures
  to anon, authenticated;
grant select on public.package_enquiries to authenticated;
grant all on public.destinations, public.package_sources, public.packages,
             public.package_options, public.package_option_hotels,
             public.package_itinerary_days, public.package_inclusions,
             public.package_images, public.package_flights, public.package_notes,
             public.package_departures, public.package_enquiries
  to service_role;

-- ---- RLS -------------------------------------------------------------------
alter table public.destinations           enable row level security;
alter table public.package_sources        enable row level security;  -- no client policy
alter table public.packages               enable row level security;
alter table public.package_options        enable row level security;
alter table public.package_option_hotels  enable row level security;
alter table public.package_itinerary_days enable row level security;
alter table public.package_inclusions     enable row level security;
alter table public.package_images         enable row level security;
alter table public.package_flights        enable row level security;
alter table public.package_notes          enable row level security;
alter table public.package_departures     enable row level security;
alter table public.package_enquiries      enable row level security;

-- Published-package check, security definer so child policies don't recurse.
create or replace function public.is_package_published(p_package_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.packages p
    join public.destinations d on d.id = p.destination_id
    where p.id = p_package_id and p.is_published and d.is_published
  );
$$;
revoke all on function public.is_package_published(uuid) from public;
grant execute on function public.is_package_published(uuid) to anon, authenticated, service_role;

drop policy if exists destinations_public_read on public.destinations;
create policy destinations_public_read on public.destinations
  for select to anon, authenticated using (is_published);

drop policy if exists packages_public_read on public.packages;
create policy packages_public_read on public.packages
  for select to anon, authenticated using (public.is_package_published(id));

do $$
declare t text;
begin
  foreach t in array array['package_options','package_itinerary_days','package_inclusions',
                           'package_images','package_flights','package_notes','package_departures'] loop
    execute format('drop policy if exists %I_public_read on public.%I', t, t);
    execute format('create policy %I_public_read on public.%I for select to anon, authenticated
                    using (public.is_package_published(package_id))', t, t);
  end loop;
end $$;

drop policy if exists package_option_hotels_public_read on public.package_option_hotels;
create policy package_option_hotels_public_read on public.package_option_hotels
  for select to anon, authenticated using (
    exists (select 1 from public.package_options o
            where o.id = option_id and public.is_package_published(o.package_id))
  );

drop policy if exists package_enquiries_read_own on public.package_enquiries;
create policy package_enquiries_read_own on public.package_enquiries
  for select to authenticated using (user_id = auth.uid());
