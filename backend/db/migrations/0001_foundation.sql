-- ---------------------------------------------------------------------------
-- 0001_foundation.sql
-- Extensions, controlled enums, shared helpers.
-- Reproducible: safe to run on a fresh dev / UAT / production database.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;      -- gen_random_uuid(), gen_random_bytes()
create extension if not exists citext;        -- case-insensitive email

-- ---- controlled vocabularies ---------------------------------------------
-- Statuses are enums, so no arbitrary status string can ever be written.

do $$ begin
  create type public.booking_type as enum ('flight', 'hotel');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.booking_status as enum (
    'pending',
    'payment_pending',
    'payment_processing',
    'confirmed',
    'failed',
    'cancelled',
    'refunded'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum (
    'created',
    'pending',
    'authorized',
    'captured',
    'failed',
    'refunded',
    'partially_refunded'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.trip_type as enum ('oneway', 'roundtrip');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cabin_class as enum ('economy', 'premium_economy', 'business', 'first');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.booking_item_type as enum (
    'flight_itinerary', 'flight_segment', 'hotel_room', 'fee', 'discount'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.provider_code as enum ('tripjack', 'razorpay', 'manual');
exception when duplicate_object then null; end $$;

-- ---- shared helpers -------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Unpredictable, collision-resistant public booking reference: FF-XXXXXXXX
-- 8 chars of a 32-symbol alphabet from a CSPRNG (~40 bits), plus a UNIQUE
-- constraint on bookings.booking_reference and a bounded retry loop.
create or replace function public.generate_booking_reference()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  raw bytea;
  out_ref text := '';
  i int;
begin
  raw := gen_random_bytes(8);
  for i in 0..7 loop
    out_ref := out_ref || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
  end loop;
  return 'FF-' || out_ref;
end;
$$;

comment on function public.generate_booking_reference is
  'Public customer-facing booking reference. Internal UUIDs are never exposed to customers.';
