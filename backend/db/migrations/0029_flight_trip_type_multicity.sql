-- ---------------------------------------------------------------------------
-- 0029_flight_trip_type_multicity.sql
-- Add the 'multicity' trip type for Flight API v2.0 multi-city search.
--
-- This enum change is deliberately its own migration: PostgreSQL does not
-- allow a newly added enum value to be used inside the same transaction that
-- added it, so the value is committed here and first USED by migration 0030.
-- Additive only — existing 'oneway'/'roundtrip' values and rows are untouched.
-- ---------------------------------------------------------------------------

alter type public.trip_type add value if not exists 'multicity';
