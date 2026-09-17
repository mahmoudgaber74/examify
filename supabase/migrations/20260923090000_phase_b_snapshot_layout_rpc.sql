-- Phase B: finalized snapshots are the authoritative rendering source.
-- Legacy bubble sheets retain their existing uniform-count contract.

ALTER TABLE public.bubble_sheets
  ADD COLUMN IF NOT EXISTS layout_schema_version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.set_bubble_sheet_layout_schema_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.generator_version = 'phase-a-v2' THEN
    NEW.layout_schema_version := 2;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_bubble_sheet_layout_schema_version ON public.bubble_sheets;
CREATE TRIGGER trg_set_bubble_sheet_layout_schema_version
BEFORE INSERT OR UPDATE ON public.bubble_sheets
FOR EACH ROW EXECUTE FUNCTION public.set_bubble_sheet_layout_schema_version();

CREATE OR REPLACE FUNCTION public.get_finalized_bubble_sheet_layout(p_bubble_sheet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_sheet public.bubble_sheets%ROWTYPE;
  v_page_width numeric := 210;
  v_page_height numeric := 297;
  v_page_count integer;
BEGIN
  IF auth.uid() IS NULL OR v_role NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'omr_layout_read_not_allowed';
  END IF;

  SELECT * INTO v_sheet
  FROM public.bubble_sheets b
  WHERE b.id = p_bubble_sheet_id;

  IF NOT FOUND OR v_sheet.snapshot_state <> 'exact'
     OR (v_role <> 'super_admin' AND v_sheet.institution_id <> public.current_user_institution_id()) THEN
    RAISE EXCEPTION 'omr_finalized_layout_not_found';
  END IF;

  SELECT COALESCE(max(q.page_number), 1) INTO v_page_count
  FROM public.bubble_sheet_questions q
  WHERE q.bubble_sheet_id = v_sheet.id;

  RETURN jsonb_build_object(
    'layout_schema_version', COALESCE(v_sheet.layout_schema_version, 1),
    'snapshot_id', v_sheet.id,
    'exam_id', v_sheet.exam_id,
    'page_width_mm', v_page_width,
    'page_height_mm', v_page_height,
    'orientation', COALESCE(v_sheet.page_orientation, 'portrait'),
    'page_count', v_page_count,
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'snapshot_section_id', s.id,
        'section_key', s.section_key,
        'title', s.title,
        'visual_index', s.visual_index,
        'question_start_index', s.question_start_index,
        'question_count', s.question_count,
        'page_number', s.page_number,
        'rect', jsonb_build_object(
          'x', s.normalized_x, 'y', s.normalized_y,
          'width', s.normalized_width, 'height', s.normalized_height
        )
      ) ORDER BY s.visual_index)
      FROM public.bubble_sheet_sections s
      WHERE s.bubble_sheet_id = v_sheet.id
    ), '[]'::jsonb),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'snapshot_question_id', q.id,
        'exam_question_id', q.exam_question_id,
        'question_id', q.question_id,
        'question_type', q.question_type,
        'points', q.points_snapshot,
        'question_ordinal', q.question_ordinal,
        'global_question_number', q.global_question_number,
        'section_visual_index', s.visual_index,
        'section_question_number', q.section_question_number,
        'page_number', q.page_number,
        'rect', jsonb_build_object(
          'x', q.normalized_x, 'y', q.normalized_y,
          'width', q.normalized_width, 'height', q.normalized_height
        ),
        'options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'snapshot_option_id', o.id,
            'option_id', o.option_id,
            'label', o.option_label,
            'canonical_option_ordinal', o.canonical_option_ordinal,
            'visual_index', o.visual_index,
            'rect', jsonb_build_object(
              'x', o.normalized_x, 'y', o.normalized_y,
              'width', o.normalized_width, 'height', o.normalized_height
            )
          ) ORDER BY o.visual_index)
          FROM public.bubble_sheet_options o
          WHERE o.bubble_sheet_question_id = q.id
        ), '[]'::jsonb)
      ) ORDER BY q.global_question_number)
      FROM public.bubble_sheet_questions q
      JOIN public.bubble_sheet_sections s ON s.id = q.section_id
      WHERE q.bubble_sheet_id = v_sheet.id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_finalized_bubble_sheet_layout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finalized_bubble_sheet_layout(uuid) TO authenticated;
