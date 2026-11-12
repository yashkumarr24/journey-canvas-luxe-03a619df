-- QUARANTINED DEVELOPMENT CANDIDATE ONLY. DO NOT EXECUTE.
-- Conservative correction: initial issuance is REFUSED until an independently
-- reviewed atomic payment+first-link reservation establishes iOS origin.
-- Existing website/settlement/refund objects are never modified.
-- INVOKER RPCs use existing service_role privileges, not owner escalation.
-- Lock order within these RPCs: payments -> hotel_bookings -> payu_handoffs.
-- Global compatibility with deployed capture/refund/cancellation locks UNVERIFIED.
BEGIN;
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
CREATE TABLE public.payu_handoffs (
    token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
    link_no smallint NOT NULL CHECK (link_no BETWEEN 1 AND 3),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    UNIQUE (payment_id, link_no)
);
GRANT SELECT, INSERT, UPDATE ON public.payu_handoffs TO service_role;
ALTER TABLE public.payu_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payu_handoffs FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX payu_handoffs_one_active ON public.payu_handoffs(payment_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- No clients may access data; no security-definer or owner changes.
CREATE FUNCTION public.payu_handoff_chain(p_payment_id uuid)
RETURNS TABLE(links int) LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT count(*)::int FROM public.payu_handoffs x WHERE x.payment_id = p_payment_id
$$;

-- Replacement ONLY of an expired, never-consumed link. A delivered signed form
-- is not revocable: consuming even one link permanently closes replacements.
-- Fresh Verify/not_found is a service prerequisite, not a SQL truth assertion.
CREATE FUNCTION public.payu_issue_handoff(p_payment_id uuid, p_token_hash text, p_expires_at timestamptz)
RETURNS TABLE(link_no smallint)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE p public.payments%ROWTYPE; b public.hotel_bookings%ROWTYPE;
        h public.payu_handoffs%ROWTYPE; n int; checked_at timestamptz;
BEGIN
  IF p_payment_id IS NULL OR p_token_hash IS NULL
     OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at IS NULL
     OR NOT isfinite(p_expires_at) THEN RETURN; END IF;
  SELECT * INTO p FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR p.hotel_booking_id IS NULL THEN RETURN; END IF;
  SELECT * INTO b FROM public.hotel_bookings WHERE id = p.hotel_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  checked_at := clock_timestamp(); -- validate again AFTER waiting for locks
  IF p_expires_at <= checked_at OR p_expires_at > checked_at + interval '120 seconds'
     OR p.created_at IS NULL OR NOT isfinite(p.created_at)
     OR p.created_at > checked_at OR p.created_at < checked_at - interval '15 minutes'
     OR p.provider::text IS DISTINCT FROM 'payu'
     OR p.status::text IS DISTINCT FROM 'created' OR b.status IS DISTINCT FROM 'DRAFT'
     OR p.currency::text IS DISTINCT FROM 'INR' OR b.currency IS DISTINCT FROM 'INR'
     OR p.txnid IS NULL OR length(p.txnid)=0 OR p.amount IS NULL OR b.total_amount IS NULL
     OR p.amount::text IN ('NaN','Infinity','-Infinity') OR p.amount <= 0
     OR p.amount IS DISTINCT FROM b.total_amount OR b.provider_booking_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.payment_fulfilment_jobs j WHERE j.payment_id=p.id)
  THEN RETURN; END IF;
  SELECT count(*) INTO n FROM public.payu_handoffs x WHERE x.payment_id=p.id;
  -- Origin cannot be inferred from age or a caller-supplied boolean.
  IF n=0 OR n>=3 THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.payu_handoffs x
      WHERE x.payment_id=p.id AND x.consumed_at IS NOT NULL) THEN RETURN; END IF;
  SELECT * INTO h FROM public.payu_handoffs x WHERE x.payment_id=p.id
    ORDER BY x.link_no DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR h.revoked_at IS NOT NULL OR h.consumed_at IS NOT NULL
     OR h.expires_at IS NULL OR h.expires_at > checked_at
     OR h.created_at IS NULL OR h.created_at > checked_at - interval '10 seconds'
  THEN RETURN; END IF;
  UPDATE public.payu_handoffs x SET revoked_at=checked_at
    WHERE x.payment_id=p.id AND x.consumed_at IS NULL AND x.revoked_at IS NULL;
  INSERT INTO public.payu_handoffs(token_hash,payment_id,link_no,expires_at)
    VALUES(p_token_hash,p.id,(n+1)::smallint,p_expires_at);
  RETURN QUERY SELECT (n+1)::smallint;
END $$;

CREATE FUNCTION public.payu_consume_handoff(p_token_hash text)
RETURNS TABLE(payment_id uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE pid uuid; p public.payments%ROWTYPE; b public.hotel_bookings%ROWTYPE;
        h public.payu_handoffs%ROWTYPE; checked_at timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  SELECT x.payment_id INTO pid FROM public.payu_handoffs x WHERE x.token_hash=p_token_hash;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO p FROM public.payments WHERE id=pid FOR UPDATE;
  IF NOT FOUND OR p.hotel_booking_id IS NULL THEN RETURN; END IF;
  SELECT * INTO b FROM public.hotel_bookings WHERE id=p.hotel_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO h FROM public.payu_handoffs x WHERE x.token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  checked_at := clock_timestamp();
  IF h.consumed_at IS NOT NULL OR h.revoked_at IS NOT NULL
     OR h.expires_at IS NULL OR NOT isfinite(h.expires_at) OR h.expires_at <= checked_at
  THEN RETURN; END IF;
  -- Burn before final refusal: this transaction must commit even on empty result.
  -- Network failure/lost HTML never restores the capability or permits reposting.
  UPDATE public.payu_handoffs x SET consumed_at=checked_at WHERE x.token_hash=p_token_hash;
  IF p.provider::text IS DISTINCT FROM 'payu' OR p.status::text IS DISTINCT FROM 'created'
     OR b.status IS DISTINCT FROM 'DRAFT' OR b.provider_booking_id IS NOT NULL
     OR p.currency::text IS DISTINCT FROM 'INR' OR b.currency IS DISTINCT FROM 'INR'
     OR p.amount IS NULL OR b.total_amount IS NULL OR p.amount <= 0
     OR p.amount::text IN ('NaN','Infinity','-Infinity')
     OR p.amount IS DISTINCT FROM b.total_amount OR p.txnid IS NULL OR length(p.txnid)=0
     OR EXISTS(SELECT 1 FROM public.payment_fulfilment_jobs j WHERE j.payment_id=p.id)
  THEN RETURN; END IF;
  RETURN QUERY SELECT pid;
END $$;

REVOKE ALL ON FUNCTION public.payu_handoff_chain(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payu_issue_handoff(uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payu_consume_handoff(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payu_handoff_chain(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.payu_issue_handoff(uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.payu_consume_handoff(text) TO service_role;
COMMIT;
