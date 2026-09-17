-- Phase B.4: opaque, server-owned page identity for v2 sheets.

CREATE TABLE IF NOT EXISTS public.bubble_sheet_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bubble_sheet_id uuid NOT NULL REFERENCES public.bubble_sheets(id) ON DELETE CASCADE,
  page_token uuid NOT NULL DEFAULT gen_random_uuid(),
  page_index integer NOT NULL CHECK (page_index >= 1),
  page_count integer NOT NULL CHECK (page_count >= 1),
  layout_schema_version integer NOT NULL CHECK (layout_schema_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_token), UNIQUE (bubble_sheet_id, page_index)
);
CREATE INDEX IF NOT EXISTS bubble_sheet_pages_sheet_idx ON public.bubble_sheet_pages(bubble_sheet_id, page_index);
ALTER TABLE public.bubble_sheet_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bubble_sheet_pages FROM PUBLIC, anon, authenticated;

INSERT INTO public.bubble_sheet_pages(bubble_sheet_id, page_index, page_count, layout_schema_version)
SELECT b.id, pages.page_index, count_row.page_count, COALESCE(b.layout_schema_version, 1)
FROM public.bubble_sheets b
CROSS JOIN LATERAL (SELECT COALESCE(max(q.page_number), 1)::integer AS page_count FROM public.bubble_sheet_questions q WHERE q.bubble_sheet_id = b.id) count_row
CROSS JOIN LATERAL generate_series(1, count_row.page_count) AS pages(page_index)
WHERE b.snapshot_state = 'exact' AND b.is_finalized
ON CONFLICT (bubble_sheet_id, page_index) DO NOTHING;

CREATE OR REPLACE FUNCTION public.populate_bubble_sheet_page_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_page_count integer;
BEGIN
  IF NEW.snapshot_state = 'exact' AND NEW.is_finalized AND (TG_OP = 'INSERT' OR OLD.snapshot_state IS DISTINCT FROM 'exact' OR NOT OLD.is_finalized) THEN
    SELECT COALESCE(max(q.page_number), 1) INTO v_page_count FROM public.bubble_sheet_questions q WHERE q.bubble_sheet_id = NEW.id;
    INSERT INTO public.bubble_sheet_pages(bubble_sheet_id, page_index, page_count, layout_schema_version)
    SELECT NEW.id, page_index, v_page_count, COALESCE(NEW.layout_schema_version, 1) FROM generate_series(1, v_page_count) AS page_index
    ON CONFLICT (bubble_sheet_id, page_index) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_populate_bubble_sheet_page_identity ON public.bubble_sheets;
CREATE TRIGGER trg_populate_bubble_sheet_page_identity AFTER INSERT OR UPDATE ON public.bubble_sheets FOR EACH ROW EXECUTE FUNCTION public.populate_bubble_sheet_page_identity();

CREATE OR REPLACE FUNCTION public.reject_finalized_bubble_sheet_page_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.bubble_sheet_id IS DISTINCT FROM OLD.bubble_sheet_id OR NEW.page_token IS DISTINCT FROM OLD.page_token OR NEW.page_index IS DISTINCT FROM OLD.page_index OR NEW.page_count IS DISTINCT FROM OLD.page_count OR NEW.layout_schema_version IS DISTINCT FROM OLD.layout_schema_version THEN
    IF EXISTS (SELECT 1 FROM public.bubble_sheets b WHERE b.id = COALESCE(OLD.bubble_sheet_id, NEW.bubble_sheet_id) AND b.is_finalized) THEN RAISE EXCEPTION 'finalized_bubble_sheet_layout_immutable'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_reject_finalized_bubble_sheet_page_mutation ON public.bubble_sheet_pages;
CREATE TRIGGER trg_reject_finalized_bubble_sheet_page_mutation BEFORE UPDATE OR DELETE ON public.bubble_sheet_pages FOR EACH ROW EXECUTE FUNCTION public.reject_finalized_bubble_sheet_page_mutation();

