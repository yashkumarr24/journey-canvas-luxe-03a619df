-- ---------------------------------------------------------------------------
-- 0023_payu_payments.sql  (additive)
-- PayU Hosted Checkout support: txnid / mihpayid references, verification
-- audit, idempotent refunds, webhook de-duplication, guest booking ownership.
-- Never stores card, UPI, bank data, hashes or the merchant salt.
-- ---------------------------------------------------------------------------

alter type public.provider_code add value if not exists 'payu';

alter table public.payments
  add column if not exists txnid               text,
  add column if not exists provider_mihpayid   text,
  add column if not exists verified_at         timestamptz,
  add column if not exists verification_source text,
  add column if not exists raw_status          text;

do $$ begin
  alter table public.payments add constraint payments_verification_source_chk
    check (verification_source is null or verification_source in ('return', 'webhook', 'reconcile'));
exception when duplicate_object then null; end $$;

create unique index if not exists payments_txnid_idx on public.payments (txnid) where txnid is not null;
create unique index if not exists payments_mihpayid_idx on public.payments (provider_mihpayid)
  where provider_mihpayid is not null;
-- At most one live (created/pending/captured) PayU payment per booking.
create unique index if not exists payments_one_open_payu_per_booking_idx
  on public.payments (booking_id) where provider = 'payu' and status in ('created', 'pending', 'captured');

-- Guest bookings: ownership via hashed opaque token (never the raw token).
alter table public.bookings add column if not exists guest_token_hash text;

create table if not exists public.payment_refunds (
  id                  uuid primary key default gen_random_uuid(),
  payment_id          uuid not null references public.payments(id) on delete restrict,
  amount              numeric(12,2) not null,
  request_token       text not null unique,
  provider_request_id text,
  status              text not null default 'requested',
  reason              text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint payment_refunds_amount_chk check (amount > 0),
  constraint payment_refunds_status_chk check (status in ('requested', 'queued', 'rejected', 'unknown', 'success', 'failed'))
);
create index if not exists payment_refunds_payment_idx on public.payment_refunds (payment_id);

drop trigger if exists payment_refunds_set_updated_at on public.payment_refunds;
create trigger payment_refunds_set_updated_at
  before update on public.payment_refunds
  for each row execute function public.set_updated_at();

grant all on public.payment_refunds to service_role;
alter table public.payment_refunds enable row level security;

create table if not exists public.payment_webhook_events (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text not null unique,
  received_at timestamptz not null default now(),
  processed   boolean not null default false
);

grant all on public.payment_webhook_events to service_role;
alter table public.payment_webhook_events enable row level security;
-- No anon/authenticated grants or policies: internal tables only.
