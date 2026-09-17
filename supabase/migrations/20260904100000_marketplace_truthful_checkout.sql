/* Phase 2: server-owned marketplace catalog and pending orders. */
CREATE TABLE IF NOT EXISTS public.marketplace_products (
  id text PRIMARY KEY,
  title text NOT NULL,
  price numeric(10,2) NOT NULL CHECK (price >= 0),
  type text NOT NULL,
  cover_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.marketplace_products (id, title, price, type, cover_url) VALUES
  ('mk1', 'AP Calculus BC Question Bank', 149, 'question_bank', 'https://images.pexels.com/photos/630335/pexels-photo-630335.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('mk2', 'Integrated Web Engineering Bootcamp', 299, 'learning_path', 'https://images.pexels.com/photos/270404/pexels-photo-270404.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('mk3', 'Organic Chemistry Exam Templates', 79, 'exam_template', 'https://images.pexels.com/photos/2280571/pexels-photo-2280571.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('mk4', 'IELTS Conversation Mastery', 89, 'course', 'https://images.pexels.com/photos/256417/pexels-photo-256417.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('mk5', 'Data Structures and Algorithms', 199, 'question_bank', 'https://images.pexels.com/photos/1181271/pexels-photo-1181271.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('mk6', 'Macroeconomics Case Studies', 59, 'digital_resource', 'https://images.pexels.com/photos/534216/pexels-photo-534216.jpeg?auto=compress&cs=tinysrgb&w=600')
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, price = EXCLUDED.price, type = EXCLUDED.type, cover_url = EXCLUDED.cover_url;

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  subtotal numeric(10,2) NOT NULL CHECK (subtotal >= 0),
  total numeric(10,2) NOT NULL CHECK (total >= 0),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  payment_provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS public.marketplace_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.marketplace_products(id),
  title text NOT NULL,
  unit_price numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0)
);
CREATE TABLE IF NOT EXISTS public.marketplace_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL UNIQUE REFERENCES public.marketplace_order_items(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.marketplace_products(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_products_select ON public.marketplace_products FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY marketplace_orders_select ON public.marketplace_orders FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY marketplace_order_items_select ON public.marketplace_order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.marketplace_orders o WHERE o.id = order_id AND o.user_id = auth.uid()));
CREATE POLICY marketplace_entitlements_select ON public.marketplace_entitlements FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.marketplace_orders, public.marketplace_order_items, public.marketplace_entitlements FROM authenticated;
GRANT SELECT ON public.marketplace_products, public.marketplace_orders, public.marketplace_order_items, public.marketplace_entitlements TO authenticated;

CREATE OR REPLACE FUNCTION public.add_marketplace_item_to_cart(p_item_id text)
RETURNS public.cart_items LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE product public.marketplace_products%ROWTYPE; result public.cart_items%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO product FROM public.marketplace_products WHERE id = p_item_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_unavailable'; END IF;
  SELECT * INTO result FROM public.cart_items WHERE user_id = auth.uid() AND item_id = p_item_id LIMIT 1;
  IF FOUND THEN RETURN result; END IF;
  INSERT INTO public.cart_items (user_id, item_id, title, price, cover_url, type)
    VALUES (auth.uid(), product.id, product.title, product.price, product.cover_url, product.type)
    RETURNING * INTO result;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.add_marketplace_item_to_cart(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_marketplace_order(p_idempotency_key text)
RETURNS public.marketplace_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_order public.marketplace_orders%ROWTYPE; new_order public.marketplace_orders%ROWTYPE; total numeric(10,2);
BEGIN
  IF auth.uid() IS NULL OR p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 OR length(p_idempotency_key) > 100 THEN RAISE EXCEPTION 'invalid_checkout'; END IF;
  SELECT * INTO existing_order FROM public.marketplace_orders WHERE user_id = auth.uid() AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN existing_order; END IF;
  SELECT COALESCE(sum(p.price), 0) INTO total FROM public.cart_items c JOIN public.marketplace_products p ON p.id = c.item_id WHERE c.user_id = auth.uid() AND p.is_active;
  IF total <= 0 THEN RAISE EXCEPTION 'cart_empty'; END IF;
  INSERT INTO public.marketplace_orders (user_id, idempotency_key, subtotal, total, status, payment_provider) VALUES (auth.uid(), p_idempotency_key, total, total, 'pending', 'not_configured') RETURNING * INTO new_order;
  INSERT INTO public.marketplace_order_items (order_id, product_id, title, unit_price) SELECT new_order.id, p.id, p.title, p.price FROM public.cart_items c JOIN public.marketplace_products p ON p.id = c.item_id WHERE c.user_id = auth.uid() AND p.is_active;
  DELETE FROM public.cart_items WHERE user_id = auth.uid();
  RETURN new_order;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_marketplace_order(text) TO authenticated;
