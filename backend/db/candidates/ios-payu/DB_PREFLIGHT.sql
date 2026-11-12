-- READ-ONLY REVIEW GUARD. No migration or payment/provider invocation.
-- Requires a separately reviewed live-schema fingerprint and semantic review.
-- Execute only after explicit database-read approval with ON_ERROR_STOP=1.
BEGIN READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $$
DECLARE r record; a record; t oid; label text; role_name text;
BEGIN
  -- Conservative structural requirements. Mismatch means STOP, not alter live DB.
  FOR r IN SELECT * FROM (VALUES
    ('payments','id','uuid',true),
    ('payments','hotel_booking_id','uuid',false),
    ('payments','booking_id','uuid',false),
    ('payments','txnid','text',false),
    ('payments','amount','numeric',true),
    ('payments','currency','pg_catalog.bpchar',true),
    ('payments','created_at','timestamp with time zone',true),
    ('hotel_bookings','id','uuid',true),
    ('hotel_bookings','booking_reference','text',true),
    ('hotel_bookings','currency','text',true),
    ('hotel_bookings','status','text',true),
    ('hotel_bookings','provider_booking_id','text',false),
    ('hotel_bookings','total_amount','numeric',true),
    ('payment_fulfilment_jobs','payment_id','uuid',true)
  ) v(tbl,col,typ,require_not_null) LOOP
    SELECT x.atttypid, x.attnotnull INTO a
      FROM pg_attribute x WHERE x.attrelid=to_regclass('public.'||r.tbl)
        AND x.attname=r.col AND x.attnum>0 AND NOT x.attisdropped;
    IF NOT FOUND OR a.atttypid <> to_regtype(r.typ)
       OR (r.require_not_null AND NOT a.attnotnull) THEN
      RAISE EXCEPTION 'STOP: incompatible public.%.% type/nullability',r.tbl,r.col;
    END IF;
  END LOOP;
  -- char(n) uses bpchar OID; typmod is n + VARHDRSZ (4).
  -- character without a length is character(1), NOT acceptable currency.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
    WHERE attrelid='public.payments'::regclass AND attname='currency'
      AND atttypid='pg_catalog.bpchar'::regtype AND atttypmod=7 AND attnotnull) THEN
    RAISE EXCEPTION 'STOP: payments.currency must be character(3) NOT NULL';
  END IF;
  -- Inspect validated currency CHECK below: require three uppercase letters.
  -- Type/width alone permit padding and do not prove business validation.
  FOR r IN SELECT * FROM (VALUES
    ('provider',ARRAY['payu']::text[]),
    ('status',ARRAY['created','pending','captured','failed']::text[])
  ) v(col,labels) LOOP
    SELECT x.atttypid INTO t FROM pg_attribute x
      WHERE x.attrelid='public.payments'::regclass AND x.attname=r.col
        AND x.attnum>0 AND NOT x.attisdropped AND x.attnotnull;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM pg_type WHERE oid=t AND typtype='e') THEN
      RAISE EXCEPTION 'STOP: payment % is not a non-null enum',r.col;
    END IF;
    FOREACH label IN ARRAY r.labels LOOP
      IF NOT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid=t AND enumlabel=label) THEN
        RAISE EXCEPTION 'STOP: payment % lacks %',r.col,label;
      END IF;
    END LOOP;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('payments','id'),('hotel_bookings','id'),('payment_fulfilment_jobs','payment_id')
  ) v(tbl,col) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_attribute x
        ON x.attrelid=i.indrelid AND x.attname=r.col
      WHERE i.indrelid=to_regclass('public.'||r.tbl) AND i.indisunique
        AND i.indisvalid AND i.indisready AND i.indpred IS NULL
        AND i.indexprs IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=x.attnum
    ) THEN RAISE EXCEPTION 'STOP: missing valid unique key %.%',r.tbl,r.col; END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute p ON p.attrelid=c.conrelid AND p.attname='hotel_booking_id'
    JOIN pg_attribute h ON h.attrelid=c.confrelid AND h.attname='id'
    WHERE c.contype='f' AND c.convalidated AND c.conrelid='public.payments'::regclass
      AND c.confrelid='public.hotel_bookings'::regclass
      AND c.conkey=ARRAY[p.attnum] AND c.confkey=ARRAY[h.attnum]
  ) THEN RAISE EXCEPTION 'STOP: missing validated Hotel payment FK'; END IF;
  FOR r IN SELECT * FROM (VALUES
    ('payu_capture(uuid,text[],text,text,text)'),
    ('payu_claim_jobs(integer,integer)'),
    ('payu_withdraw_job(uuid)'),
    ('payu_reserve_refund(uuid,numeric,text,text,uuid)')
  ) v(sig) LOOP
    t := to_regprocedure('public.'||r.sig);
    IF t IS NULL OR NOT has_function_privilege('service_role',t,'EXECUTE') THEN
      RAISE EXCEPTION 'STOP: missing/inaccessible existing RPC %',r.sig;
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['service_role','anon','authenticated'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      RAISE EXCEPTION 'STOP: missing role %',role_name;
    END IF;
  END LOOP;
  IF NOT has_schema_privilege('service_role','public','USAGE') THEN
    RAISE EXCEPTION 'STOP: service role lacks schema access';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('payments'),('hotel_bookings'),('payment_fulfilment_jobs')) v(tbl) LOOP
    IF NOT has_table_privilege('service_role','public.'||r.tbl,'SELECT') THEN
      RAISE EXCEPTION 'STOP: service role cannot read %',r.tbl;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role','public.payments','INSERT') THEN
    RAISE EXCEPTION 'STOP: service role cannot create payment';
  END IF;
  -- INVOKER functions require service-role RLS bypass; do not assign new owners.
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'STOP: service_role must bypass RLS for invoker-only RPCs';
  END IF;
  -- Exact index/check/trigger/function semantics still require approved fingerprint.
  -- Reject any public relation/index/type/function collision, including overloads.
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN
        ('payu_handoffs','payu_handoffs_one_active','payu_handoffs_pkey','payu_handoffs_payment_id_link_no_key'))
    OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' AND t.typname='payu_handoffs')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
        ('payu_handoff_chain','payu_issue_handoff','payu_consume_handoff')) THEN
    RAISE EXCEPTION 'STOP: existing handoff object; reconcile rather than overwrite';
  END IF;
END $$;
-- Definitions/ACLs below MUST be semantically reviewed against the captured
-- live-schema fingerprint; name checks alone do not validate predicates/bodies.
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
  AND tablename IN ('payments','hotel_bookings','payment_fulfilment_jobs');
SELECT c.conrelid::regclass AS relation,c.conname,c.convalidated,pg_get_constraintdef(c.oid)
  FROM pg_constraint c WHERE c.conrelid IN ('public.payments'::regclass,
    'public.hotel_bookings'::regclass,'public.payment_fulfilment_jobs'::regclass);
SELECT p.oid::regprocedure AS signature,p.prosecdef,p.proconfig,
  pg_get_userbyid(p.proowner) AS owner,p.proacl,md5(pg_get_functiondef(p.oid)) AS definition_fingerprint
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'payu_%';
SELECT n.nspname,n.nspacl FROM pg_namespace n WHERE n.nspname='public';
SELECT pg_get_userbyid(d.defaclrole) AS owner,d.defaclnamespace::regnamespace,d.defaclobjtype,d.defaclacl
  FROM pg_default_acl d;
ROLLBACK;
-- Successful guard != approval to migrate. Unreviewed definitions/lock ordering,
-- nullable service inputs, missing late-charge fix or live drift remain NO-GO.
