-- ---------------------------------------------------------------------------
-- 0008_analytics_admin.sql  (PHASE 10)
-- Activity tracking, admin roles and analytics aggregates.
--
-- Principles
--   * Nothing here duplicates users, travellers, bookings, payments or
--     flight_searches / hotel_searches. Those tables stay authoritative.
--   * Analytics rows are non-identifying: opaque session id, optional
--     auth.users id, event name, page key and a small validated JSON prop bag.
--     No names, emails, phones, card data, tokens or provider payloads.
--   * Writes come from FastAPI with the service-role key (bypasses RLS).
--   * Reads are admin-only, enforced by has_admin_level() inside RLS policies,
--     so changing frontend code or a request parameter grants nothing.
-- ---------------------------------------------------------------------------

-- ---- admin roles ----------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'admin_role') then
    create type public.admin_role as enum ('staff', 'manager', 'owner');
  end if;
end $$;

-- One row per admin. A customer is NOT an admin: absence of a row = no access.
create table if not exists public.admin_users (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  role          public.admin_role not null default 'staff',
  display_name  text,
  status        text not null default 'active',
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_sign_in_at timestamptz,
  constraint admin_users_status_chk check (status in ('active', 'suspended')),
  constraint admin_users_display_name_chk check (
    display_name is null or length(btrim(display_name)) between 1 and 120
  )
);

create index if not exists admin_users_role_idx on public.admin_users (role);

grant select on public.admin_users to authenticated;
grant all    on public.admin_users to service_role;
alter table public.admin_users enable row level security;

-- Numeric level for comparisons: staff 1, manager 2, owner 3.
create or replace function public.admin_level(_role public.admin_role)
returns smallint
language sql
immutable
as $$
  select case _role
    when 'staff'   then 1
    when 'manager' then 2
    when 'owner'   then 3
  end::smallint
$$;

-- SECURITY DEFINER so policies can call it without recursive RLS on
-- admin_users. This is the ONLY place admin level is decided.
create or replace function public.has_admin_level(_user_id uuid, _minimum smallint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = _user_id
      and status = 'active'
      and public.admin_level(role) >= _minimum
  )
$$;

revoke all on function public.has_admin_level(uuid, smallint) from public;
grant execute on function public.has_admin_level(uuid, smallint) to authenticated, service_role;

-- An admin may read their own row; only an owner (level 3) sees the roster.
drop policy if exists "admin_users_select_self" on public.admin_users;
create policy "admin_users_select_self" on public.admin_users
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "admin_users_select_owner" on public.admin_users;
create policy "admin_users_select_owner" on public.admin_users
  for select to authenticated
  using (public.has_admin_level(auth.uid(), 3::smallint));

-- No client INSERT/UPDATE/DELETE policies at all: role assignment happens only
-- through FastAPI (service_role) after it has verified an owner-level caller.
-- This is what stops privilege escalation by request tampering.

-- ---- user sessions --------------------------------------------------------

create table if not exists public.user_sessions (
  session_id       text primary key,
  user_id          uuid references auth.users(id) on delete set null,
  started_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at         timestamptz,
  current_page     text,
  device_category  text,
  browser          text,
  platform         text,
  status           text not null default 'active',
  constraint user_sessions_id_chk      check (session_id ~ '^[a-zA-Z0-9_\-]{8,64}$'),
  constraint user_sessions_status_chk  check (status in ('active', 'idle', 'ended')),
  constraint user_sessions_device_chk  check (
    device_category is null or device_category in ('desktop', 'tablet', 'mobile')
  ),
  constraint user_sessions_page_chk    check (current_page is null or length(current_page) <= 60),
  constraint user_sessions_browser_chk check (browser is null or length(browser) <= 40),
  constraint user_sessions_platform_chk check (platform is null or length(platform) <= 40)
);

create index if not exists user_sessions_user_id_idx  on public.user_sessions (user_id);
create index if not exists user_sessions_activity_idx on public.user_sessions (last_activity_at desc);
create index if not exists user_sessions_status_idx   on public.user_sessions (status);

grant all on public.user_sessions to service_role;
alter table public.user_sessions enable row level security;

-- Level 1 (staff) and above may read sessions. Customers get nothing.
drop policy if exists "user_sessions_select_admin" on public.user_sessions;
create policy "user_sessions_select_admin" on public.user_sessions
  for select to authenticated
  using (public.has_admin_level(auth.uid(), 1::smallint));

-- ---- activity events ------------------------------------------------------

create table if not exists public.activity_events (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null references public.user_sessions(session_id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  event_name   text not null,
  page         text,
  props        jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint activity_events_name_chk  check (event_name ~ '^[a-z0-9_]{3,60}$'),
  constraint activity_events_page_chk  check (page is null or length(page) <= 60),
  constraint activity_events_props_chk check (
    jsonb_typeof(props) = 'object' and pg_column_size(props) < 2048
  )
);

create index if not exists activity_events_session_idx  on public.activity_events (session_id);
create index if not exists activity_events_user_idx     on public.activity_events (user_id);
create index if not exists activity_events_name_idx     on public.activity_events (event_name);
create index if not exists activity_events_time_idx     on public.activity_events (occurred_at desc);
create index if not exists activity_events_name_time_idx on public.activity_events (event_name, occurred_at desc);

grant all on public.activity_events to service_role;
alter table public.activity_events enable row level security;

drop policy if exists "activity_events_select_admin" on public.activity_events;
create policy "activity_events_select_admin" on public.activity_events
  for select to authenticated
  using (public.has_admin_level(auth.uid(), 1::smallint));

-- No insert/update/delete policies: ingestion is FastAPI-only, so a customer
-- cannot forge, edit or delete activity — theirs or anyone else's.

-- ---- daily aggregates (optional read model) -------------------------------

create table if not exists public.analytics_daily (
  day                 date not null,
  vertical            text not null,
  sessions            integer not null default 0,
  unique_users        integer not null default 0,
  searches            integer not null default 0,
  checkouts           integer not null default 0,
  payments_started    integer not null default 0,
  bookings_completed  integer not null default 0,
  bookings_failed     integer not null default 0,
  updated_at          timestamptz not null default now(),
  primary key (day, vertical),
  constraint analytics_daily_vertical_chk check (vertical in ('flight', 'hotel', 'all'))
);

create index if not exists analytics_daily_day_idx on public.analytics_daily (day desc);

grant all on public.analytics_daily to service_role;
alter table public.analytics_daily enable row level security;

-- Aggregated analytics is level 2 (manager) and above.
drop policy if exists "analytics_daily_select_admin" on public.analytics_daily;
create policy "analytics_daily_select_admin" on public.analytics_daily
  for select to authenticated
  using (public.has_admin_level(auth.uid(), 2::smallint));

-- ---- retention note -------------------------------------------------------
-- Raw activity is operational data. Once pg_cron is available:
--   delete from public.activity_events where occurred_at < now() - interval '90 days';
--   delete from public.user_sessions   where last_activity_at < now() - interval '90 days';
-- Aggregates in analytics_daily are kept indefinitely.
