-- Phase B: variable per-question option counts for finalized v2 snapshots.
-- The Phase A uniform-count RPC remains available for legacy callers.

CREATE OR REPLACE FUNCTION public.omr_snapshot_v2_semantic_fingerprint(p_snapshot jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exam_id uuid := NULLIF(p_snapshot->>'exam_id', '')::uuid;
  v_institution_id uuid;
  v_source jsonb;
  v_request jsonb;
BEGIN
  SELECT e.institution_id INTO v_institution_id
  FROM public.examify_exams e WHERE e.id = v_exam_id;

  SELECT jsonb_build_object(
    'exam_id', v_exam_id,
    'institution_id', v_institution_id,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'exam_question_id', eq.id, 'question_id', eq.question_id,
        'sort_order', eq.sort_order, 'question_type', q.type, 'points', eq.points,
        'options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('option_id', qo.id, 'sort_order', qo.sort_order)
            ORDER BY qo.sort_order, qo.id)
          FROM public.question_options qo WHERE qo.question_id = eq.question_id
        ), '[]'::jsonb)
      ) ORDER BY eq.sort_order, eq.id)
      FROM public.exam_questions eq
      JOIN public.questions q ON q.id = eq.question_id
      WHERE eq.exam_id = v_exam_id
    ), '[]'::jsonb)
  ) INTO v_source;

  SELECT jsonb_build_object(
    'exam_id', v_exam_id, 'institution_id', v_institution_id,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'question_id', q->'question_id',
        'question_type', q->'question_type',
        'points_snapshot', q->'points_snapshot',
        'question_ordinal', q->'question_ordinal',
        'global_question_number', q->'global_question_number',
        'sort_snapshot', q->'sort_snapshot',
        'options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'option_id', o->'option_id', 'canonical_option_ordinal', o->'canonical_option_ordinal',
            'visual_index', o->'visual_index'
          ) ORDER BY (o->>'visual_index')::integer, o->>'option_id')
          FROM jsonb_array_elements(COALESCE(q->'options', '[]'::jsonb)) AS option_item(o)
        ), '[]'::jsonb)
      ) ORDER BY (q->>'question_ordinal')::integer, q->>'question_id')
      FROM jsonb_array_elements(COALESCE(p_snapshot->'questions', '[]'::jsonb)) AS question_item(q)
    ), '[]'::jsonb)
  ) INTO v_request;

  RETURN md5(jsonb_build_object('source', v_source, 'request', v_request)::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_variable_bubble_sheet_snapshot(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p_exam_id uuid := (p_snapshot->>'exam_id')::uuid;
  p_sheet_id uuid;
  p_section_id uuid;
  p_question_id uuid;
  p_question jsonb;
  p_option jsonb;
  p_section jsonb;
  actor_role text := public.current_user_role();
  v_institution uuid;
  v_questions integer := (p_snapshot->>'questions_count')::integer;
  v_source_questions integer;
  v_payload_questions integer;
  v_question_index integer := 0;
  v_option_index integer;
  v_expected_options integer;
  v_max_choices integer := 0;
  source_question record;
  source_option record;
BEGIN
  IF auth.uid() IS NULL OR actor_role NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'omr_template_create_not_allowed';
  END IF;
  SELECT e.institution_id INTO v_institution FROM public.examify_exams e WHERE e.id = p_exam_id;
  IF v_institution IS NULL OR (actor_role <> 'super_admin' AND v_institution <> public.current_user_institution_id()) THEN
    RAISE EXCEPTION 'omr_template_exam_institution_denied';
  END IF;
  IF v_questions IS NULL OR v_questions < 1
     OR jsonb_typeof(p_snapshot->'questions') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_snapshot->'sections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_snapshot->'sections') < 1 THEN
    RAISE EXCEPTION 'omr_template_mapping_incomplete';
  END IF;

  SELECT count(*) INTO v_source_questions
  FROM public.exam_questions eq
  WHERE eq.exam_id = p_exam_id AND public.omr_exam_question_is_eligible(eq.id);
  v_payload_questions := jsonb_array_length(p_snapshot->'questions');
  IF v_payload_questions <> v_source_questions OR v_questions <> v_source_questions THEN
    RAISE EXCEPTION 'omr_template_eligible_question_count_mismatch';
  END IF;

  IF (SELECT count(DISTINCT (q->>'exam_question_id')::uuid)
      FROM jsonb_array_elements(p_snapshot->'questions') q) <> v_payload_questions THEN
    RAISE EXCEPTION 'omr_template_exam_question_duplicate';
  END IF;

  FOR p_question IN SELECT * FROM jsonb_array_elements(p_snapshot->'questions') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.exam_questions eq
      WHERE eq.id = (p_question->>'exam_question_id')::uuid
        AND eq.exam_id = p_exam_id AND public.omr_exam_question_is_eligible(eq.id)
    ) THEN RAISE EXCEPTION 'omr_template_ineligible_question'; END IF;
  END LOOP;

  FOR source_question IN
    SELECT eq.id, eq.question_id, q.type, eq.points, eq.sort_order,
           row_number() OVER (ORDER BY eq.sort_order, eq.id)::integer AS ordinal,
           (SELECT count(*) FROM public.question_options qo WHERE qo.question_id = eq.question_id)::integer AS source_option_count
    FROM public.exam_questions eq
    JOIN public.questions q ON q.id = eq.question_id
    WHERE eq.exam_id = p_exam_id AND public.omr_exam_question_is_eligible(eq.id)
    ORDER BY eq.sort_order, eq.id
  LOOP
    v_question_index := source_question.ordinal;
    v_max_choices := GREATEST(v_max_choices, source_question.source_option_count);
    p_question := p_snapshot->'questions'->(v_question_index - 1);
    IF (p_question->>'exam_question_id')::uuid <> source_question.id
       OR (p_question->>'question_id')::uuid <> source_question.question_id
       OR (p_question->>'question_type') <> source_question.type
       OR (p_question->>'points_snapshot')::numeric <> source_question.points
       OR (p_question->>'question_ordinal')::integer <> v_question_index
       OR (p_question->>'global_question_number')::integer <> v_question_index
       OR (p_question->>'sort_snapshot')::integer <> source_question.sort_order THEN
      RAISE EXCEPTION 'omr_template_question_source_mismatch';
    END IF;
    IF jsonb_array_length(COALESCE(p_question->'options', '[]'::jsonb)) <> source_question.source_option_count
       OR (SELECT count(DISTINCT (o->>'option_id')::uuid)
           FROM jsonb_array_elements(COALESCE(p_question->'options', '[]'::jsonb)) o) <> source_question.source_option_count THEN
      RAISE EXCEPTION 'omr_template_option_source_mismatch';
    END IF;
    v_option_index := 0;
    FOR source_option IN
      SELECT qo.id, qo.label, qo.sort_order,
             row_number() OVER (ORDER BY qo.sort_order, qo.id)::integer AS ordinal
      FROM public.question_options qo
      WHERE qo.question_id = source_question.question_id
      ORDER BY qo.sort_order, qo.id
    LOOP
      v_option_index := source_option.ordinal;
      p_option := p_question->'options'->(v_option_index - 1);
      IF (p_option->>'option_id')::uuid <> source_option.id
         OR (p_option->>'canonical_option_ordinal')::integer <> v_option_index
         OR (p_option->>'visual_index')::integer <> v_option_index - 1 THEN
        RAISE EXCEPTION 'omr_template_option_order_mismatch';
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.bubble_sheets(
    institution_id, exam_id, model_label, questions_count, choices_count,
    include_student_id, include_student_name, include_qr, template_version,
    qr_token, sections, status, snapshot_state, generator_version, page_size,
    page_orientation, is_finalized, generated_by
  ) VALUES (
    v_institution, p_exam_id, COALESCE(p_snapshot->>'model_label', 'A'), v_questions,
    v_max_choices, COALESCE((p_snapshot->>'include_student_id')::boolean, true),
    COALESCE((p_snapshot->>'include_student_name')::boolean, true),
    COALESCE((p_snapshot->>'include_qr')::boolean, true),
    (p_snapshot->>'template_version')::integer, (p_snapshot->>'qr_token')::uuid,
    p_snapshot->'sections', 'active', 'draft', 'phase-a-v2',
    COALESCE(p_snapshot->>'page_size', 'A4'),
    COALESCE(p_snapshot->>'page_orientation', 'portrait'), false, auth.uid()
  ) RETURNING id INTO p_sheet_id;

  FOR p_section IN SELECT * FROM jsonb_array_elements(p_snapshot->'sections') LOOP
    INSERT INTO public.bubble_sheet_sections(
      bubble_sheet_id, section_key, title, visual_index, question_start_index,
      question_count, page_number, normalized_x, normalized_y, normalized_width,
      normalized_height
    ) VALUES (
      p_sheet_id, p_section->>'section_key', p_section->>'title',
      (p_section->>'visual_index')::integer, (p_section->>'question_start_index')::integer,
      (p_section->>'question_count')::integer, (p_section->>'page_number')::integer,
      (p_section->>'normalized_x')::numeric, (p_section->>'normalized_y')::numeric,
      (p_section->>'normalized_width')::numeric, (p_section->>'normalized_height')::numeric
    );
  END LOOP;

  FOR p_question IN SELECT * FROM jsonb_array_elements(p_snapshot->'questions') LOOP
    SELECT id INTO p_section_id FROM public.bubble_sheet_sections
    WHERE bubble_sheet_id = p_sheet_id AND visual_index = (p_question->>'section_visual_index')::integer;
    INSERT INTO public.bubble_sheet_questions(
      bubble_sheet_id, section_id, question_id, exam_id, exam_question_id,
      question_type, points_snapshot, omr_eligible, question_ordinal, option_count,
      global_question_number, section_question_number, page_number, sort_snapshot,
      normalized_x, normalized_y, normalized_width, normalized_height
    ) VALUES (
      p_sheet_id, p_section_id, (p_question->>'question_id')::uuid, p_exam_id,
      (p_question->>'exam_question_id')::uuid, p_question->>'question_type',
      (p_question->>'points_snapshot')::numeric, true,
      (p_question->>'question_ordinal')::integer,
      jsonb_array_length(p_question->'options'),
      (p_question->>'global_question_number')::integer,
      (p_question->>'section_question_number')::integer,
      (p_question->>'page_number')::integer, (p_question->>'sort_snapshot')::integer,
      (p_question->>'normalized_x')::numeric, (p_question->>'normalized_y')::numeric,
      (p_question->>'normalized_width')::numeric, (p_question->>'normalized_height')::numeric
    ) RETURNING id INTO p_question_id;
    FOR p_option IN SELECT * FROM jsonb_array_elements(p_question->'options') LOOP
      INSERT INTO public.bubble_sheet_options(
        bubble_sheet_question_id, question_id, option_id, option_label,
        visual_index, canonical_option_ordinal, normalized_x, normalized_y,
        normalized_width, normalized_height
      ) VALUES (
        p_question_id, (p_question->>'question_id')::uuid,
        (p_option->>'option_id')::uuid,
        (SELECT qo.label FROM public.question_options qo
         WHERE qo.id = (p_option->>'option_id')::uuid
           AND qo.question_id = (p_question->>'question_id')::uuid),
        (p_option->>'visual_index')::integer,
        (p_option->>'canonical_option_ordinal')::integer,
        (p_option->>'normalized_x')::numeric, (p_option->>'normalized_y')::numeric,
        (p_option->>'normalized_width')::numeric, (p_option->>'normalized_height')::numeric
      );
    END LOOP;
  END LOOP;

  UPDATE public.bubble_sheets
  SET snapshot_state = 'exact', is_finalized = true, finalized_at = now()
  WHERE id = p_sheet_id;
  RETURN jsonb_build_object('id', p_sheet_id, 'exam_id', p_exam_id,
    'snapshot_state', 'exact', 'is_finalized', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_variable_bubble_sheet_snapshot_idempotent(p_snapshot jsonb)
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
BEGIN
  IF v_request_id IS NULL OR v_exam_id IS NULL THEN RAISE EXCEPTION 'omr_generation_request_id_required'; END IF;
  SELECT e.institution_id INTO v_institution_id FROM public.examify_exams e WHERE e.id = v_exam_id;
  IF v_institution_id IS NULL THEN RAISE EXCEPTION 'omr_template_exam_not_found'; END IF;
  v_fingerprint := public.omr_snapshot_v2_semantic_fingerprint(p_snapshot);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_institution_id::text || ':' || v_exam_id::text || ':' || v_request_id::text, 0));
  SELECT * INTO v_existing FROM public.bubble_sheets WHERE generation_request_id = v_request_id;
  IF FOUND THEN
    IF v_existing.model_label IS DISTINCT FROM COALESCE(p_snapshot->>'model_label', 'A')
       OR v_existing.generation_request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'OMR_SNAPSHOT_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('id', v_existing.id, 'exam_id', v_existing.exam_id,
      'snapshot_state', v_existing.snapshot_state, 'is_finalized', v_existing.is_finalized, 'reused', true);
  END IF;
  v_result := public.create_variable_bubble_sheet_snapshot(p_snapshot);
  v_sheet_id := (v_result->>'id')::uuid;
  UPDATE public.bubble_sheets SET generation_request_id = v_request_id,
    generation_request_fingerprint = v_fingerprint WHERE id = v_sheet_id;
  RETURN v_result || jsonb_build_object('reused', false);
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IS NULL OR v_constraint <> 'bubble_sheets_generation_request_unique' THEN RAISE; END IF;
    SELECT * INTO v_existing FROM public.bubble_sheets WHERE generation_request_id = v_request_id;
    IF FOUND AND v_existing.generation_request_fingerprint = v_fingerprint THEN
      RETURN jsonb_build_object('id', v_existing.id, 'exam_id', v_existing.exam_id,
        'snapshot_state', v_existing.snapshot_state, 'is_finalized', v_existing.is_finalized, 'reused', true);
    END IF;
    RAISE EXCEPTION 'OMR_SNAPSHOT_IDEMPOTENCY_CONFLICT';
END;
$$;

REVOKE ALL ON FUNCTION public.omr_snapshot_v2_semantic_fingerprint(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_variable_bubble_sheet_snapshot(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_variable_bubble_sheet_snapshot_idempotent(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_variable_bubble_sheet_snapshot_idempotent(jsonb) TO authenticated;
