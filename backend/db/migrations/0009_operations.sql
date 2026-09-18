-- ---------------------------------------------------------------------------
-- 0009_operations.sql  (PHASE 11 — customer & admin operations)
--
-- Reuses everything that already exists: bookings, booking_items,
-- booking_travellers, payments, travellers and booking_events. The booking
-- timeline is booking_events; no parallel event table is introduced.
--
-- New structures, only where the existing schema cannot express the need:
--   cancellation_requests   customer-initiated cancellation workflow
--   support_requests        support cases
--   support_messages        support conversation (customer + admin, internal flag)
--   booking_internal_notes  admin-only notes
--
-- IMPORTANT: nothing here performs a provider cancellation or a refund. These
-- tables record a WORKFLOW STATE ONLY until TripJack / Razorpay are connected.
-- ---------------------------------------------------------------------------

-- ---- enums ----------------------------------------------------------------
do $$ begin
  create type public.cancellation_state as enum (
    'requested', 'pending', 'approved', 'rejected'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.refund_state as enum (
    'not_applicable', 'pending', 'processing', 'completed', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_state as enum (
    'open', 'in_progress', 'waiting_customer', 'resolved', 'closed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_category as enum (
    'flight_booking', 'hotel_booking', 'payment', 'cancellation',
    'refund', 'document', 'general'
  );
exception when duplicate_object then null; end $$;

-- ---- cancellation_requests ------------------------------------------------
create table if not exists public.cancellation_requests (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.bookings(id) on delete cascade,
  -- NULL for a guest request; never taken from a request body.
  user_id         uuid references auth.users(id) on delete set null,
  reason_code     text not null,
  reason_note     text,
  state           public.cancellation_state not null default 'requested',
  refund_state    public.refund_state not null default 'not_applicable',
  -- Set by an admin decision; free text shown to the customer.
  decision_note   text,
  decided_by      uuid references auth.users(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists cancellation_requests_booking_idx
  on public.cancellation_requests (booking_id);
create index if not exists cancellation_requests_state_idx
  on public.cancellation_requests (state, created_at desc);

grant select on public.cancellation_requests to authenticated;
grant all on public.cancellation_requests to service_role;
alter table public.cancellation_requests enable row level security;

drop policy if exists "cancellation_select_own" on public.cancellation_requests;
create policy "cancellation_select_own" on public.cancellation_requests
  for select to authenticated
  using (
    (user_id is not null and user_id = auth.uid())
    or public.has_admin_level(1)
  );

-- ---- support_requests -----------------------------------------------------
create table if not exists public.support_requests (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique default 'SR' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  booking_id      uuid references public.bookings(id) on delete set null,
  user_id         uuid references auth.users(id) on delete set null,
  contact_email   text not null,
  category        public.support_category not null default 'general',
  subject         text not null,
  state           public.support_state not null default 'open',
  assigned_to     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists support_requests_user_idx
  on public.support_requests (user_id, created_at desc);
create index if not exists support_requests_state_idx
  on public.support_requests (state, created_at desc);
create index if not exists support_requests_booking_idx
  on public.support_requests (booking_id);

grant select on public.support_requests to authenticated;
grant all on public.support_requests to service_role;
alter table public.support_requests enable row level security;

drop policy if exists "support_select_own" on public.support_requests;
create policy "support_select_own" on public.support_requests
  for select to authenticated
  using (
    (user_id is not null and user_id = auth.uid())
    or public.has_admin_level(1)
  );

-- Writes go through FastAPI (service_role) so the author and the state
-- transition are decided server-side.

-- ---- support_messages -----------------------------------------------------
create table if not exists public.support_messages (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.support_requests(id) on delete cascade,
  -- 'customer' | 'admin' | 'system'
  author_role  text not null,
  author_id    uuid references auth.users(id) on delete set null,
  author_name  text,
  body         text not null,
  -- Internal notes are never returned to a customer.
  internal     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists support_messages_request_idx
  on public.support_messages (request_id, created_at);

grant select on public.support_messages to authenticated;
grant all on public.support_messages to service_role;
alter table public.support_messages enable row level security;

drop policy if exists "support_messages_select_own" on public.support_messages;
create policy "support_messages_select_own" on public.support_messages
  for select to authenticated
  using (
    (
      internal = false
      and exists (
        select 1 from public.support_requests r
        where r.id = support_messages.request_id
          and r.user_id is not null
          and r.user_id = auth.uid()
      )
    )
    or public.has_admin_level(1)
  );

-- ---- booking_internal_notes ----------------------------------------------
-- Admin-only. No `authenticated` grant at all, so a customer cannot read a
-- note even if a policy were mistakenly added later.
create table if not exists public.booking_internal_notes (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings(id) on delete cascade,
  author_id    uuid not null references auth.users(id) on delete cascade,
  author_name  text,
  body         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists booking_internal_notes_booking_idx
  on public.booking_internal_notes (booking_id, created_at desc);

grant all on public.booking_internal_notes to service_role;
alter table public.booking_internal_notes enable row level security;

drop policy if exists "internal_notes_admin_read" on public.booking_internal_notes;
create policy "internal_notes_admin_read" on public.booking_internal_notes
  for select to authenticated
  using (public.has_admin_level(2));

-- ---- notifications --------------------------------------------------------
-- Outbound notification intents. No external provider is connected in this
-- phase: rows are created with dispatched=false and stay that way.
create table if not exists public.notification_events (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid references public.bookings(id) on delete cascade,
  request_id   uuid references public.support_requests(id) on delete cascade,
  event_type   text not null,
  -- Safe metadata only: references, statuses, amounts. Never card data,
  -- passport numbers, OTP values or credentials.
  payload      jsonb not null default '{}'::jsonb,
  dispatched   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists notification_events_created_idx
  on public.notification_events (created_at desc);

grant all on public.notification_events to service_role;
alter table public.notification_events enable row level security;
-- Internal only: RLS enabled, no policies, no client grants.
