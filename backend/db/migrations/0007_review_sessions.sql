-- ---------------------------------------------------------------------------
-- 0007_review_sessions.sql  (PHASE 7)
-- Server-held fare review sessions + idempotency scaffolding.
--
-- Why a dedicated table: between "customer clicked Select" and "customer pays"
-- the ONLY trustworthy copy of the itinerary, the fare and the passenger count
-- must live on the server. The browser holds nothing but an opaque token.
--
-- Nothing here is reachable by anon/authenticated roles: FastAPI (service_role)
-- owns every read and write, and RLS is enabled with no client policy so a
-- leaked publishable key still returns zero rows.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.review_status as enum (
    'reviewed',            -- provider re-priced, amount unchanged
    'price_changed',       -- provider re-priced higher/lower, needs consent
    'travellers_submitted',-- traveller + contact details captured
    'expired',             -- fare validity elapsed
    'invalid'              -- provider rejected the fare / no longer sellable
  );
exception when duplicate_object then null; end $$;

create table if not exists public.flight_review_sessions (
  id                    uuid primary key default gen_random_uuid(),
  -- Public handle given to the browser. 43-char CSPRNG token, never an
  -- internal id and never sequential.
  review_token          text not null unique,
  -- Guest continuity: hash only, so a stolen database row cannot be replayed
  -- against the API as a guest session.
  guest_token_hash      text,
  user_id               uuid references auth.users(id) on delete set null,

  flight_search_id      uuid not null references public.flight_searches(id) on delete cascade,
  search_result_ref_id  uuid references public.search_result_refs(id) on delete set null,

  provider              public.provider_code not null default 'tripjack',
  -- Opaque provider fare handle (TripJack priceId) — server side only.
  provider_price_ref    text not null,
  -- Provider pre-book handle returned by the review call (TripJack bookingId).
  provider_booking_ref  text,

  -- Money is numeric(12,2). `searched_amount` is what the customer was shown
  -- at search time; `total_amount` is the authoritative re-priced amount.
  searched_amount       numeric(12,2) not null,
  total_amount          numeric(12,2) not null,
  base_amount           numeric(12,2),
  tax_amount            numeric(12,2),
  currency              char(3) not null default 'INR',

  adults                smallint not null default 1,
  children              smallint not null default 0,
  infants               smallint not null default 0,

  status                public.review_status not null default 'reviewed',
  -- Normalized itinerary snapshot we render on the review page. Business
  -- fields only: never a raw provider payload, never traveller identity data.
  itinerary             jsonb not null default '{}'::jsonb,
  -- What the provider says the booking needs (passport, DOB, ...).
  requirements          jsonb not null default '{}'::jsonb,

  booking_id            uuid references public.bookings(id) on delete set null,

  price_accepted_at     timestamptz,
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint flight_review_sessions_token_chk    check (length(review_token) between 32 and 128),
  constraint flight_review_sessions_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint flight_review_sessions_amount_chk   check (total_amount >= 0 and searched_amount >= 0),
  constraint flight_review_sessions_pax_chk      check (
    adults between 1 and 9 and children between 0 and 9
    and infants between 0 and adults and adults + children <= 9
  ),
  constraint flight_review_sessions_itinerary_chk    check (jsonb_typeof(itinerary) = 'object'),
  constraint flight_review_sessions_requirements_chk check (jsonb_typeof(requirements) = 'object')
);

comment on table public.flight_review_sessions is
  'Authoritative server-side fare context between search and payment. The browser only ever holds review_token.';
comment on column public.flight_review_sessions.total_amount is
  'Server-authoritative payable amount. A client-submitted amount is never written here.';

create index if not exists flight_review_sessions_user_idx    on public.flight_review_sessions (user_id);
create index if not exists flight_review_sessions_search_idx  on public.flight_review_sessions (flight_search_id);
create index if not exists flight_review_sessions_expires_idx on public.flight_review_sessions (expires_at);

drop trigger if exists flight_review_sessions_set_updated_at on public.flight_review_sessions;
create trigger flight_review_sessions_set_updated_at
  before update on public.flight_review_sessions
  for each row execute function public.set_updated_at();

-- FastAPI only. No anon/authenticated grants at all.
grant all on public.flight_review_sessions to service_role;
alter table public.flight_review_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- Idempotency scaffolding (used lightly now, required by the payment phase).
-- Only the SHA-256 of the client key is stored, scoped per operation.
-- ---------------------------------------------------------------------------

create table if not exists public.request_idempotency (
  key_hash    text not null,
  scope       text not null,
  subject     text,                       -- review token / booking id, never PII
  result_ref  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  primary key (scope, key_hash),
  constraint request_idempotency_scope_chk check (length(scope) between 3 and 64)
);

create index if not exists request_idempotency_expires_idx on public.request_idempotency (expires_at);

grant all on public.request_idempotency to service_role;
alter table public.request_idempotency enable row level security;

-- ---------------------------------------------------------------------------
-- booking_events: allow the Phase 7 lifecycle events. Additive only — every
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
  -- PHASE 7
  'flight_selected',
  'review_started',
  'fare_validated',
  'price_changed',
  'fare_expired',
  'traveller_details_submitted',
  'prebook_validation_failed'
));
