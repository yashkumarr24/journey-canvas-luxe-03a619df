-- ---------------------------------------------------------------------------
-- 0024_payu_fulfilment.sql  (additive; apply AFTER 0023 on the VPS database)
--
-- * Payments can belong to a flight booking (bookings) OR a hotel booking
--   (hotel_bookings) - exactly one.
-- * Durable fulfilment jobs: a verified capture enqueues exactly one job in the
--   SAME transaction (payu_capture), so a crash can never leave a captured
--   payment without a job.
-- * Refund reservation under a row lock (payu_reserve_refund) so concurrent
--   staff requests can never exceed the captured amount.
-- Service-role only. Stores no card/UPI/bank data, hashes or salts.
-- ---------------------------------------------------------------------------

alter table public.payments alter column booking_id drop not null;
alter table public.payments
  add column if not exists hotel_booking_id uuid references public.hotel_bookings(id) on delete restrict;

do $$ begin
  alter table public.payments add constraint payments_one_subject_chk
    check (num_nonnulls(booking_id, hotel_booking_id) = 1);
exception when duplicate_object then null; end $$;

create index if not exists payments_hotel_booking_idx on public.payments (hotel_booking_id);
create unique index if not exists payments_one_open_payu_per_hotel_booking_idx
  on public.payments (hotel_booking_id)
  where provider = 'payu' and status in ('created', 'pending', 'captured');

-- ---- durable fulfilment jobs ---------------------------------------------
create table if not exists public.payment_fulfilment_jobs (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null unique references public.payments(id) on delete restrict,
  subject_type   text not null,
  subject_ref    text not null,
  status         text not null default 'queued',
  attempts       integer not null default 0,
  locked_until   timestamptz,
  last_code      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint payment_fulfilment_jobs_subject_chk check (subject_type in ('flight', 'hotel')),
  constraint payment_fulfilment_jobs_status_chk check (status in (
    'queued', 'running', 'succeeded', 'uncertain', 'failed_confirmed', 'manual_review'))
);
create index if not exists payment_fulfilment_jobs_status_idx
  on public.payment_fulfilment_jobs (status, updated_at);

drop trigger if exists payment_fulfilment_jobs_set_updated_at on public.payment_fulfilment_jobs;
create trigger payment_fulfilment_jobs_set_updated_at
  before update on public.payment_fulfilment_jobs
  for each row execute function public.set_updated_at();

grant all on public.payment_fulfilment_jobs to service_role;
alter table public.payment_fulfilment_jobs enable row level security;

alter table public.payment_refunds add column if not exists last_checked_at timestamptz;

-- ---- atomic capture + enqueue --------------------------------------------
create or replace function public.payu_capture(
  p_payment_id uuid, p_expected text[], p_mihpayid text, p_source text, p_raw_status text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments%rowtype;
begin
  update public.payments
     set status = 'captured', provider_payment_id = p_mihpayid, provider_mihpayid = p_mihpayid,
         verified_at = now(), verification_source = p_source, raw_status = p_raw_status
   where id = p_payment_id and status::text = any (p_expected)
  returning * into v_pay;
  if not found then
    return false;
  end if;

  if v_pay.booking_id is not null then
    update public.bookings set status = 'payment_processing'
     where id = v_pay.booking_id and status in ('pending', 'payment_pending');
    insert into public.payment_fulfilment_jobs (payment_id, subject_type, subject_ref)
    select v_pay.id, 'flight', b.booking_reference from public.bookings b where b.id = v_pay.booking_id
    on conflict (payment_id) do nothing;
  else
    insert into public.payment_fulfilment_jobs (payment_id, subject_type, subject_ref)
    select v_pay.id, 'hotel', h.booking_reference from public.hotel_bookings h where h.id = v_pay.hotel_booking_id
    on conflict (payment_id) do nothing;
  end if;
  return true;
end $$;

-- ---- claim jobs (one worker per job; crashed workers' locks expire) -------
create or replace function public.payu_claim_jobs(p_limit integer, p_lock_seconds integer)
returns setof public.payment_fulfilment_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.payment_fulfilment_jobs j
     set status = 'running', attempts = j.attempts + 1,
         locked_until = now() + make_interval(secs => p_lock_seconds)
   where j.id in (
     select id from public.payment_fulfilment_jobs
      where status in ('queued', 'uncertain')
         or (status = 'running' and locked_until < now())
      order by updated_at
      limit p_limit
      for update skip locked)
  returning j.*;
end $$;

-- ---- refund reservation under a row lock ----------------------------------
create or replace function public.payu_reserve_refund(
  p_payment_id uuid, p_amount numeric, p_token text, p_reason text, p_staff uuid
) returns public.payment_refunds
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments%rowtype;
  v_reserved numeric(12,2);
  v_row public.payment_refunds%rowtype;
begin
  select * into v_row from public.payment_refunds where request_token = p_token;
  if found then
    return v_row;  -- idempotent retry
  end if;
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found or v_pay.status::text not in ('captured', 'partially_refunded') then
    raise exception 'refund_not_allowed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payment_refunds
              where payment_id = p_payment_id and status in ('requested', 'unknown')) then
    raise exception 'refund_unresolved' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into v_reserved from public.payment_refunds
   where payment_id = p_payment_id and status in ('requested', 'queued', 'unknown', 'success');
  if p_amount <= 0 or p_amount > v_pay.amount - v_reserved then
    raise exception 'refund_exceeds_balance' using errcode = 'P0001';
  end if;
  insert into public.payment_refunds (payment_id, amount, request_token, status, reason, created_by)
  values (p_payment_id, p_amount, p_token, 'requested', left(p_reason, 500), p_staff)
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.payu_capture(uuid, text[], text, text, text) from public, anon, authenticated;
revoke all on function public.payu_claim_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.payu_reserve_refund(uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.payu_capture(uuid, text[], text, text, text) to service_role;
grant execute on function public.payu_claim_jobs(integer, integer) to service_role;
grant execute on function public.payu_reserve_refund(uuid, numeric, text, text, uuid) to service_role;
