-- ---------------------------------------------------------------------------
-- 0006_rls_policies.sql
-- Row Level Security. RLS is already ENABLED on every table in 0002-0005;
-- this migration defines the policies.
--
-- Principles
--   * No `using (true)` on any sensitive table.
--   * `anon` gets nothing. Guest access happens only through FastAPI, which
--     verifies booking_reference + contact email before returning anything.
--   * `authenticated` gets read-own only, scoped by auth.uid().
--   * All writes to bookings/payments/events go through FastAPI using the
--     service_role key (service_role bypasses RLS by design).
--   * Ownership is enforced by the policy predicate, so swapping an id in a
--     request can never return another user's row.
-- ---------------------------------------------------------------------------

-- ---- profiles -------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- travellers -----------------------------------------------------------
-- Guest travellers (user_id IS NULL) are intentionally invisible to every
-- logged-in user; only FastAPI can read them.
drop policy if exists "travellers_select_own" on public.travellers;
create policy "travellers_select_own" on public.travellers
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "travellers_insert_own" on public.travellers;
create policy "travellers_insert_own" on public.travellers
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "travellers_update_own" on public.travellers;
create policy "travellers_update_own" on public.travellers
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- searches -------------------------------------------------------------
-- No client policies: searches are written by FastAPI only. RLS enabled with
-- zero policies means authenticated/anon see nothing.

-- ---- bookings -------------------------------------------------------------
drop policy if exists "bookings_select_own" on public.bookings;
create policy "bookings_select_own" on public.bookings
  for select to authenticated
  using (user_id is not null and user_id = auth.uid());

-- Deliberately no INSERT/UPDATE/DELETE policy: booking state transitions and
-- amounts are decided server-side in FastAPI after provider + gateway checks.

-- ---- booking_items --------------------------------------------------------
drop policy if exists "booking_items_select_own" on public.booking_items;
create policy "booking_items_select_own" on public.booking_items
  for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = booking_items.booking_id
      and b.user_id is not null
      and b.user_id = auth.uid()
  ));

-- ---- booking_travellers ---------------------------------------------------
drop policy if exists "booking_travellers_select_own" on public.booking_travellers;
create policy "booking_travellers_select_own" on public.booking_travellers
  for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = booking_travellers.booking_id
      and b.user_id is not null
      and b.user_id = auth.uid()
  ));

-- ---- payments -------------------------------------------------------------
drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments
  for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = payments.booking_id
      and b.user_id is not null
      and b.user_id = auth.uid()
  ));

-- ---- booking_events / provider_debug_logs / search_result_refs ------------
-- Internal only. RLS enabled, no policies, no grants beyond service_role.