CREATE OR REPLACE FUNCTION public.resolve_v2_page_identity(p_page_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_page public.bubble_sheet_pages%ROWTYPE; v_sheet public.bubble_sheets%ROWTYPE;
BEGIN
  SELECT * INTO v_page FROM public.bubble_sheet_pages WHERE page_token = p_page_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'omr_page_identity_not_found'; END IF;
  SELECT * INTO v_sheet FROM public.bubble_sheets WHERE id = v_page.bubble_sheet_id;
  IF NOT FOUND OR v_sheet.snapshot_state <> 'exact' OR NOT v_sheet.is_finalized THEN RAISE EXCEPTION 'omr_page_identity_not_found'; END IF;
  IF v_page.layout_schema_version <> COALESCE(v_sheet.layout_schema_version, 1) THEN RAISE EXCEPTION 'omr_page_identity_version_mismatch'; END IF;
  RETURN jsonb_build_object('bubble_sheet_id',v_sheet.id,'snapshot_id',v_sheet.id,'exam_id',v_sheet.exam_id,'institution_id',v_sheet.institution_id,'page_index',v_page.page_index,'page_count',v_page.page_count,'layout_schema_version',v_page.layout_schema_version);
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_v2_page_identity(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_v2_page_identity(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_v2_page_set(p_page_tokens uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_sheet uuid; v_count integer; v_expected integer; v_min integer; v_max integer;
BEGIN
  IF p_page_tokens IS NULL OR cardinality(p_page_tokens)=0 THEN RAISE EXCEPTION 'omr_page_set_empty'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_page_tokens) token GROUP BY token HAVING count(*)>1) THEN RAISE EXCEPTION 'omr_page_set_duplicate'; END IF;
  SELECT count(*) INTO v_count FROM public.bubble_sheet_pages WHERE page_token=ANY(p_page_tokens);
  IF v_count<>cardinality(p_page_tokens) THEN RAISE EXCEPTION 'omr_page_identity_not_found'; END IF;
  IF (SELECT count(DISTINCT p.bubble_sheet_id) FROM public.bubble_sheet_pages p WHERE p.page_token=ANY(p_page_tokens))<>1 THEN RAISE EXCEPTION 'omr_page_set_mixed_sheet'; END IF;
  SELECT p.bubble_sheet_id,min(p.page_index),max(p.page_index),max(p.page_count) INTO v_sheet,v_min,v_max,v_expected FROM public.bubble_sheet_pages p WHERE p.page_token=ANY(p_page_tokens) GROUP BY p.bubble_sheet_id;
  IF v_count<>v_expected OR v_min<>1 OR v_max<>v_expected OR EXISTS (SELECT 1 FROM public.bubble_sheet_pages p WHERE p.bubble_sheet_id=v_sheet AND p.page_index BETWEEN 1 AND v_expected AND p.page_token<>ALL(p_page_tokens)) THEN RAISE EXCEPTION 'omr_page_set_incomplete'; END IF;
  RETURN jsonb_build_object('bubble_sheet_id',v_sheet,'page_count',v_expected,'valid',true);
END;
$$;
REVOKE ALL ON FUNCTION public.validate_v2_page_set(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_v2_page_set(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.get_v2_finalized_bubble_sheet_layout(p_bubble_sheet_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_layout jsonb;
BEGIN
  v_layout := public.get_finalized_bubble_sheet_layout(p_bubble_sheet_id);
  RETURN jsonb_set(v_layout, '{pages}', COALESCE((SELECT jsonb_agg(jsonb_build_object('page_index',p.page_index,'page_count',p.page_count,'layout_schema_version',p.layout_schema_version,'page_token',p.page_token) ORDER BY p.page_index) FROM public.bubble_sheet_pages p WHERE p.bubble_sheet_id=p_bubble_sheet_id),'[]'::jsonb), true);
END;
$$;
REVOKE ALL ON FUNCTION public.get_v2_finalized_bubble_sheet_layout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_v2_finalized_bubble_sheet_layout(uuid) TO authenticated;
