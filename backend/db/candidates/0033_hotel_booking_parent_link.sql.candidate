-- Forward-only candidate. DO NOT apply remotely as part of development.
-- VPS 0031/0032 are already applied per the user's current confirmation.
-- Requires the base bookings and Hotel schema; NOT the branch-only 0024 model.
-- Guest hashes stay on hotel_bookings; parent ownership is user_id + contact.
-- QUARANTINED: rename outside the migration runner; do not apply/deploy yet.
-- No payment/capture/fulfilment functions or Flight data are changed.
begin;

-- Reject an unknown reference rule before replacing it. Payment schema and
-- guest payment authorization must be reconciled separately before release.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.bookings'::regclass
      and c.conname = 'bookings_reference_format_chk'
      and c.contype = 'c' and c.convalidated
      and regexp_replace(pg_catalog.pg_get_expr(c.conbin, c.conrelid),
                         '[[:space:]()]', '', 'g') =
          'booking_reference~''^FF-[0-9A-Z]{8}$''::text'
  ) then
    raise exception 'Hotel parent linkage requires the reviewed base reference constraint';
  end if;
end $$;

-- Preserve every previously accepted FF reference; add only Hotel references.
alter table public.bookings drop constraint bookings_reference_format_chk;
alter table public.bookings add constraint bookings_reference_format_chk check (
  booking_reference ~ '^FF-[0-9A-Z]{8}$'
  or (booking_type = 'hotel' and booking_reference ~ '^FNFH[0-9A-F]{6}$')
);

-- Nullable for legacy Hotel rows. Only the RPC creates new linked drafts.
alter table public.hotel_bookings add column booking_id uuid
  references public.bookings(id) on delete restrict;
create unique index hotel_bookings_parent_idx on public.hotel_bookings(booking_id)
  where booking_id is not null;

create function public.hotel_create_linked_draft(p_draft jsonb)
returns setof public.hotel_bookings
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  incoming public.hotel_bookings%rowtype;
  existing public.hotel_bookings%rowtype;
  parent public.bookings%rowtype;
begin
  incoming := jsonb_populate_record(null::public.hotel_bookings, p_draft);
  if incoming.review_token is null or incoming.review_token = ''
     or incoming.booking_reference is null
     or incoming.booking_reference !~ '^FNFH[0-9A-F]{6}$'
     or incoming.status is distinct from 'DRAFT'
     or incoming.booking_id is not null
     or num_nonnulls(incoming.user_id, incoming.guest_token_hash) <> 1
     or incoming.guest_token_hash = ''
     or incoming.total_amount is null or incoming.total_amount <= 0
     or incoming.total_amount::text in ('NaN', 'Infinity', '-Infinity')
     or incoming.currency is null or incoming.currency !~ '^[A-Z]{3}$'
     or coalesce(incoming.contact->>'email', '') = ''
     or coalesce(incoming.contact->>'phone', '') = '' then
    raise exception 'Invalid Hotel draft linkage';
  end if;

  -- Serialize retries for the same Review, even before the first row exists.
  perform pg_advisory_xact_lock(hashtextextended(incoming.review_token, 0));
  select * into existing from public.hotel_bookings
    where review_token = incoming.review_token for update;
  if found then
    -- Never mutate owner, accepted price, contact or guest data on a retry.
    if existing.user_id is distinct from incoming.user_id
       or existing.guest_token_hash is distinct from incoming.guest_token_hash
       or existing.total_amount is distinct from incoming.total_amount
       or existing.currency is distinct from incoming.currency
       or existing.contact is distinct from incoming.contact
       or existing.guests is distinct from incoming.guests
       or existing.provider_hotel_id is distinct from incoming.provider_hotel_id
       or existing.provider_option_id is distinct from incoming.provider_option_id then
      raise exception 'Hotel draft retry does not match persisted evidence';
    end if;
    incoming := existing;
    if incoming.booking_id is null and incoming.status <> 'DRAFT' then
      raise exception 'Legacy non-draft Hotel requires manual reconciliation';
    end if;
  end if;

  select * into parent from public.bookings
    where booking_reference = incoming.booking_reference for update;
  if found then
    if parent.booking_type <> 'hotel'
       or parent.user_id is distinct from incoming.user_id
       or parent.total_amount is distinct from incoming.total_amount
       or parent.currency::text is distinct from incoming.currency
       or parent.contact_email::text is distinct from lower(incoming.contact->>'email')
       or parent.contact_phone is distinct from incoming.contact->>'phone'
       or (incoming.booking_id is not null and incoming.booking_id <> parent.id)
       or (incoming.booking_id is null and parent.status <> 'pending') then
      raise exception 'Hotel parent identity or amount mismatch';
    end if;
  else
    if incoming.booking_id is not null then
      raise exception 'Hotel parent link is inconsistent';
    end if;
    insert into public.bookings (
      booking_reference, booking_type, status, user_id,
      total_amount, currency, contact_email, contact_phone
    ) values (
      incoming.booking_reference, 'hotel', 'pending', incoming.user_id,
      incoming.total_amount, incoming.currency,
      lower(incoming.contact->>'email'), incoming.contact->>'phone'
    ) returning * into parent;
  end if;

  if existing.id is not null then
    update public.hotel_bookings set booking_id = parent.id
      where id = existing.id and booking_id is null;
  else
    insert into public.hotel_bookings (
      booking_id, booking_reference, review_token, user_id, guest_token_hash,
      status, provider_search_id, provider_hotel_id, provider_option_id,
      nationality, currency, total_amount, hotel, room, stay, requirements,
      guests, contact, special_requests
    ) values (
      parent.id, incoming.booking_reference, incoming.review_token,
      incoming.user_id, incoming.guest_token_hash, 'DRAFT',
      incoming.provider_search_id, incoming.provider_hotel_id, incoming.provider_option_id,
      incoming.nationality, incoming.currency, incoming.total_amount,
      incoming.hotel, incoming.room, incoming.stay, incoming.requirements,
      incoming.guests, incoming.contact, incoming.special_requests
    );
  end if;
  return query select * from public.hotel_bookings where review_token = incoming.review_token;
end $$;

revoke all on function public.hotel_create_linked_draft(jsonb) from public, anon, authenticated;
grant execute on function public.hotel_create_linked_draft(jsonb) to service_role;
comment on column public.hotel_bookings.booking_id is
  'Private parent linkage for checkout; legacy rows remain unlinked until reconciled. Never a provider handle.';
commit;