-- ---------------------------------------------------------------------------
-- 0020_package_duplicate_review.sql   (additive)
--
-- Every source DOCX is preserved as its own package. Separate files are never
-- assumed to be duplicates or variants. Possible duplicates (same package
-- code, same name, same destination) are only FLAGGED here for human review.
-- Internal table: service_role only, no client policy.
-- ---------------------------------------------------------------------------

-- Two files may share a package code, so it can no longer be unique.
alter table public.packages drop constraint if exists packages_package_code_key;
create index if not exists packages_package_code_idx on public.packages (package_code);
create index if not exists packages_name_dest_idx   on public.packages (destination_id, lower(name));

create table if not exists public.package_duplicate_candidates (
  id            uuid primary key default gen_random_uuid(),
  package_a_id  uuid not null references public.packages(id) on delete cascade,
  package_b_id  uuid not null references public.packages(id) on delete cascade,
  match_reasons text[] not null
                check (match_reasons <@ array['package_code','name','destination']::text[]
                       and cardinality(match_reasons) > 0),
  status        text not null default 'pending'
                check (status in ('pending','not_duplicate','confirmed_duplicate','variant')),
  review_note   text,
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (package_a_id < package_b_id),          -- one row per unordered pair
  unique (package_a_id, package_b_id)
);

create index if not exists package_dup_status_idx on public.package_duplicate_candidates (status, created_at);

drop trigger if exists package_duplicate_candidates_set_updated_at on public.package_duplicate_candidates;
create trigger package_duplicate_candidates_set_updated_at
  before update on public.package_duplicate_candidates
  for each row execute function public.set_updated_at();

grant all on public.package_duplicate_candidates to service_role;
alter table public.package_duplicate_candidates enable row level security;  -- no client policy
