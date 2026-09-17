-- Phase B.8 Step 1: expose one trusted, finalized v2 page context to the worker.
-- Geometry is read from immutable snapshot rows; no answer-key fields are returned.
CREATE OR REPLACE FUNCTION public.get_v2_finalized_page_processing_context(
  p_page_token uuid,
  p_expected_bubble_sheet_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page public.bubble_sheet_pages%ROWTYPE;
  v_sheet public.bubble_sheets%ROWTYPE;
  v_page_rows integer;
  v_min_page integer;
  v_max_page integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'omr_worker_only';
  END IF;

  SELECT p.* INTO v_page
  FROM public.bubble_sheet_pages p
  WHERE p.page_token = p_page_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'omr_page_identity_not_found';
  END IF;

  SELECT b.* INTO v_sheet
  FROM public.bubble_sheets b
  WHERE b.id = v_page.bubble_sheet_id;
  IF NOT FOUND
     OR v_sheet.snapshot_state <> 'exact'
     OR NOT v_sheet.is_finalized
     OR COALESCE(v_sheet.layout_schema_version, 1) <> 2 THEN
    RAISE EXCEPTION 'omr_v2_snapshot_not_found';
  END IF;

  IF p_expected_bubble_sheet_id IS NOT NULL
     AND p_expected_bubble_sheet_id <> v_sheet.id THEN
    RAISE EXCEPTION 'omr_v2_page_identity_sheet_mismatch';
  END IF;

  SELECT count(*), min(p.page_index), max(p.page_index)
    INTO v_page_rows, v_min_page, v_max_page
  FROM public.bubble_sheet_pages p
  WHERE p.bubble_sheet_id = v_sheet.id;
  IF v_page_rows <> v_page.page_count
     OR v_min_page <> 1
     OR v_max_page <> v_page.page_count
     OR EXISTS (
       SELECT 1
       FROM public.bubble_sheet_pages p
       WHERE p.bubble_sheet_id = v_sheet.id
         AND (p.page_count <> v_page.page_count
           OR p.layout_schema_version <> v_page.layout_schema_version)
     ) THEN
    RAISE EXCEPTION 'omr_v2_page_metadata_inconsistent';
  END IF;

  RETURN jsonb_build_object(
    'sheet_id', v_sheet.id,
    'page_id', v_page.id,
    'page_index', v_page.page_index,
    'page_count', v_page.page_count,
    'institution_id', v_sheet.institution_id,
    'exam_id', v_sheet.exam_id,
    'layout_schema_version', v_page.layout_schema_version,
    'orientation', v_sheet.page_orientation,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'snapshot_question_id', q.id,
        'exam_question_id', q.exam_question_id,
        'question_id', q.question_id,
        'question_type', q.question_type,
        'points_snapshot', q.points_snapshot,
        'global_question_number', q.global_question_number,
        'page_number', q.page_number,
        'region', jsonb_build_object(
          'x', q.normalized_x, 'y', q.normalized_y,
          'width', q.normalized_width, 'height', q.normalized_height
        ),
        'options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'snapshot_option_id', o.id,
            'source_option_id', o.option_id,
            'label', o.option_label,
            'visual_index', o.visual_index,
            'canonical_option_ordinal', o.canonical_option_ordinal,
            'region', jsonb_build_object(
              'x', o.normalized_x, 'y', o.normalized_y,
              'width', o.normalized_width, 'height', o.normalized_height
            )
          ) ORDER BY o.visual_index, o.id)
          FROM public.bubble_sheet_options o
          WHERE o.bubble_sheet_question_id = q.id
        ), '[]'::jsonb)
      ) ORDER BY q.global_question_number, q.id)
      FROM public.bubble_sheet_questions q
      WHERE q.bubble_sheet_id = v_sheet.id
        AND q.page_number = v_page.page_index
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_v2_finalized_page_processing_context(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_v2_finalized_page_processing_context(uuid, uuid) TO service_role;
