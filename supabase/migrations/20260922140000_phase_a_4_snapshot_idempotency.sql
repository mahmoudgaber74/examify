-- Phase A.4: bounded, request-scoped snapshot idempotency.
-- The QR token remains an output identifier; generation_request_id is the
-- semantic retry key and is intentionally scoped to institution + exam.

ALTER TABLE public.bubble_sheets
  ADD COLUMN IF NOT EXISTS generation_request_id uuid,
  ADD COLUMN IF NOT EXISTS generation_request_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS bubble_sheets_generation_request_unique
  ON public.bubble_sheets(institution_id, exam_id, generation_request_id)
  WHERE generation_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_exact_bubble_sheet_snapshot_idempotent(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id uuid := NULLIF(p_snapshot->>'generation_request_id', '')::uuid;
  v_exam_id uuid := NULLIF(p_snapshot->>'exam_id', '')::uuid;
  v_institution_id uuid;
  v_fingerprint text;
  v_existing public.bubble_sheets%ROWTYPE;
  v_result jsonb;
  v_sheet_id uuid;
  v_constraint text;
  v_source_semantic jsonb;
  v_request_semantic jsonb;
BEGIN
  IF v_request_id IS NULL OR v_exam_id IS NULL THEN
    RAISE EXCEPTION 'omr_generation_request_id_required';
  END IF;

  SELECT e.institution_id INTO v_institution_id
  FROM public.examify_exams e WHERE e.id = v_exam_id;
  IF v_institution_id IS NULL THEN
    RAISE EXCEPTION 'omr_template_exam_not_found';
  END IF;

  SELECT jsonb_build_object(
    'exam_id', v_exam_id,
    'institution_id', v_institution_id,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'exam_question_id', eq.id,
        'question_id', eq.question_id,
        'sort_order', eq.sort_order,
        'question_type', q.type,
        'points', eq.points,
        'options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'option_id', qo.id,
            'sort_order', qo.sort_order
          ) ORDER BY qo.sort_order, qo.id)
          FROM public.question_options qo
          WHERE qo.question_id = eq.question_id
        ), '[]'::jsonb)
      ) ORDER BY eq.sort_order, eq.id)
      FROM public.exam_questions eq
      JOIN public.questions q ON q.id = eq.question_id
      WHERE eq.exam_id = v_exam_id
    ), '[]'::jsonb)
  ) INTO v_source_semantic;

  SELECT jsonb_build_object(
    'exam_id', v_exam_id,
    'institution_id', v_institution_id,
    'questions_count', p_snapshot->'questions_count',
    'choices_count', p_snapshot->'choices_count',
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'question_id', q->'question_id',
        'global_question_number', q->'global_question_number',
        'sort_snapshot', q->'sort_snapshot',
        'question_type', q->'question_type',
        'points_snapshot', q->'points_snapshot',
        'options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'option_id', o->'option_id',
            'visual_index', o->'visual_index'
          ) ORDER BY (o->>'visual_index')::integer, o->>'option_id')
          FROM jsonb_array_elements(COALESCE(q->'options', '[]'::jsonb)) AS option_item(o)
        ), '[]'::jsonb)
      ) ORDER BY (q->>'global_question_number')::integer, q->>'question_id')
      FROM jsonb_array_elements(COALESCE(p_snapshot->'questions', '[]'::jsonb)) AS question_item(q)
    ), '[]'::jsonb)
  ) INTO v_request_semantic;

  v_fingerprint := md5(jsonb_build_object(
    'source', v_source_semantic,
    'request', v_request_semantic
  )::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_institution_id::text || ':' || v_exam_id::text || ':' || v_request_id::text, 0));

  SELECT * INTO v_existing
  FROM public.bubble_sheets
  WHERE generation_request_id = NULLIF(p_snapshot->>'generation_request_id', '')::uuid;
  IF FOUND THEN
    IF v_existing.model_label IS DISTINCT FROM COALESCE(p_snapshot->>'model_label', 'A')
       OR v_existing.generation_request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'OMR_SNAPSHOT_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'exam_id', v_existing.exam_id,
      'snapshot_state', v_existing.snapshot_state,
      'is_finalized', v_existing.is_finalized,
      'reused', true
    );
  END IF;

  v_result := public.create_exact_bubble_sheet_snapshot(p_snapshot);
  v_sheet_id := (v_result->>'id')::uuid;
  UPDATE public.bubble_sheets
  SET generation_request_id = v_request_id,
      generation_request_fingerprint = v_fingerprint
  WHERE id = v_sheet_id;
  RETURN v_result || jsonb_build_object('reused', false);
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IS NULL OR v_constraint <> 'bubble_sheets_generation_request_unique' THEN RAISE; END IF;
    SELECT * INTO v_existing
    FROM public.bubble_sheets
    WHERE generation_request_id = NULLIF(p_snapshot->>'generation_request_id', '')::uuid;
    IF FOUND AND v_existing.generation_request_fingerprint = v_fingerprint THEN
      RETURN jsonb_build_object('id', v_existing.id, 'exam_id', v_existing.exam_id,
        'snapshot_state', v_existing.snapshot_state, 'is_finalized', v_existing.is_finalized, 'reused', true);
    END IF;
    RAISE EXCEPTION 'OMR_SNAPSHOT_IDEMPOTENCY_CONFLICT';
END;
$$;

REVOKE ALL ON FUNCTION public.create_exact_bubble_sheet_snapshot_idempotent(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exact_bubble_sheet_snapshot_idempotent(jsonb) TO authenticated;
