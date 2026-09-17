/* Serialize/retry trusted activation without surfacing a uniqueness race. */
CREATE OR REPLACE FUNCTION public.activate_marketplace_entitlement(p_order_id uuid)
RETURNS SETOF public.marketplace_entitlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item_record record; existing_record public.marketplace_entitlements%ROWTYPE; target_bank public.question_banks%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND public.current_user_role() <> 'super_admin' THEN RAISE EXCEPTION 'trusted_activation_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.marketplace_orders WHERE id = p_order_id AND status = 'paid') THEN RAISE EXCEPTION 'order_not_paid'; END IF;
  FOR item_record IN
    SELECT o.user_id, oi.id AS order_item_id, oi.product_id, p.type, p.fulfillment_target_type, p.question_bank_id
    FROM public.marketplace_orders o JOIN public.marketplace_order_items oi ON oi.order_id = o.id JOIN public.marketplace_products p ON p.id = oi.product_id
    WHERE o.id = p_order_id
  LOOP
    IF item_record.type <> 'question_bank' OR item_record.fulfillment_target_type <> 'question_bank' OR item_record.question_bank_id IS NULL THEN RAISE EXCEPTION 'unsupported_fulfillment_target'; END IF;
    SELECT * INTO target_bank FROM public.question_banks WHERE id = item_record.question_bank_id AND status = 'published';
    IF NOT FOUND THEN RAISE EXCEPTION 'fulfillment_target_unavailable'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(item_record.user_id::text || ':' || target_bank.id::text, 0));
    INSERT INTO public.marketplace_entitlements (user_id, order_item_id, product_id, status, fulfillment_target_type, fulfillment_target_key, activated_at)
    VALUES (item_record.user_id, item_record.order_item_id, item_record.product_id, 'active', 'question_bank', target_bank.id::text, now())
    ON CONFLICT DO NOTHING RETURNING * INTO existing_record;
    IF NOT FOUND THEN
      SELECT * INTO existing_record FROM public.marketplace_entitlements
      WHERE user_id = item_record.user_id AND fulfillment_target_type = 'question_bank' AND fulfillment_target_key = target_bank.id::text AND status = 'active'
      ORDER BY activated_at NULLS LAST, id LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION 'entitlement_activation_race'; END IF;
    END IF;
    RETURN NEXT existing_record;
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.activate_marketplace_entitlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_marketplace_entitlement(uuid) TO service_role;
