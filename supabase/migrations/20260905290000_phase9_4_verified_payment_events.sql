/* Only a trusted, already verified provider adapter may call this boundary. */
CREATE OR REPLACE FUNCTION public.process_verified_marketplace_payment_event(
  p_provider text,
  p_provider_event_id text,
  p_provider_payment_id text,
  p_order_id uuid,
  p_event_type text,
  p_payment_status text,
  p_amount numeric,
  p_currency text,
  p_occurred_at timestamptz DEFAULT now(),
  p_failure_code text DEFAULT NULL,
  p_failure_message text DEFAULT NULL
)
RETURNS public.marketplace_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  payment_row public.marketplace_payments%ROWTYPE;
  event_inserted integer;
  order_status text;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'trusted_payment_processor_required'; END IF;
  IF p_provider IS NULL OR length(p_provider) < 2 OR p_provider_event_id IS NULL OR p_provider_payment_id IS NULL
     OR p_order_id IS NULL OR p_event_type IS NULL OR p_payment_status NOT IN ('pending','paid','failed','cancelled','refunded')
     OR p_currency <> 'USD' OR p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_verified_payment_event';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_provider_payment_id, 0));
  SELECT * INTO payment_row FROM public.marketplace_payments
    WHERE provider = p_provider AND provider_payment_id = p_provider_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_payment'; END IF;
  IF payment_row.order_id <> p_order_id THEN RAISE EXCEPTION 'payment_order_mismatch'; END IF;
  IF payment_row.amount <> p_amount OR payment_row.currency <> p_currency THEN RAISE EXCEPTION 'payment_amount_or_currency_mismatch'; END IF;
  INSERT INTO public.marketplace_payment_events (payment_id, provider, provider_event_id, event_type, payment_status, amount, currency, occurred_at)
    VALUES (payment_row.id, p_provider, p_provider_event_id, p_event_type, p_payment_status, p_amount, p_currency, p_occurred_at)
    ON CONFLICT (provider, provider_event_id) DO NOTHING;
  GET DIAGNOSTICS event_inserted = ROW_COUNT;
  IF event_inserted = 0 OR payment_row.status = 'paid' THEN RETURN payment_row; END IF;
  IF p_payment_status = 'paid' THEN
    SELECT status INTO order_status FROM public.marketplace_orders WHERE id = payment_row.order_id FOR UPDATE;
    IF order_status NOT IN ('pending','paid') THEN RAISE EXCEPTION 'order_not_payable'; END IF;
    UPDATE public.marketplace_payments SET status = 'paid', paid_at = COALESCE(p_occurred_at, now()), updated_at = now(), failure_code = NULL, failure_message = NULL WHERE id = payment_row.id RETURNING * INTO payment_row;
    UPDATE public.marketplace_orders SET status = 'paid', payment_provider = p_provider WHERE id = payment_row.order_id AND status = 'pending';
    PERFORM 1 FROM public.activate_marketplace_entitlement(payment_row.order_id);
  ELSIF p_payment_status IN ('pending','failed','cancelled','refunded') THEN
    UPDATE public.marketplace_payments SET status = p_payment_status, updated_at = now(), failure_code = p_failure_code, failure_message = p_failure_message WHERE id = payment_row.id RETURNING * INTO payment_row;
  END IF;
  RETURN payment_row;
END; $$;
REVOKE ALL ON FUNCTION public.process_verified_marketplace_payment_event(text,text,text,uuid,text,text,numeric,text,timestamptz,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_verified_marketplace_payment_event(text,text,text,uuid,text,text,numeric,text,timestamptz,text,text) TO service_role;
