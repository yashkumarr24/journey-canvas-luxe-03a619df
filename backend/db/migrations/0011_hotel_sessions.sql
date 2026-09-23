-- ---------------------------------------------------------------------------
-- 0011_hotel_sessions.sql
-- Durable hotel search + review sessions for the TripJack Hotel API v3 funnel.
--
-- Why: between "customer searched" and "customer pays", the ONLY trustworthy
-- copy of the rate, the total payable and the provider handles must live on the
-- server. Until now hotel sessions lived in process memory, so a restart lost
-- them. These tables mirror 0007 (flight_review_sessions) and persist the v3
-- identity chain:  searchId -> optionId -> reviewHash  (-> bookingId later).
--
-- Nothing here is reachable by anon/authenticated roles: FastAPI (service_role)
-- owns every read and write, and RLS is enabled with no client policy, so a
-- leaked publishable key still returns zero rows.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.hotel_review_status as enum (
    'reviewed',             -- provider re-priced, amount unchanged
    'price_changed',        -- provider re-priced, needs explicit consent
    'guests_submitted',     -- guest + contact details captured
    'expired',              -- rate validity elapsed
    'invalid'               -- provider rejected the rate / no longer sellable
  );
exception when duplicate_object then null; end $$;

-- ------------------------------- searches ----------------------------------

create table if not exists public.hotel_search_sessions (
  id                  uuid primary key default gen_random_uuid(),
  -- Opaque handle given to the browser (CSPRNG, never sequential).
  search_token        text not null unique,
  user_id             uuid references auth.users(id) on delete set null,

  provider            public.provider_code not null default 'tripjack',
  -- TripJack Hotel API v3 searchId. Head of the identity chain, server only.
  provider_search_id  text,

  destination         text not null,
  check_in            date not null,
  check_out           date not null,
  nights              smallint not null,
  currency            char(3) not null default 'INR',
  -- Requested occupancy: [{"adults": 2, "childAges": [8]}]. No guest identity.
  room_info           jsonb not null default '[]'::jsonb,
  -- Normalized result snapshot we re-read on detail/selection. Business fields
  -- only: never a raw provider payload.
  results             jsonb not null default '[]'::jsonb,
  result_count        integer not null default 0,

  expires_at          timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint hotel_search_sessions_token_chk    check (length(search_token) between 32 and 128),
  constraint hotel_search_sessions_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint hotel_search_sessions_dates_chk    check (check_out > check_in),
  constraint hotel_search_sessions_nights_chk   check (nights between 1 and 30),
  constraint hotel_search_sessions_rooms_chk    check (jsonb_typeof(room_info) = 'array'),
  constraint hotel_search_sessions_results_chk  check (jsonb_typeof(results) = 'array')
);

comment on table public.hotel_search_sessions is
  'Server-held hotel search context. The browser only ever holds search_token.';
comment on column public.hotel_search_sessions.provider_search_id is
  'TripJack Hotel API v3 searchId. Never returned to the browser.';

create index if not exists hotel_search_sessions_user_idx    on public.hotel_search_sessions (user_id);
create index if not exists hotel_search_sessions_expires_idx on public.hotel_search_sessions (expires_at);

-- -------------------------------- reviews ----------------------------------

