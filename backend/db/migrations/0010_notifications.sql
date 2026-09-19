-- ============================================================================
-- 0010_notifications.sql  (PHASE 13 — Notifications)
--
-- EXTENDS the Phase 11 `notification_events` table rather than creating a
-- second notification system, and adds ONE new table for per-channel delivery
-- state. Nothing from 0001-0009 is dropped, renamed or restructured.
--
-- What this migration adds
--   notification_events : user_id, audience, title, body, channels, read_at,
--                         dedupe_key (unique -> idempotency)
--   notification_deliveries : queued | sent | failed | retrying | skipped
--                         per channel, with attempt count and provider id.
--
-- Security model
--   * A customer may read and mark read ONLY their own rows (user_id = auth.uid()).
--   * No client may insert, update arbitrary columns, or delete: the service
--     role writes notifications and deliveries.
--   * Deliveries stay internal (RLS on, no client grants): they describe our
--     provider attempts, not customer-facing content.
--   * Stored content is references, statuses and short copy only. Never card
--     data, OTPs, passwords, passport/document numbers or credentials.
-- ============================================================================

-- ---------------------------------------------------------------- events ----
alter table public.notification_events
  add column if not exists user_id    uuid references auth.users(id) on delete cascade,
  add column if not exists audience   text not null default 'customer',
  add column if not exists title      text not null default 'Update',
  add column if not exists body       text not null default '',
  add column if not exists channels   text[] not null default array['in_app']::text[],
  add column if not exists read_at    timestamptz,
  add column if not exists dedupe_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_events_audience_check'
  ) then
    alter table public.notification_events
      add constraint notification_events_audience_check
      check (audience in ('customer', 'admin'));
  end if;
end $$;

-- Idempotency: a repeated emit for the same logical event is absorbed by this
-- unique index instead of producing a duplicate notification.
create unique index if not exists notification_events_dedupe_key_idx
  on public.notification_events (dedupe_key)
  where dedupe_key is not null;

create index if not exists notification_events_user_idx
  on public.notification_events (user_id, created_at desc);

create index if not exists notification_events_unread_idx
  on public.notification_events (user_id)
  where read_at is null;

-- The owner may read their own notifications and mark them read.
grant select on public.notification_events to authenticated;
grant update (read_at) on public.notification_events to authenticated;
grant all on public.notification_events to service_role;

drop policy if exists "notification_events_owner_select" on public.notification_events;
create policy "notification_events_owner_select"
  on public.notification_events
  for select
  to authenticated
  using (user_id = auth.uid() and audience = 'customer');

drop policy if exists "notification_events_owner_mark_read" on public.notification_events;
create policy "notification_events_owner_mark_read"
  on public.notification_events
  for update
  to authenticated
  using (user_id = auth.uid() and audience = 'customer')
  with check (user_id = auth.uid() and audience = 'customer');

-- ------------------------------------------------------------ deliveries ----
create table if not exists public.notification_deliveries (
  notification_id uuid not null
    references public.notification_events(id) on delete cascade,
  channel         text not null check (channel in ('in_app','email','sms','whatsapp','push')),
  state           text not null default 'queued'
    check (state in ('queued','sent','failed','retrying','skipped')),
  attempts        integer not null default 0,
  provider_id     text not null default 'none',
  mode            text not null default 'demo' check (mode in ('demo','live')),
  error           text,
  updated_at      timestamptz not null default now(),
  primary key (notification_id, channel)
);

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (updated_at)
  where state in ('queued', 'retrying');

-- Internal only: RLS enabled, no policies, no client grants.
grant all on public.notification_deliveries to service_role;
alter table public.notification_deliveries enable row level security;
