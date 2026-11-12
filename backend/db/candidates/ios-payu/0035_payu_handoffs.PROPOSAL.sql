-- REVIEW PROPOSAL ONLY. Quarantined: not a runner input. Do not apply without
-- separate approval. Adapted to the verified live columns:
--   payments.hotel_booking_id uuid, payments.txnid text,
--   payments.provider / payments.status enums,
--   hotel_bookings.booking_reference text, payment_fulfilment_jobs.payment_id uuid.
-- The PREFLIGHT block also requires columns NOT yet verified live:
--   payments.id, amount, currency, created_at; hotel_bookings.id, status,
--   currency, total_amount. It aborts before any DDL if any is missing.
-- Lock order everywhere: payments -> hotel_bookings -> payu_handoffs (no deadlock).
BEGIN;

DO $$
DECLARE need text[][] := ARRAY[
  ['payments','id'],['payments','hotel_booking_id'],['payments','txnid'],
  ['payments','provider'],['payments','status'],['payments','amount'],
  ['payments','currency'],['payments','created_at'],
  ['hotel_bookings','id'],['hotel_bookings','status'],
  ['hotel_bookings','currency'],['hotel_bookings','total_amount']];
  i int;
BEGIN
  FOR i IN 1..array_length(need,1) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=need[i][1] AND column_name=need[i][2]) THEN
      RAISE EXCEPTION 'payu_handoffs preflight: missing %.%', need[i][1], need[i][2];
    END IF;
  END LOOP;
  IF to_regclass('public.payu_handoffs') IS NOT NULL THEN
    RAISE EXCEPTION 'payu_handoffs preflight: table already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
      WHERE t.typname='payment_status' AND e.enumlabel='created') THEN
    RAISE EXCEPTION 'payu_handoffs preflight: payment_status lacks created';
  END IF;
END $$;

CREATE TABLE public.payu_handoffs (
    token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    payment_id uuid NOT NULL REFERENCES public.payments(id),
    link_no smallint NOT NULL CHECK (link_no BETWEEN 1 AND 3),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    UNIQUE (payment_id, link_no)
);
-- At most one usable link per payment attempt.
CREATE UNIQUE INDEX payu_handoffs_one_active ON public.payu_handoffs(payment_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
GRANT ALL ON public.payu_handoffs TO service_role;
ALTER TABLE public.payu_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payu_handoffs FROM PUBLIC, anon, authenticated;
-- No client policies: service-role RPC access only.

-- Is p_payment_id an iOS-started attempt, and how many links were issued?
CREATE FUNCTION public.payu_handoff_chain(p_payment_id uuid)
RETURNS TABLE(links int) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.payu_handoffs WHERE payment_id = p_payment_id
$$;

-- Issue link #1 (new attempt) or a replacement for the SAME attempt.
CREATE FUNCTION public.payu_issue_handoff(p_payment_id uuid, p_token_hash text, p_expires_at timestamptz)
RETURNS TABLE(link_no smallint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.payments%ROWTYPE; b public.hotel_bookings%ROWTYPE; n int;
BEGIN
  IF p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '120 seconds' THEN RETURN; END IF;
  SELECT * INTO p FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR p.hotel_booking_id IS NULL THEN RETURN; END IF;
  SELECT * INTO b FROM public.hotel_bookings WHERE id = p.hotel_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- Only an untouched attempt: no PayU return/webhook has moved it on.
  IF p.provider::text <> 'payu' OR p.status::text <> 'created' OR b.status::text <> 'DRAFT'
     OR p.currency <> 'INR' OR b.currency <> 'INR' OR p.amount <= 0
     OR p.amount IS DISTINCT FROM b.total_amount
     OR p.created_at < clock_timestamp() - interval '15 minutes' THEN RETURN; END IF;
  SELECT count(*) INTO n FROM public.payu_handoffs WHERE payment_id = p_payment_id;
  IF n >= 3 THEN RETURN; END IF;
  -- Replacements only for attempts begun by a handoff (n > 0) or a brand-new
  -- attempt created moments ago by the same request (n = 0).
  UPDATE public.payu_handoffs SET revoked_at = clock_timestamp()
    WHERE payment_id = p_payment_id AND consumed_at IS NULL AND revoked_at IS NULL;
  INSERT INTO public.payu_handoffs(token_hash, payment_id, link_no, expires_at)
    VALUES (p_token_hash, p_payment_id, n + 1, p_expires_at);
  RETURN QUERY SELECT (n + 1)::smallint;
END; $$;

-- Burn a link exactly once; concurrent redemptions serialize on the payment lock.
CREATE FUNCTION public.payu_consume_handoff(p_token_hash text)
RETURNS TABLE(payment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; h public.payu_handoffs%ROWTYPE;
        p public.payments%ROWTYPE; b public.hotel_bookings%ROWTYPE;
BEGIN
  SELECT x.payment_id INTO pid FROM public.payu_handoffs x WHERE x.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO p FROM public.payments WHERE id = pid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO b FROM public.hotel_bookings WHERE id = p.hotel_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO h FROM public.payu_handoffs x WHERE x.token_hash = p_token_hash FOR UPDATE;
  IF h.consumed_at IS NOT NULL OR h.revoked_at IS NOT NULL
     OR h.expires_at <= clock_timestamp() THEN RETURN; END IF;
  UPDATE public.payu_handoffs SET consumed_at = clock_timestamp() WHERE token_hash = p_token_hash;
  IF p.provider::text <> 'payu' OR p.status::text NOT IN ('created','pending')
     OR b.status::text <> 'DRAFT' OR p.currency <> 'INR' OR b.currency <> 'INR'
     OR p.amount IS DISTINCT FROM b.total_amount OR p.amount <= 0 THEN RETURN; END IF;
  RETURN QUERY SELECT pid;
END; $$;

REVOKE ALL ON FUNCTION public.payu_handoff_chain(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payu_issue_handoff(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payu_consume_handoff(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payu_handoff_chain(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.payu_issue_handoff(uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.payu_consume_handoff(text) TO service_role;
COMMIT;
