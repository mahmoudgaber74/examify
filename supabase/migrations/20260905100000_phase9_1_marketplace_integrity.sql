/* Phase 9.1: marketplace ownership, authorization, and transactional checkout. */

ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;

ALTER TABLE public.marketplace_products
  DROP CONSTRAINT IF EXISTS marketplace_products_owner_check;
ALTER TABLE public.marketplace_products
  ADD CONSTRAINT marketplace_products_owner_check CHECK (
    (owner_type = 'platform' AND owner_user_id IS NULL AND institution_id IS NULL)
    OR (owner_type = 'institution' AND institution_id IS NOT NULL)
  );

UPDATE public.marketplace_products
SET owner_type = 'platform', owner_user_id = NULL, institution_id = NULL
WHERE owner_type IS NULL OR owner_type NOT IN ('platform', 'institution');

ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_products_select ON public.marketplace_products;
CREATE POLICY marketplace_products_select ON public.marketplace_products
  FOR SELECT TO authenticated USING (is_active = true);
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_products FROM anon, authenticated;
GRANT SELECT ON public.marketplace_products TO authenticated;

DROP POLICY IF EXISTS secure_cart_select ON public.cart_items;
DROP POLICY IF EXISTS secure_cart_insert ON public.cart_items;
DROP POLICY IF EXISTS secure_cart_delete ON public.cart_items;
DROP POLICY IF EXISTS marketplace_cart_select ON public.cart_items;
DROP POLICY IF EXISTS marketplace_cart_insert ON public.cart_items;
DROP POLICY IF EXISTS marketplace_cart_delete ON public.cart_items;
CREATE POLICY marketplace_cart_select ON public.cart_items
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY marketplace_cart_insert ON public.cart_items
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY marketplace_cart_delete ON public.cart_items
  FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.cart_items FROM anon, authenticated;
GRANT SELECT, DELETE ON public.cart_items TO authenticated;

DELETE FROM public.cart_items older
WHERE older.user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.cart_items newer
    WHERE newer.user_id = older.user_id AND newer.item_id = older.item_id
      AND newer.created_at > older.created_at
  );

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_cart_user_item_unique
  ON public.cart_items (user_id, item_id) WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_marketplace_product(
  p_id text,
  p_title text,
  p_price numeric,
  p_type text,
  p_cover_url text DEFAULT NULL,
  p_institution_id uuid DEFAULT NULL
)
RETURNS public.marketplace_products
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.marketplace_products%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_id IS NULL OR length(trim(p_id)) = 0
     OR p_title IS NULL OR length(trim(p_title)) = 0 OR p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'invalid_product';
  END IF;
  IF public.current_user_role() = 'super_admin' THEN
    IF p_institution_id IS NOT NULL THEN RAISE EXCEPTION 'invalid_platform_scope'; END IF;
    INSERT INTO public.marketplace_products (id, title, price, type, cover_url, owner_type)
      VALUES (p_id, p_title, p_price, p_type, p_cover_url, 'platform') RETURNING * INTO result;
  ELSIF public.current_user_role() = 'school_admin'
        AND p_institution_id IS NOT NULL
        AND p_institution_id = public.current_user_institution_id() THEN
    INSERT INTO public.marketplace_products (id, title, price, type, cover_url, owner_type, owner_user_id, institution_id)
      VALUES (p_id, p_title, p_price, p_type, p_cover_url, 'institution', auth.uid(), p_institution_id)
      RETURNING * INTO result;
  ELSE
    RAISE EXCEPTION 'marketplace_management_forbidden';
  END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.update_marketplace_product(
  p_id text,
  p_title text,
  p_price numeric,
  p_type text,
  p_cover_url text DEFAULT NULL
)
RETURNS public.marketplace_products
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.marketplace_products%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'invalid_product'; END IF;
  UPDATE public.marketplace_products
  SET title = p_title, price = p_price, type = p_type, cover_url = p_cover_url
  WHERE id = p_id
    AND (public.current_user_role() = 'super_admin'
      OR (public.current_user_role() = 'school_admin'
          AND owner_type = 'institution'
          AND institution_id = public.current_user_institution_id()
          AND owner_user_id = auth.uid()))
  RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'marketplace_management_forbidden'; END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.set_marketplace_product_active(p_id text, p_is_active boolean)
RETURNS public.marketplace_products
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.marketplace_products%ROWTYPE;
BEGIN
  UPDATE public.marketplace_products
  SET is_active = p_is_active
  WHERE id = p_id
    AND (public.current_user_role() = 'super_admin'
      OR (public.current_user_role() = 'school_admin'
          AND owner_type = 'institution'
          AND institution_id = public.current_user_institution_id()
          AND owner_user_id = auth.uid()))
  RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'marketplace_management_forbidden'; END IF;
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.create_marketplace_product(text, text, numeric, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_marketplace_product(text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_marketplace_product_active(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_marketplace_product(text, text, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_marketplace_product(text, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_marketplace_product_active(text, boolean) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.create_marketplace_order(p_idempotency_key text)
RETURNS public.marketplace_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_order public.marketplace_orders%ROWTYPE; new_order public.marketplace_orders%ROWTYPE; total numeric(10,2);
BEGIN
  IF auth.uid() IS NULL OR p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 100 THEN
    RAISE EXCEPTION 'invalid_checkout';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_idempotency_key, 0));
  SELECT * INTO existing_order FROM public.marketplace_orders WHERE user_id = auth.uid() AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN existing_order; END IF;
  PERFORM 1
  FROM public.cart_items c JOIN public.marketplace_products p ON p.id = c.item_id AND p.is_active
  WHERE c.user_id = auth.uid() FOR UPDATE OF c, p;
  SELECT COALESCE(sum(p.price), 0)::numeric(10,2) INTO total
  FROM public.cart_items c JOIN public.marketplace_products p ON p.id = c.item_id AND p.is_active
  WHERE c.user_id = auth.uid();
  IF total <= 0 THEN RAISE EXCEPTION 'cart_empty'; END IF;
  INSERT INTO public.marketplace_orders (user_id, idempotency_key, subtotal, total, status, payment_provider)
    VALUES (auth.uid(), p_idempotency_key, total, total, 'pending', 'not_configured') RETURNING * INTO new_order;
  INSERT INTO public.marketplace_order_items (order_id, product_id, title, unit_price, quantity)
    SELECT new_order.id, p.id, p.title, p.price, 1
    FROM public.cart_items c JOIN public.marketplace_products p ON p.id = c.item_id AND p.is_active
    WHERE c.user_id = auth.uid();
  DELETE FROM public.cart_items WHERE user_id = auth.uid();
  RETURN new_order;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_marketplace_order(text) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.marketplace_orders, public.marketplace_order_items, public.marketplace_entitlements FROM anon, authenticated;
