-- ---------------------------------------------------------------------------
-- 0004_bookings.sql
-- Bookings, booking items, booking travellers. Guest bookings allowed
-- (user_id NULL) and reached only through the unpredictable booking_reference
-- plus a contact-email match verified inside FastAPI.
-- ---------------------------------------------------------------------------

create table if not exists public.bookings (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid references auth.users(id) on delete set null,
  booking_reference           text not null unique default public.generate_booking_reference(),
  booking_type                public.booking_type not null,
  status                      public.booking_status not null default 'pending',
  provider                    public.provider_code not null default 'tripjack',
  provider_booking_reference  text,
  provider_order_reference    text,
  -- Guest contact. Stored lowercase/normalized by the backend; used for the
  -- reference + email lookup challenge. No passwords, ever.
  contact_email               citext,
  contact_phone               text,
  currency                    char(3) not null default 'INR',
  total_amount                numeric(12,2) not null default 0,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint bookings_reference_format_chk check (booking_reference ~ '^FF-[0-9A-Z]{8}$'),
  constraint bookings_currency_chk         check (currency ~ '^[A-Z]{3}$'),
  constraint bookings_total_amount_chk     check (total_amount >= 0),
  constraint bookings_contact_email_chk    check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- a confirmed booking must carry the provider's reference
  constraint bookings_confirmed_ref_chk    check (status <> 'confirmed' or provider_booking_reference is not null),
  -- guest bookings need a contact channel to be retrievable
  constraint bookings_owner_or_contact_chk check (user_id is not null or contact_email is not null)
);

comment on table public.bookings is
  'Money is numeric(12,2), never float. Final payable amount is computed server-side, never trusted from the browser.';

create index if not exists bookings_user_id_idx      on public.bookings (user_id);
create unique index if not exists bookings_reference_idx on public.bookings (booking_reference);
create index if not exists bookings_provider_ref_idx  on public.bookings (provider_booking_reference)
  where provider_booking_reference is not null;
create index if not exists bookings_status_idx       on public.bookings (status);
create index if not exists bookings_created_at_idx   on public.bookings (created_at desc);
create index if not exists bookings_contact_email_idx on public.bookings (contact_email)
  where contact_email is not null;

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

grant select on public.bookings to authenticated;   -- read-own only, per RLS
grant all on public.bookings to service_role;       -- FastAPI owns all writes

alter table public.bookings enable row level security;

-- ---------------------------------------------------------------------------
-- booking_items: one booking may hold several priced components.
-- `details` holds ONLY normalized business fields we render or reconcile
-- (route, times, hotel/room name, cancellation summary) — never a raw
-- provider payload, never passenger identity documents.
-- ---------------------------------------------------------------------------

create table if not exists public.booking_items (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings(id) on delete cascade,
  item_type          public.booking_item_type not null,
  provider_reference text,
  details            jsonb not null default '{}'::jsonb,
  amount             numeric(12,2) not null default 0,
  currency           char(3) not null default 'INR',
  created_at         timestamptz not null default now(),
  constraint booking_items_currency_chk check (currency ~ '^[A-Z]{3}$'),
  constraint booking_items_amount_chk   check (amount >= 0 or item_type = 'discount'),
  constraint booking_items_details_chk  check (jsonb_typeof(details) = 'object')
);

create index if not exists booking_items_booking_id_idx on public.booking_items (booking_id);

grant select on public.booking_items to authenticated;
grant all on public.booking_items to service_role;

alter table public.booking_items enable row level security;

-- ---------------------------------------------------------------------------
-- booking_travellers: join between a booking and the traveller records used.
-- ---------------------------------------------------------------------------

create table if not exists public.booking_travellers (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings(id) on delete cascade,
  traveller_id   uuid not null references public.travellers(id) on delete restrict,
  passenger_type text not null default 'adult',
  is_lead        boolean not null default false,
  ticket_number  text,
  created_at     timestamptz not null default now(),
  constraint booking_travellers_type_chk check (passenger_type in ('adult', 'child', 'infant')),
  constraint booking_travellers_unique unique (booking_id, traveller_id)
);

create index if not exists booking_travellers_booking_id_idx   on public.booking_travellers (booking_id);
create index if not exists booking_travellers_traveller_id_idx on public.booking_travellers (traveller_id);

grant select on public.booking_travellers to authenticated;
grant all on public.booking_travellers to service_role;

alter table public.booking_travellers enable row level security;
