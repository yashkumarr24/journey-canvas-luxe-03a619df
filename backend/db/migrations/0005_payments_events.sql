-- ---------------------------------------------------------------------------
-- 0005_payments_events.sql
-- Payment records (gateway references only) + booking lifecycle audit trail.
--
-- NEVER stored here: card number, CVV, expiry, UPI PIN, bank password,
-- Razorpay key secret, webhook secret, or any provider credential.
-- Only gateway-issued identifiers and normalized amounts.
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings(id) on delete restrict,
  provider            public.provider_code not null default 'razorpay',
  provider_order_id   text,
  provider_payment_id text,
  provider_refund_id  text,
  method              text,                 -- 'card' | 'upi' | 'netbanking' ... (label only)
  status              public.payment_status not null default 'created',
  amount              numeric(12,2) not null,
  amount_refunded     numeric(12,2) not null default 0,
  currency            char(3) not null default 'INR',
  failure_reason      text,                 -- gateway-provided, non-sensitive
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint payments_amount_chk          check (amount >= 0),
  constraint payments_refund_chk          check (amount_refunded >= 0 and amount_refunded <= amount),
  constraint payments_currency_chk        check (currency ~ '^[A-Z]{3}$'),
  constraint payments_captured_ref_chk    check (status <> 'captured' or provider_payment_id is not null)
);

comment on table public.payments is
  'Gateway references and amounts only. No card/UPI/bank credentials are ever persisted.';

create index if not exists payments_booking_id_idx on public.payments (booking_id);
create unique index if not exists payments_provider_payment_id_idx
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;
create index if not exists payments_provider_order_id_idx on public.payments (provider_order_id)
  where provider_order_id is not null;
create index if not exists payments_status_idx on public.payments (status);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

grant select on public.payments to authenticated;   -- read-own only, per RLS
grant all on public.payments to service_role;

alter table public.payments enable row level security;

-- ---------------------------------------------------------------------------
-- booking_events: append-only lifecycle/audit log. Internal — never returned
-- to ordinary users. metadata must stay free of secrets and passport data.
-- ---------------------------------------------------------------------------

create table if not exists public.booking_events (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings(id) on delete cascade,
  event_type         text not null,
  status             public.booking_status,
  message            text,
  provider_reference text,
  actor              text not null default 'system',   -- 'system' | 'customer' | 'staff'
  metadata           jsonb,
  created_at         timestamptz not null default now(),
  constraint booking_events_type_chk check (event_type in (
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
    'note'
  )),
  constraint booking_events_actor_chk    check (actor in ('system', 'customer', 'staff')),
  constraint booking_events_metadata_chk check (metadata is null or jsonb_typeof(metadata) = 'object')
);

create index if not exists booking_events_booking_id_idx on public.booking_events (booking_id);
create index if not exists booking_events_created_at_idx on public.booking_events (created_at desc);

-- Internal audit data: no grants to anon/authenticated at all.
grant all on public.booking_events to service_role;

alter table public.booking_events enable row level security;

-- ---------------------------------------------------------------------------
-- provider_debug_logs: OPTIONAL, short-lived, service_role only.
-- Redacted provider snapshots for incident debugging. Retention enforced by a
-- scheduled purge (see README). Never contains credentials or passport data.
-- ---------------------------------------------------------------------------

create table if not exists public.provider_debug_logs (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid references public.bookings(id) on delete cascade,
  provider      public.provider_code not null default 'tripjack',
  operation     text not null,
  http_status   int,
  redacted_body jsonb,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '30 days'),
  constraint provider_debug_logs_body_chk check (redacted_body is null or jsonb_typeof(redacted_body) = 'object')
);

create index if not exists provider_debug_logs_booking_id_idx on public.provider_debug_logs (booking_id);
create index if not exists provider_debug_logs_expires_at_idx on public.provider_debug_logs (expires_at);

grant all on public.provider_debug_logs to service_role;
alter table public.provider_debug_logs enable row level security;
