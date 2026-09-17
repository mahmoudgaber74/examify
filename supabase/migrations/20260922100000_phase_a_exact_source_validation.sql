-- Phase A follow-up: require an exact snapshot of the authoritative exam graph.
-- This is a forward definition of the already deployed RPC; do not edit history.

CREATE OR REPLACE FUNCTION public.create_exact_bubble_sheet_snapshot(p_snapshot jsonb)
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
  v_choices integer := (p_snapshot->>'choices_count')::integer;
  v_source_questions integer;
  v_expected_choices integer;
  v_expected_options integer;
  v_option_index integer;
  v_question_index integer;
  source_question record;
  source_option record;
BEGIN
  IF auth.uid() IS NULL OR actor_role NOT IN ('super_admin','school_admin','teacher') THEN
    RAISE EXCEPTION 'omr_template_create_not_allowed';
  END IF;

  SELECT institution_id INTO v_institution
  FROM public.examify_exams
  WHERE id = p_exam_id;
  IF v_institution IS NULL OR (actor_role <> 'super_admin' AND v_institution <> public.current_user_institution_id()) THEN
    RAISE EXCEPTION 'omr_template_exam_institution_denied';
  END IF;
  IF v_questions IS NULL OR v_questions < 1 OR v_choices IS NULL OR v_choices < 2 OR v_choices > 8 THEN
    RAISE EXCEPTION 'omr_template_dimensions_invalid';
  END IF;
  IF jsonb_typeof(p_snapshot->'questions') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'omr_template_mapping_incomplete';
  END IF;

  SELECT count(*) INTO v_source_questions
  FROM public.exam_questions
  WHERE exam_id = p_exam_id;
  IF jsonb_array_length(p_snapshot->'questions') <> v_source_questions
     OR v_source_questions <> v_questions THEN
    RAISE EXCEPTION 'omr_template_exam_question_count_mismatch';
  END IF;
  IF (SELECT count(DISTINCT (q->>'question_id')::uuid)
      FROM jsonb_array_elements(p_snapshot->'questions') AS q) <> v_questions THEN
    RAISE EXCEPTION 'omr_template_exam_question_set_mismatch';
  END IF;

  -- Establish the authoritative option cardinality before validating the
  -- payload, so mixed source questions receive the specific error.
  v_expected_choices := NULL;
  FOR source_question IN
    SELECT eq.question_id
    FROM public.exam_questions eq
    WHERE eq.exam_id = p_exam_id
  LOOP
    SELECT count(*) INTO v_expected_options
    FROM public.question_options
    WHERE question_id = source_question.question_id;
    IF v_expected_choices IS NULL THEN
      v_expected_choices := v_expected_options;
    ELSIF v_expected_options <> v_expected_choices THEN
      RAISE EXCEPTION 'omr_template_exam_option_count_mixed';
    END IF;
  END LOOP;
  IF v_expected_choices IS NULL OR v_expected_choices < 2 THEN
    RAISE EXCEPTION 'omr_template_exam_option_count_mixed';
  END IF;
  IF v_choices <> v_expected_choices THEN
    RAISE EXCEPTION 'omr_template_choices_count_mismatch';
  END IF;

  -- The payload must follow the same ORDER BY used by the UI and worker.
  v_question_index := 0;
  FOR source_question IN
    SELECT eq.question_id, eq.sort_order,
           row_number() OVER (ORDER BY eq.sort_order, eq.id)::integer AS ordinal
    FROM public.exam_questions eq
    WHERE eq.exam_id = p_exam_id
    ORDER BY eq.sort_order, eq.id
  LOOP
    v_question_index := source_question.ordinal;
    p_question := p_snapshot->'questions'->(v_question_index - 1);
    IF (p_question->>'question_id')::uuid <> source_question.question_id
       OR (p_question->>'global_question_number')::integer <> v_question_index
       OR (p_question->>'sort_snapshot')::integer <> source_question.sort_order THEN
      RAISE EXCEPTION 'omr_template_question_order_mismatch';
    END IF;

    SELECT count(*) INTO v_expected_options
    FROM public.question_options
    WHERE question_id = source_question.question_id;
    IF v_expected_options < 2 THEN
      RAISE EXCEPTION 'omr_template_exam_option_count_mixed';
    END IF;
    IF v_question_index = 1 THEN
      v_choices := COALESCE(v_choices, 0);
    ELSIF v_expected_options <> (SELECT count(*) FROM public.question_options WHERE question_id = (p_snapshot->'questions'->0->>'question_id')::uuid) THEN
      RAISE EXCEPTION 'omr_template_exam_option_count_mixed';
    END IF;
    IF v_expected_options <> (p_snapshot->>'choices_count')::integer THEN
      RAISE EXCEPTION 'omr_template_choices_count_mismatch';
    END IF;
    IF jsonb_array_length(COALESCE(p_question->'options', '[]'::jsonb)) <> v_expected_options
       OR (SELECT count(DISTINCT (o->>'option_id')::uuid)
           FROM jsonb_array_elements(COALESCE(p_question->'options', '[]'::jsonb)) AS o) <> v_expected_options THEN
      RAISE EXCEPTION 'omr_template_question_option_set_mismatch';
    END IF;

    v_option_index := 0;
    FOR source_option IN
      SELECT qo.id, row_number() OVER (ORDER BY qo.sort_order, qo.id)::integer AS ordinal
      FROM public.question_options qo
      WHERE qo.question_id = source_question.question_id
      ORDER BY qo.sort_order, qo.id
    LOOP
      v_option_index := source_option.ordinal;
      p_option := p_question->'options'->(v_option_index - 1);
      IF (p_option->>'option_id')::uuid <> source_option.id
         OR (p_option->>'visual_index')::integer <> v_option_index - 1 THEN
        RAISE EXCEPTION 'omr_template_question_option_set_mismatch';
      END IF;
    END LOOP;
  END LOOP;

  IF jsonb_typeof(p_snapshot->'sections') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_snapshot->'sections') < 1 THEN
    RAISE EXCEPTION 'omr_template_mapping_incomplete';
  END IF;

  INSERT INTO public.bubble_sheets(
    institution_id, exam_id, model_label, questions_count, choices_count,
    include_student_id, include_student_name, include_qr, template_version,
    qr_token, sections, status, snapshot_state, generator_version, page_size,
    page_orientation, is_finalized, generated_by
  )
  VALUES (
    v_institution, p_exam_id, COALESCE(p_snapshot->>'model_label', 'A'),
    v_questions, (p_snapshot->>'choices_count')::integer,
    COALESCE((p_snapshot->>'include_student_id')::boolean, true),
    COALESCE((p_snapshot->>'include_student_name')::boolean, true),
    COALESCE((p_snapshot->>'include_qr')::boolean, true),
    (p_snapshot->>'template_version')::integer, (p_snapshot->>'qr_token')::uuid,
    COALESCE(p_snapshot->'sections', '[]'::jsonb), 'active', 'draft',
    COALESCE(p_snapshot->>'generator_version', 'phase-a-v1'),
    COALESCE(p_snapshot->>'page_size', 'A4'),
    COALESCE(p_snapshot->>'page_orientation', 'portrait'), false, auth.uid()
  ) RETURNING id INTO p_sheet_id;

  FOR p_section IN SELECT * FROM jsonb_array_elements(p_snapshot->'sections') LOOP
    INSERT INTO public.bubble_sheet_sections(
      bubble_sheet_id, section_key, title, visual_index, question_start_index,
      question_count, page_number, normalized_x, normalized_y, normalized_width,
      normalized_height
    )
    VALUES (
      p_sheet_id, p_section->>'section_key', p_section->>'title',
      (p_section->>'visual_index')::integer,
      (p_section->>'question_start_index')::integer,
      (p_section->>'question_count')::integer, (p_section->>'page_number')::integer,
      (p_section->>'normalized_x')::numeric, (p_section->>'normalized_y')::numeric,
      (p_section->>'normalized_width')::numeric,
      (p_section->>'normalized_height')::numeric
    ) RETURNING id INTO p_section_id;
  END LOOP;

  FOR p_question IN SELECT * FROM jsonb_array_elements(p_snapshot->'questions') LOOP
    p_question_id := (p_question->>'question_id')::uuid;
    SELECT id INTO p_section_id
    FROM public.bubble_sheet_sections
    WHERE bubble_sheet_id = p_sheet_id
      AND visual_index = (p_question->>'section_visual_index')::integer;
    IF p_section_id IS NULL THEN
      RAISE EXCEPTION 'omr_template_section_not_found';
    END IF;
    INSERT INTO public.bubble_sheet_questions(
      bubble_sheet_id, section_id, question_id, exam_id, global_question_number,
      section_question_number, page_number, sort_snapshot, normalized_x,
      normalized_y, normalized_width, normalized_height
    )
    VALUES (
      p_sheet_id, p_section_id, p_question_id, p_exam_id,
      (p_question->>'global_question_number')::integer,
      (p_question->>'section_question_number')::integer,
      (p_question->>'page_number')::integer, (p_question->>'sort_snapshot')::integer,
      (p_question->>'normalized_x')::numeric, (p_question->>'normalized_y')::numeric,
      (p_question->>'normalized_width')::numeric,
      (p_question->>'normalized_height')::numeric
    );
    FOR p_option IN SELECT * FROM jsonb_array_elements(COALESCE(p_question->'options', '[]'::jsonb)) LOOP
      INSERT INTO public.bubble_sheet_options(
        bubble_sheet_question_id, question_id, option_id, option_label,
        visual_index, normalized_x, normalized_y, normalized_width, normalized_height
      )
      VALUES (
        (SELECT id FROM public.bubble_sheet_questions
         WHERE bubble_sheet_id = p_sheet_id AND question_id = p_question_id),
        p_question_id, (p_option->>'option_id')::uuid,
        p_option->>'option_label', (p_option->>'visual_index')::integer,
        (p_option->>'normalized_x')::numeric, (p_option->>'normalized_y')::numeric,
        (p_option->>'normalized_width')::numeric,
        (p_option->>'normalized_height')::numeric
      );
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.bubble_sheet_sections s
    WHERE s.bubble_sheet_id = p_sheet_id
      AND (SELECT count(*) FROM public.bubble_sheet_questions q WHERE q.section_id = s.id) <> s.question_count
  ) THEN RAISE EXCEPTION 'bubble_sheet_section_count_mismatch'; END IF;
  IF (SELECT count(DISTINCT global_question_number) FROM public.bubble_sheet_questions WHERE bubble_sheet_id = p_sheet_id) <> v_questions
     OR (SELECT COALESCE(sum(question_count), 0) FROM public.bubble_sheet_sections WHERE bubble_sheet_id = p_sheet_id) <> v_questions THEN
    RAISE EXCEPTION 'bubble_sheet_question_number_invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.bubble_sheet_options o
    JOIN public.bubble_sheet_questions q ON q.id = o.bubble_sheet_question_id
    WHERE q.bubble_sheet_id = p_sheet_id
    GROUP BY o.bubble_sheet_question_id
    HAVING count(*) <> (p_snapshot->>'choices_count')::integer
       OR count(DISTINCT option_label) <> (p_snapshot->>'choices_count')::integer
       OR count(DISTINCT visual_index) <> (p_snapshot->>'choices_count')::integer
       OR min(visual_index) <> 0
       OR max(visual_index) <> (p_snapshot->>'choices_count')::integer - 1
  ) THEN RAISE EXCEPTION 'bubble_sheet_option_layout_invalid'; END IF;

  UPDATE public.bubble_sheets
  SET snapshot_state = 'exact', is_finalized = true, finalized_at = now()
  WHERE id = p_sheet_id;
  RETURN jsonb_build_object('id', p_sheet_id, 'exam_id', p_exam_id, 'snapshot_state', 'exact', 'is_finalized', true);
END;
$$;

REVOKE ALL ON FUNCTION public.create_exact_bubble_sheet_snapshot(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exact_bubble_sheet_snapshot(jsonb) TO authenticated;
