/* Phase 9.3: first real fulfillment target — institution-owned question banks. */
CREATE TABLE IF NOT EXISTS public.question_banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  owner_staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_bank_id uuid REFERENCES public.question_banks(id) ON DELETE RESTRICT;
ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS question_bank_id uuid REFERENCES public.question_banks(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_questions_question_bank_id ON public.questions(question_bank_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_products_question_bank_id ON public.marketplace_products(question_bank_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_entitlements_user_target ON public.marketplace_entitlements(user_id, fulfillment_target_type, fulfillment_target_key, status);

ALTER TABLE public.question_banks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS question_banks_select ON public.question_banks;
CREATE POLICY question_banks_select ON public.question_banks FOR SELECT TO authenticated USING (
  (institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader', 'data_entry'))
  OR EXISTS (
    SELECT 1 FROM public.marketplace_entitlements e
    WHERE e.user_id = auth.uid() AND e.status = 'active'
      AND e.fulfillment_target_type = 'question_bank'
      AND e.fulfillment_target_key = question_banks.id::text
      AND question_banks.status = 'published'
  )
);
DROP POLICY IF EXISTS question_banks_insert ON public.question_banks;
CREATE POLICY question_banks_insert ON public.question_banks FOR INSERT TO authenticated WITH CHECK (
  institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('super_admin', 'school_admin')
);
DROP POLICY IF EXISTS question_banks_update ON public.question_banks;
CREATE POLICY question_banks_update ON public.question_banks FOR UPDATE TO authenticated USING (
  institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('super_admin', 'school_admin')
) WITH CHECK (institution_id = public.current_user_institution_id());
DROP POLICY IF EXISTS question_banks_delete ON public.question_banks;
CREATE POLICY question_banks_delete ON public.question_banks FOR DELETE TO authenticated USING (
  institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('super_admin', 'school_admin')
);
REVOKE ALL ON public.question_banks FROM anon;
GRANT SELECT ON public.question_banks TO authenticated;

DROP POLICY IF EXISTS questions_marketplace_select ON public.questions;
CREATE POLICY questions_marketplace_select ON public.questions FOR SELECT TO authenticated USING (
  question_bank_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.marketplace_entitlements e
    JOIN public.question_banks qb ON qb.id::text = e.fulfillment_target_key
    WHERE e.user_id = auth.uid() AND e.status = 'active'
      AND e.fulfillment_target_type = 'question_bank'
      AND qb.id = questions.question_bank_id AND qb.status = 'published'
  )
);

CREATE OR REPLACE FUNCTION public.map_marketplace_product_to_question_bank(p_product_id text, p_question_bank_id uuid)
RETURNS public.marketplace_products
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.marketplace_products%ROWTYPE; bank public.question_banks%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO bank FROM public.question_banks WHERE id = p_question_bank_id AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'question_bank_unavailable'; END IF;
  UPDATE public.marketplace_products p
  SET type = 'question_bank', fulfillment_target_type = 'question_bank', fulfillment_target_key = bank.id::text, question_bank_id = bank.id
  WHERE p.id = p_product_id
    AND p.owner_type = 'institution'
    AND p.institution_id = bank.institution_id
    AND p.owner_user_id = auth.uid()
    AND bank.institution_id = public.current_user_institution_id()
    AND public.current_user_role() IN ('school_admin', 'super_admin')
  RETURNING p.* INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'question_bank_mapping_forbidden'; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.map_marketplace_product_to_question_bank(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.map_marketplace_product_to_question_bank(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_marketplace_question_bank(p_product_id text)
RETURNS TABLE (question_bank_id uuid, question_id uuid, prompt text, question_type text, points numeric, options jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid;
BEGIN
  SELECT p.question_bank_id INTO target
  FROM public.marketplace_products p
  JOIN public.marketplace_entitlements e ON e.product_id = p.id AND e.user_id = auth.uid() AND e.status = 'active'
  WHERE p.id = p_product_id AND p.type = 'question_bank' AND p.fulfillment_target_type = 'question_bank';
  IF target IS NULL OR NOT EXISTS (SELECT 1 FROM public.question_banks qb WHERE qb.id = target AND qb.status = 'published') THEN
    RAISE EXCEPTION 'question_bank_access_denied';
  END IF;
  RETURN QUERY
  SELECT q.question_bank_id, q.id, q.prompt, q.type, q.points,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', qo.id, 'label', qo.label, 'sort_order', qo.sort_order) ORDER BY qo.sort_order) FROM public.question_options qo WHERE qo.question_id = q.id), '[]'::jsonb)
  FROM public.questions q
  WHERE q.question_bank_id = target;
END; $$;
REVOKE ALL ON FUNCTION public.get_marketplace_question_bank(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_marketplace_question_bank(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_marketplace_entitlement(p_order_id uuid)
RETURNS SETOF public.marketplace_entitlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item_record record; existing_record public.marketplace_entitlements%ROWTYPE; target_bank public.question_banks%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND public.current_user_role() <> 'super_admin' THEN RAISE EXCEPTION 'trusted_activation_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.marketplace_orders WHERE id = p_order_id AND status = 'paid') THEN RAISE EXCEPTION 'order_not_paid'; END IF;
  FOR item_record IN
    SELECT o.user_id, oi.id AS order_item_id, oi.product_id, p.type, p.fulfillment_target_type, p.fulfillment_target_key, p.question_bank_id
    FROM public.marketplace_orders o JOIN public.marketplace_order_items oi ON oi.order_id = o.id JOIN public.marketplace_products p ON p.id = oi.product_id
    WHERE o.id = p_order_id
  LOOP
    IF item_record.type <> 'question_bank' OR item_record.fulfillment_target_type <> 'question_bank' THEN RAISE EXCEPTION 'unsupported_fulfillment_target'; END IF;
    SELECT * INTO target_bank FROM public.question_banks WHERE id = item_record.question_bank_id AND status = 'published';
    IF NOT FOUND THEN RAISE EXCEPTION 'fulfillment_target_unavailable'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(item_record.user_id::text || ':' || target_bank.id::text, 0));
    SELECT * INTO existing_record FROM public.marketplace_entitlements WHERE user_id = item_record.user_id AND order_item_id = item_record.order_item_id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.marketplace_entitlements (user_id, order_item_id, product_id, status, fulfillment_target_type, fulfillment_target_key, activated_at)
      VALUES (item_record.user_id, item_record.order_item_id, item_record.product_id, 'active', 'question_bank', target_bank.id::text, now()) RETURNING * INTO existing_record;
    ELSIF existing_record.status <> 'active' THEN
      UPDATE public.marketplace_entitlements SET status = 'active', activated_at = COALESCE(activated_at, now()), revoked_at = NULL, revocation_reason = NULL WHERE id = existing_record.id RETURNING * INTO existing_record;
    END IF;
    RETURN NEXT existing_record;
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.activate_marketplace_entitlement(uuid) FROM PUBLIC, anon, authenticated;
