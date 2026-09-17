/* Phase 9.2: explicit fulfillment boundary without inventing a resource consumer. */
ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS fulfillment_target_type text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS fulfillment_target_key text;

ALTER TABLE public.marketplace_products
  DROP CONSTRAINT IF EXISTS marketplace_products_fulfillment_target_check;
ALTER TABLE public.marketplace_products
  ADD CONSTRAINT marketplace_products_fulfillment_target_check CHECK (
    (fulfillment_target_type = 'unavailable' AND fulfillment_target_key IS NULL)
    OR (fulfillment_target_type IN ('course', 'question_bank', 'exam_template', 'learning_path', 'digital_resource')
        AND fulfillment_target_key IS NOT NULL)
  );

ALTER TABLE public.marketplace_entitlements
  ADD COLUMN IF NOT EXISTS fulfillment_target_type text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS fulfillment_target_key text,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_reason text;

ALTER TABLE public.marketplace_entitlements
  DROP CONSTRAINT IF EXISTS marketplace_entitlements_fulfillment_target_check;
ALTER TABLE public.marketplace_entitlements
  ADD CONSTRAINT marketplace_entitlements_fulfillment_target_check CHECK (
    (fulfillment_target_type = 'unavailable' AND fulfillment_target_key IS NULL)
    OR (fulfillment_target_type IN ('course', 'question_bank', 'exam_template', 'learning_path', 'digital_resource')
        AND fulfillment_target_key IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_entitlements_user_target_unique
  ON public.marketplace_entitlements (user_id, fulfillment_target_type, fulfillment_target_key)
  WHERE status = 'active' AND fulfillment_target_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.activate_marketplace_entitlement(p_order_id uuid)
RETURNS SETOF public.marketplace_entitlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item_record record; existing_record public.marketplace_entitlements%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND public.current_user_role() NOT IN ('super_admin') THEN
    RAISE EXCEPTION 'trusted_activation_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.marketplace_orders WHERE id = p_order_id AND status = 'paid') THEN
    RAISE EXCEPTION 'order_not_paid';
  END IF;
  FOR item_record IN
    SELECT o.user_id, oi.id AS order_item_id, oi.product_id, p.fulfillment_target_type, p.fulfillment_target_key
    FROM public.marketplace_orders o
    JOIN public.marketplace_order_items oi ON oi.order_id = o.id
    JOIN public.marketplace_products p ON p.id = oi.product_id
    WHERE o.id = p_order_id
  LOOP
    IF item_record.fulfillment_target_type = 'unavailable' OR item_record.fulfillment_target_key IS NULL THEN
      RAISE EXCEPTION 'fulfillment_target_unavailable';
    END IF;
    SELECT * INTO existing_record FROM public.marketplace_entitlements
    WHERE user_id = item_record.user_id AND order_item_id = item_record.order_item_id;
    IF FOUND THEN
      IF existing_record.status <> 'active' THEN
        UPDATE public.marketplace_entitlements SET status = 'active', activated_at = COALESCE(activated_at, now()), revoked_at = NULL, revocation_reason = NULL WHERE id = existing_record.id RETURNING * INTO existing_record;
      END IF;
    ELSE
      INSERT INTO public.marketplace_entitlements (user_id, order_item_id, product_id, status, fulfillment_target_type, fulfillment_target_key, activated_at)
      VALUES (item_record.user_id, item_record.order_item_id, item_record.product_id, 'active', item_record.fulfillment_target_type, item_record.fulfillment_target_key, now())
      RETURNING * INTO existing_record;
    END IF;
    RETURN NEXT existing_record;
  END LOOP;
END; $$;

REVOKE ALL ON FUNCTION public.activate_marketplace_entitlement(uuid) FROM PUBLIC, anon, authenticated;
