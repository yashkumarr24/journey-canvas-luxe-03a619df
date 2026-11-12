-- REVIEW PROPOSAL ONLY. Not a runner input; do not apply in Phase 1.
-- Requires independent staging schema verification: this is the branch's
-- payments.hotel_booking_id -> hotel_bookings.id contract, NOT a VPS ledger.
BEGIN;
CREATE TABLE public.payu_handoffs (
    token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);
GRANT ALL ON public.payu_handoffs TO service_role;
ALTER TABLE public.payu_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payu_handoffs FROM anon, authenticated;
-- No client policies: service-role access only.

CREATE FUNCTION public.payu_handoff_validate_lifetime()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NEW.expires_at <= clock_timestamp()
       OR NEW.expires_at > NEW.created_at + interval '120 seconds' THEN
        RAISE EXCEPTION 'Invalid handoff lifetime';
    END IF;
    RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payu_handoff_validate_lifetime() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER payu_handoff_lifetime BEFORE INSERT ON public.payu_handoffs
FOR EACH ROW EXECUTE FUNCTION public.payu_handoff_validate_lifetime();

CREATE FUNCTION public.payu_consume_handoff(p_token_hash text)
RETURNS TABLE(payment_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h public.payu_handoffs%ROWTYPE;
        p public.payments%ROWTYPE;
        b public.hotel_bookings%ROWTYPE;
BEGIN
    SELECT * INTO h FROM public.payu_handoffs
      WHERE token_hash = p_token_hash FOR UPDATE;
    IF NOT FOUND OR h.consumed_at IS NOT NULL OR h.expires_at <= clock_timestamp()
       OR h.expires_at > h.created_at + interval '120 seconds' THEN RETURN; END IF;
    SELECT * INTO p FROM public.payments WHERE id = h.payment_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT * INTO b FROM public.hotel_bookings WHERE id = p.hotel_booking_id FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    IF h.expires_at <= clock_timestamp() THEN RETURN; END IF;
    -- Burn once even if the booking/payment can no longer be paid.
    UPDATE public.payu_handoffs SET consumed_at = clock_timestamp() WHERE token_hash = p_token_hash;
    IF p.provider::text <> 'payu' OR p.status::text NOT IN ('created','pending')
       OR b.status::text <> 'DRAFT' OR p.currency <> 'INR' OR b.currency <> 'INR'
       OR p.amount IS DISTINCT FROM b.total_amount OR p.amount <= 0 THEN RETURN; END IF;
    RETURN QUERY SELECT h.payment_id;
END; $$;
REVOKE ALL ON FUNCTION public.payu_consume_handoff(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payu_consume_handoff(text) TO service_role;
COMMIT;