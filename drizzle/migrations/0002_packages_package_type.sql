alter table public.packages
  add column if not exists package_type text
  check (package_type in ('domestic','international'));

create or replace function public.sync_package_type()
returns trigger language plpgsql set search_path = public as $$
declare
  dest_region text;
begin
  select region into dest_region from public.destinations where id = new.destination_id;
  if dest_region is null then
    raise exception 'destination % not found', new.destination_id;
  end if;
  if new.package_type is null then
    new.package_type := dest_region;
  elsif new.package_type <> dest_region then
    raise exception 'package_type % does not match destination region %', new.package_type, dest_region;
  end if;
  return new;
end $$;

drop trigger if exists packages_sync_package_type on public.packages;
create trigger packages_sync_package_type
  before insert or update of destination_id, package_type on public.packages
  for each row execute function public.sync_package_type();

create index if not exists packages_type_pub_idx on public.packages (package_type, is_published);