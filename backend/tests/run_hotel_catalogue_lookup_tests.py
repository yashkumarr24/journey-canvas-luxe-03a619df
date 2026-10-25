"""Run real migrations/SQL in a temporary local PostgreSQL, never a remote DB.

python3 backend/tests/run_hotel_catalogue_lookup_tests.py
Requires PostgreSQL binaries; root uses the local nobody account via runuser.
No credentials, environment database URLs, provider calls or network connections.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]


def main():
    prefix = ['runuser', '-u', 'nobody', '--'] if os.geteuid() == 0 else []
    with tempfile.TemporaryDirectory(prefix='hotel-lookup-') as directory:
        base = Path(directory)
        if prefix:
            os.chown(base, 65534, 65534)
        def run(args, **kwargs):
            # Resolve wrapper symlinks so PostgreSQL finds its own lib/share tree.
            executable = shutil.which(args[0])
            if executable:
                args = [str(Path(executable).resolve()), *args[1:]]
            result = subprocess.run(prefix + args, text=True, capture_output=True, **kwargs)
            if result.returncode:
                raise RuntimeError(result.stderr or result.stdout)
            return result.stdout
        data = base / 'data'
        run(['initdb', '-D', str(data), '-A', 'trust', '-U', 'postgres', '--no-locale'])
        run(['pg_ctl', '-D', str(data), '-l', str(base / 'postgres.log'), '-o',
             f"-k {base} -p 55439 -c listen_addresses=''", '-w', 'start'])
        try:
            # Explicit UNIX socket overrides any managed PG* environment.
            def sql(source):
                return run(['psql', '-X', '-h', str(base), '-p', '55439', '-U', 'postgres',
                            '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input=source)
            def file(relative):
                return sql((ROOT / relative).read_text())
            sql('create role anon; create role authenticated; create role service_role bypassrls;')
            file('backend/db/migrations/0012_hotel_catalogue.sql')
            sql('create table public.hotel_search_sessions(id text primary key);')
            file('backend/db/migrations/0025_hotel_search_catalogue_context.sql')
            sql('alter function public.hotel_catalogue_search_ids(text,text,text,text,integer) rename to hotel_catalogue_search_ids_0025;')
            file('backend/db/migrations/0026_hotel_catalogue_search_ids_lookup.sql')
            file('backend/db/migrations/0026_hotel_catalogue_search_ids_lookup.sql')  # idempotence
            file('backend/tests/hotel_catalogue_search_regression.sql')
            file('backend/tests/hotel_catalogue_search_lookup_regression.sql')
            print('PASS: concrete selection/filter/pagination/permission assertions and 5,600 equivalence cases; migration rerun.')
            # Put target-city IDs after a large unrelated catalogue: detects global scans.
            sql("""
              insert into public.hotel_regions(city_region_id,city_name,country_name)
              values ('bench-other','Other city','Other country'),('bench-city','Dubai','United Arab Emirates');
              insert into public.hotel_mappings(tj_hotel_id,region_id)
              select 'background-' || lpad(i::text,7,'0'),'bench-other' from generate_series(1,740000) i;
              insert into public.hotel_mappings(tj_hotel_id,region_id)
              select 'target-' || lpad(i::text,5,'0'),'bench-city' from generate_series(1,20620) i;
              insert into public.hotels(tj_hotel_id,name)
              select tj_hotel_id,'Synthetic property' from public.hotel_mappings;
              analyze public.hotel_mappings; analyze public.hotel_regions; analyze public.hotels;
            """)
            # Explain the exact city branch (PL/pgSQL EXPLAIN otherwise hides nested plans).
            plan = json.loads(sql("""explain (analyze,buffers,format json)
              select m.tj_hotel_id from public.hotel_mappings m
              left join public.hotels h on h.tj_hotel_id=m.tj_hotel_id
              where m.region_id='bench-city' and not m.is_deleted
                and m.tj_hotel_id>'' and coalesce(h.is_active,true)
              order by m.tj_hotel_id limit 500;"""))[0]
            encoded = json.dumps(plan)
            assert 'hotel_mappings_live_region_hotel_idx' in encoded, f'city query did not use composite index: {encoded}'
            buffers = plan['Plan'].get('Shared Hit Blocks', 0) + plan['Plan'].get('Shared Read Blocks', 0)
            assert buffers < 10000, f'city page touched too many buffers: {buffers}'
            for name in ['hotel_catalogue_search_ids_0025', 'hotel_catalogue_search_ids']:
                started = time.monotonic()
                count = sql(f"set plan_cache_mode=force_generic_plan; set role service_role; select count(*) from public.{name}('Dubai, United Arab Emirates','city','bench-city','',500);").splitlines()[-1]
                assert count == '500'
                print(f'{name}: 500 IDs, {(time.monotonic()-started)*1000:.1f} ms (includes psql startup)')
            print(f'PASS: 760,620-mapping city lookup uses composite index; {buffers} buffers; EXPLAIN {plan["Execution Time"]:.3f} ms.')
        finally:
            run(['pg_ctl', '-D', str(data), '-m', 'immediate', '-w', 'stop'])


if __name__ == '__main__':
    main()