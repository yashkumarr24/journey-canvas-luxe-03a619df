-- ---------------------------------------------------------------------------
-- 0022_enquiries.sql   (additive — touches no existing table)
--
-- Website enquiry inbox for the Fly n Feel site. The website server
-- (Vercel) inserts rows with the service role; public visitors can submit
-- but can never read or list enquiries.
-- ---------------------------------------------------------------------------

create extension if not exists citext;

create table if not exists public.enquiries (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        citext not null,
  phone        text,
  service      text not null default 'general',
  destination  text,
  message      text,
  source_page  text not null default 'contact',
  status       text not null default 'new',
  created_at   timestamptz not null default now()
);

create index if not exists enquiries_created_at_idx on public.enquiries (created_at desc);
create index if not exists enquiries_status_idx on public.enquiries (status);

-- Data API access: visitors may INSERT only; the website server uses
-- service_role for the actual write. No SELECT/UPDATE/DELETE for anon or
-- authenticated — enquiries are never readable through the API.
grant insert on public.enquiries to anon, authenticated;
grant all on public.enquiries to service_role;

alter table public.enquiries enable row level security;

-- Public visitors (and signed-in users) may submit an enquiry.
create policy enquiries_public_insert
  on public.enquiries for insert
  to anon, authenticated
  with check (true);

-- Deliberately no SELECT/UPDATE/DELETE policies: nobody can read, list,
-- change or delete enquiries through the Data API. Administration happens
-- with the service role or direct database access.