create table if not exists public.hotel_review_sessions (
  id                    uuid primary key default gen_random_uuid(),
  review_token          text not null unique,
  -- Guest continuity: hash only, so a stolen row cannot be replayed as a guest.
  guest_token_hash      text,
  user_id               uuid references auth.users(id) on delete set null,

  hotel_search_id       uuid references public.hotel_search_sessions(id) on delete cascade,

  provider              public.provider_code not null default 'tripjack',
  provider_search_id    text,
  -- v3 chain: optionId chosen by the customer, reviewHash returned by review.
  provider_hotel_id     text not null,
  provider_option_id    text not null,
  provider_review_hash  text,
  -- Populated by the booking phase only (oms/v3/hotel/book).
  provider_booking_id   text,

  -- Money is numeric(12,2). `searched_amount` is what the customer was shown;
  -- `total_amount` is the authoritative re-priced amount, mf + mft included.
  searched_amount       numeric(12,2),
  total_amount          numeric(12,2) not null,
  base_amount           numeric(12,2),
  tax_amount            numeric(12,2),
  management_fee        numeric(12,2),
  management_fee_tax    numeric(12,2),
  currency              char(3) not null default 'INR',

  option_type           text,
  rate_plan_type        text,
  guest_count           smallint not null default 0,
  contact_email         text,
  booking_reference     text,

  status                public.hotel_review_status not null default 'reviewed',
  -- Normalized snapshots rendered on the review page. No provider payloads.
  hotel                 jsonb not null default '{}'::jsonb,
  room                  jsonb not null default '{}'::jsonb,
  stay                  jsonb not null default '{}'::jsonb,
  -- What the provider says this rate needs (PAN, passport, ...).
  requirements          jsonb not null default '{}'::jsonb,

  price_accepted_at     timestamptz,
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint hotel_review_sessions_token_chk     check (length(review_token) between 32 and 128),
  constraint hotel_review_sessions_currency_chk  check (currency ~ '^[A-Z]{3}$'),
  constraint hotel_review_sessions_amount_chk    check (total_amount >= 0),
  constraint hotel_review_sessions_option_chk    check (
    option_type is null or option_type in ('SRSM', 'SRCM', 'CRSM', 'CRCM')
  ),
  constraint hotel_review_sessions_plan_chk      check (
    rate_plan_type is null or rate_plan_type in (
      'CHEAPEST', 'FREE_CANCELLATION', 'GST_INCLUSIVE',
      'PAN_NOT_REQUIRED', 'BREAKFAST_INCLUSIVE'
    )
  ),
  constraint hotel_review_sessions_hotel_chk        check (jsonb_typeof(hotel) = 'object'),
  constraint hotel_review_sessions_room_chk         check (jsonb_typeof(room) = 'object'),
  constraint hotel_review_sessions_stay_chk         check (jsonb_typeof(stay) = 'object'),
  constraint hotel_review_sessions_requirements_chk check (jsonb_typeof(requirements) = 'object')
);

comment on table public.hotel_review_sessions is
  'Authoritative server-side hotel rate context between selection and payment.';
comment on column public.hotel_review_sessions.total_amount is
  'Server-authoritative payable amount including mf + mft. A client-submitted amount is never written here.';
comment on column public.hotel_review_sessions.provider_review_hash is
  'TripJack Hotel API v3 reviewHash, required by the booking phase. Never returned to the browser.';

create index if not exists hotel_review_sessions_user_idx    on public.hotel_review_sessions (user_id);
create index if not exists hotel_review_sessions_search_idx  on public.hotel_review_sessions (hotel_search_id);
create index if not exists hotel_review_sessions_expires_idx on public.hotel_review_sessions (expires_at);
create index if not exists hotel_review_sessions_ref_idx     on public.hotel_review_sessions (booking_reference);

drop trigger if exists hotel_search_sessions_set_updated_at on public.hotel_search_sessions;
create trigger hotel_search_sessions_set_updated_at
  before update on public.hotel_search_sessions
  for each row execute function public.set_updated_at();

drop trigger if exists hotel_review_sessions_set_updated_at on public.hotel_review_sessions;
create trigger hotel_review_sessions_set_updated_at
  before update on public.hotel_review_sessions
  for each row execute function public.set_updated_at();

-- FastAPI only. No anon/authenticated grants at all.
grant all on public.hotel_search_sessions to service_role;
grant all on public.hotel_review_sessions to service_role;
alter table public.hotel_search_sessions enable row level security;
alter table public.hotel_review_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- booking_events: allow the hotel funnel events. Additive only — every
-- previously allowed value stays valid.
-- ---------------------------------------------------------------------------

alter table public.booking_events drop constraint if exists booking_events_type_chk;
alter table public.booking_events add constraint booking_events_type_chk check (event_type in (
  'booking_created',
  'payment_initiated',
  'payment_succeeded',
  'payment_failed',
  'provider_booking_requested',
  'provider_booking_confirmed',
  'provider_booking_failed',
  'cancellation_requested',
  'cancelled',
  'refund_initiated',
  'refunded',
  'note',
  'flight_selected',
  'review_started',
  'fare_validated',
  'price_changed',
  'fare_expired',
  'traveller_details_submitted',
  'prebook_validation_failed',
  -- hotel funnel (search -> review -> guests)
  'hotel_selected',
  'hotel_rate_validated',
  'hotel_price_changed',
  'hotel_rate_expired',
  'hotel_guest_details_submitted'
));
