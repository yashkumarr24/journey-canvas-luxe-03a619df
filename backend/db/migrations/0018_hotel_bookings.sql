-- ---------------------------------------------------------------------------
-- 0018_hotel_bookings.sql   (additive — touches no existing table)
--
-- Server-side lifecycle for TripJack Hotel API v3 Book / Booking Details /
-- Confirm Hold / Cancel, plus a certification evidence log.
--
-- FastAPI (service_role) owns every read and write. RLS is enabled with no
-- client policy, so the publishable key can never read these rows.
-- PAN / passport numbers are held only between guest capture and the Book
-- call, then scrubbed from `guests` (see services/hotel_booking.py).
-- ---------------------------------------------------------------------------

create table if not exists public.hotel_bookings (
  id                         uuid primary key default gen_random_uuid(),
  booking_reference          text not null unique,
  review_token               text not null unique,       -- one booking per review session
  user_id                    uuid references auth.users(id) on delete set null,
  guest_token_hash           text,

  status                     text not null default 'DRAFT' check (status in (
    'DRAFT','REVIEWED','BOOKING_IN_PROGRESS','CONFIRMED','ON_HOLD','CONFIRMING',
    'FAILED','ABORTED','CANCELLATION_REQUESTED','CANCELLATION_PENDING','CANCELLED')),
  previous_status            text,
  mode                       text check (mode in ('instant','hold')),
  idempotency_key            text,

  -- Provider-only handles (never returned to the browser).
  provider_search_id         text,
  provider_hotel_id          text not null,
  provider_option_id         text not null,
  provider_booking_id        text,
  provider_status            text,

  nationality                text,
  currency                   text not null default 'INR',
  total_amount               numeric(12,2) not null,      -- authoritative (Review)
  provider_order_amount      numeric(12,2),

  hotel                      jsonb not null default '{}'::jsonb,
  room                       jsonb not null default '{}'::jsonb,
  stay                       jsonb not null default '{}'::jsonb,
  requirements               jsonb not null default '{}'::jsonb,
  guests                     jsonb not null default '[]'::jsonb,
  contact                    jsonb not null default '{}'::jsonb,
  special_requests           text,

  hold_deadline              timestamptz,
  hotel_confirmation_number  text,
  cancellation               jsonb,
  status_message             text,

  booked_at                  timestamptz,
  last_checked_at            timestamptz,
  confirmed_at               timestamptz,
  cancelled_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create unique index if not exists hotel_bookings_idem_idx
  on public.hotel_bookings (idempotency_key) where idempotency_key is not null;
create index if not exists hotel_bookings_user_idx on public.hotel_bookings (user_id);
create index if not exists hotel_bookings_status_idx on public.hotel_bookings (status);

create table if not exists public.hotel_booking_events (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.hotel_bookings(id) on delete cascade,
  from_status   text,
  to_status     text not null,
  event         text not null,
  meta          jsonb not null default '{}'::jsonb,   -- sanitised; no PII / secrets
  created_at    timestamptz not null default now()
);
create index if not exists hotel_booking_events_booking_idx on public.hotel_booking_events (booking_id, created_at);

create table if not exists public.hotel_certification_runs (
  id                   uuid primary key default gen_random_uuid(),
  case_code            text not null,
  booking_reference    text,
  request_summary      jsonb not null default '{}'::jsonb,   -- field names/types only
  response_summary     jsonb not null default '{}'::jsonb,   -- sanitised
  provider_booking_id  text,            -- needed for TripJack certification submission
  confirmation_number  text,            -- as returned by TripJack; never invented
  final_status         text,
  cancellation_status  text,
  notes                text,
  evidence             jsonb not null default '{}'::jsonb,
  recorded_at          timestamptz not null default now()
);
create index if not exists hotel_certification_runs_case_idx on public.hotel_certification_runs (case_code, recorded_at);

grant all on public.hotel_bookings to service_role;
grant all on public.hotel_booking_events to service_role;
grant all on public.hotel_certification_runs to service_role;

alter table public.hotel_bookings enable row level security;
alter table public.hotel_booking_events enable row level security;
alter table public.hotel_certification_runs enable row level security;
-- No anon/authenticated policies on purpose.
