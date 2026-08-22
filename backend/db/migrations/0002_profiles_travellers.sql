-- ---------------------------------------------------------------------------
-- 0002_profiles_travellers.sql
-- Application-level user profile + traveller (passenger) records.
-- No credentials, no passwords: authentication stays in auth.users.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  first_name  text,
  last_name   text,
  email       citext,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_phone_format_chk check (phone is null or phone ~ '^\+?[0-9 \-]{6,20}$'),
  constraint profiles_email_format_chk check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table public.profiles is 'Profile data only. Never store passwords or auth secrets here.';

create index if not exists profiles_user_id_idx on public.profiles (user_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- travellers
-- Passport data is highly sensitive: nullable, written only when the actual
-- booking requires it, never logged, never placed in URLs, never exposed to
-- anon. Columns are plain text today; the *_enc/token migration path is
-- documented in backend/db/README.md so encryption can be added without a
-- schema redesign.
-- ---------------------------------------------------------------------------

create table if not exists public.travellers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  first_name       text not null,
  last_name        text not null,
  date_of_birth    date,
  gender           text,
  nationality      char(2),
  passport_number  text,
  passport_expiry  date,
  passport_country char(2),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint travellers_first_name_chk check (length(btrim(first_name)) between 1 and 100),
  constraint travellers_last_name_chk  check (length(btrim(last_name))  between 1 and 100),
  constraint travellers_gender_chk     check (gender is null or gender in ('male', 'female', 'other')),
  constraint travellers_dob_chk        check (date_of_birth is null or date_of_birth <= current_date),
  constraint travellers_nationality_chk check (nationality is null or nationality ~ '^[A-Z]{2}$'),
  constraint travellers_passport_country_chk check (passport_country is null or passport_country ~ '^[A-Z]{2}$'),
  -- a passport number is meaningless without its issuing country + expiry
  constraint travellers_passport_complete_chk check (
    passport_number is null
    or (passport_country is not null and passport_expiry is not null)
  )
);

comment on column public.travellers.passport_number is
  'Sensitive. Collect only when the provider requires it; never log or expose in URLs.';

create index if not exists travellers_user_id_idx on public.travellers (user_id);

drop trigger if exists travellers_set_updated_at on public.travellers;
create trigger travellers_set_updated_at
  before update on public.travellers
  for each row execute function public.set_updated_at();

grant select, insert, update on public.travellers to authenticated;
grant all on public.travellers to service_role;

alter table public.travellers enable row level security;
