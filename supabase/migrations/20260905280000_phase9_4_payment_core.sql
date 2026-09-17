/* Phase 9.4: provider-neutral payment authority. No provider is selected here. */
CREATE TABLE IF NOT EXISTS public.marketplace_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE RESTRICT,
  client_idempotency_key text NOT NULL,
  provider text NOT NULL DEFAULT 'unconfigured',
  provider_payment_id text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','paid','failed','cancelled','refunded')),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  UNIQUE (order_id, client_idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_payments_provider_payment_uidx
  ON public.marketplace_payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_payments_one_paid_order_uidx
  ON public.marketplace_payments(order_id) WHERE status = 'paid';

CREATE TABLE IF NOT EXISTS public.marketplace_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.marketplace_payments(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payment_status text NOT NULL CHECK (payment_status IN ('pending','paid','failed','cancelled','refunded')),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

ALTER TABLE public.marketplace_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_payments_select_own ON public.marketplace_payments;
CREATE POLICY marketplace_payments_select_own ON public.marketplace_payments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.marketplace_orders o WHERE o.id = order_id AND o.user_id = auth.uid())
    OR public.current_user_role() = 'super_admin'
  );
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_payments, public.marketplace_payment_events FROM anon, authenticated;
REVOKE ALL ON public.marketplace_payment_events FROM authenticated;
GRANT SELECT ON public.marketplace_payments TO authenticated;
GRANT ALL ON public.marketplace_payments, public.marketplace_payment_events TO service_role;

CREATE OR REPLACE FUNCTION public.create_marketplace_payment(
  p_order_id uuid,
  p_client_idempotency_key text
)
RETURNS public.marketplace_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  existing_payment public.marketplace_payments%ROWTYPE;
  created_payment public.marketplace_payments%ROWTYPE;
  order_row public.marketplace_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_order_id IS NULL OR p_client_idempotency_key IS NULL
     OR length(p_client_idempotency_key) < 8 OR length(p_client_idempotency_key) > 100 THEN
    RAISE EXCEPTION 'invalid_payment_request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_order_id::text || ':' || p_client_idempotency_key, 0));
  SELECT * INTO existing_payment FROM public.marketplace_payments
    WHERE order_id = p_order_id AND client_idempotency_key = p_client_idempotency_key;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.marketplace_orders WHERE id = p_order_id AND user_id = auth.uid()) THEN RAISE EXCEPTION 'order_not_owned'; END IF;
    RETURN existing_payment;
  END IF;
  SELECT * INTO order_row FROM public.marketplace_orders WHERE id = p_order_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_owned'; END IF;
  IF order_row.status <> 'pending' THEN RAISE EXCEPTION 'order_not_payable'; END IF;
  IF order_row.currency <> 'USD' OR order_row.total <= 0 THEN RAISE EXCEPTION 'unsupported_order_currency_or_amount'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.marketplace_order_items oi
    JOIN public.marketplace_entitlements e ON e.order_item_id = oi.id AND e.status = 'active'
    WHERE oi.order_id = order_row.id
  ) THEN RAISE EXCEPTION 'order_already_fulfilled'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.marketplace_order_items oi
    JOIN public.marketplace_products p ON p.id = oi.product_id
    LEFT JOIN public.question_banks qb ON qb.id = p.question_bank_id
    WHERE oi.order_id = order_row.id
      AND (p.type <> 'question_bank' OR p.fulfillment_target_type <> 'question_bank'
           OR p.question_bank_id IS NULL OR qb.status <> 'published')
  ) THEN RAISE EXCEPTION 'fulfillment_target_unavailable'; END IF;
  INSERT INTO public.marketplace_payments (order_id, client_idempotency_key, provider, status, amount, currency)
    VALUES (order_row.id, p_client_idempotency_key, 'unconfigured', 'created', order_row.total, order_row.currency)
    RETURNING * INTO created_payment;
  RETURN created_payment;
END; $$;
REVOKE ALL ON FUNCTION public.create_marketplace_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_marketplace_payment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_marketplace_payment_status(p_payment_id uuid)
RETURNS TABLE (id uuid, order_id uuid, status text, amount numeric, currency text, provider text, failure_code text, failure_message text, created_at timestamptz, updated_at timestamptz, paid_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY SELECT p.id, p.order_id, p.status, p.amount, p.currency, p.provider, p.failure_code, p.failure_message, p.created_at, p.updated_at, p.paid_at
  FROM public.marketplace_payments p JOIN public.marketplace_orders o ON o.id = p.order_id
  WHERE p.id = p_payment_id AND (o.user_id = auth.uid() OR public.current_user_role() = 'super_admin');
END; $$;
REVOKE ALL ON FUNCTION public.get_marketplace_payment_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_marketplace_payment_status(uuid) TO authenticated;
