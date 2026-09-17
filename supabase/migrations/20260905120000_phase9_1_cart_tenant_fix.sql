/* Phase 9.1 follow-up: preserve the existing non-null cart tenant invariant. */
CREATE OR REPLACE FUNCTION public.add_marketplace_item_to_cart(p_item_id text)
RETURNS public.cart_items LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE product public.marketplace_products%ROWTYPE; result public.cart_items%ROWTYPE; tenant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  tenant_id := public.current_user_institution_id();
  IF tenant_id IS NULL THEN RAISE EXCEPTION 'institution_required'; END IF;
  SELECT * INTO product FROM public.marketplace_products WHERE id = p_item_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_unavailable'; END IF;
  INSERT INTO public.cart_items (user_id, institution_id, item_id, title, price, cover_url, type)
    VALUES (auth.uid(), tenant_id, product.id, product.title, product.price, product.cover_url, product.type)
    ON CONFLICT (user_id, item_id) WHERE user_id IS NOT NULL DO UPDATE
      SET title = EXCLUDED.title, price = EXCLUDED.price, cover_url = EXCLUDED.cover_url, type = EXCLUDED.type, institution_id = EXCLUDED.institution_id
    RETURNING * INTO result;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.add_marketplace_item_to_cart(text) TO authenticated;
