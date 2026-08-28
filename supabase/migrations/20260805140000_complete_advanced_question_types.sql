ALTER TABLE public.answers
  ADD COLUMN IF NOT EXISTS answer_payload jsonb;

CREATE OR REPLACE FUNCTION public.validate_advanced_question_config(
  p_type text,
  p_config jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  item_count integer;
  distinct_count integer;
BEGIN
  IF p_type NOT IN ('fill_blank', 'matching', 'ordering') THEN
    RAISE EXCEPTION 'Unsupported advanced question type.';
  END IF;

  IF jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'Question configuration must be an object.';
  END IF;

  IF p_type = 'fill_blank' THEN
    IF jsonb_typeof(p_config->'blanks') <> 'array' THEN
      RAISE EXCEPTION 'Fill blank questions need a blanks array.';
    END IF;

    SELECT count(*), count(DISTINCT value->>'id')
    INTO item_count, distinct_count
    FROM jsonb_array_elements(p_config->'blanks');

    IF item_count < 1 THEN
      RAISE EXCEPTION 'Add at least one blank.';
    END IF;
    IF item_count <> distinct_count THEN
      RAISE EXCEPTION 'Blank identifiers must be unique.';
    END IF;

    FOR item IN SELECT value FROM jsonb_array_elements(p_config->'blanks')
    LOOP
      IF btrim(coalesce(item->>'id', '')) = '' THEN
        RAISE EXCEPTION 'Blank identifier is required.';
      END IF;
      IF jsonb_typeof(item->'accepted_answers') <> 'array' THEN
        RAISE EXCEPTION 'Each blank needs accepted answers.';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(item->'accepted_answers') AS answer(value)
        WHERE btrim(answer.value) <> ''
      ) THEN
        RAISE EXCEPTION 'Each blank needs at least one non-empty answer.';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(item->'accepted_answers') AS answer(value)
        WHERE btrim(answer.value) = ''
      ) THEN
        RAISE EXCEPTION 'Accepted answers cannot be empty.';
      END IF;
    END LOOP;
  ELSIF p_type = 'matching' THEN
    IF jsonb_typeof(p_config->'pairs') <> 'array' THEN
      RAISE EXCEPTION 'Matching questions need a pairs array.';
    END IF;

    SELECT count(*)
    INTO item_count
    FROM jsonb_array_elements(p_config->'pairs');

    IF item_count < 2 THEN
      RAISE EXCEPTION 'Add at least two matching pairs.';
    END IF;

    SELECT count(*), count(DISTINCT value->>'left_id')
    INTO item_count, distinct_count
    FROM jsonb_array_elements(p_config->'pairs');
    IF item_count <> distinct_count THEN
      RAISE EXCEPTION 'Left identifiers must be unique.';
    END IF;

    SELECT count(*), count(DISTINCT value->>'right_id')
    INTO item_count, distinct_count
    FROM jsonb_array_elements(p_config->'pairs');
    IF item_count <> distinct_count THEN
      RAISE EXCEPTION 'Right identifiers must be unique.';
    END IF;

    FOR item IN SELECT value FROM jsonb_array_elements(p_config->'pairs')
    LOOP
      IF btrim(coalesce(item->>'left_id', '')) = ''
        OR btrim(coalesce(item->>'right_id', '')) = ''
        OR btrim(coalesce(item->>'left', '')) = ''
        OR btrim(coalesce(item->>'right', '')) = '' THEN
        RAISE EXCEPTION 'Matching pairs cannot be empty.';
      END IF;
    END LOOP;
  ELSIF p_type = 'ordering' THEN
    IF jsonb_typeof(p_config->'items') <> 'array' THEN
      RAISE EXCEPTION 'Ordering questions need an items array.';
    END IF;

    SELECT count(*), count(DISTINCT value->>'id')
    INTO item_count, distinct_count
    FROM jsonb_array_elements(p_config->'items');

    IF item_count < 2 THEN
      RAISE EXCEPTION 'Add at least two ordering items.';
    END IF;
    IF item_count <> distinct_count THEN
      RAISE EXCEPTION 'Ordering item identifiers must be unique.';
    END IF;

    FOR item IN SELECT value FROM jsonb_array_elements(p_config->'items')
    LOOP
      IF btrim(coalesce(item->>'id', '')) = '' OR btrim(coalesce(item->>'label', '')) = '' THEN
        RAISE EXCEPTION 'Ordering items cannot be empty.';
      END IF;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_advanced_question(
  p_question_id uuid,
  p_institution_id uuid,
  p_subject_id uuid,
  p_type text,
  p_prompt text,
  p_difficulty text,
  p_points numeric,
  p_unit text,
  p_lesson text,
  p_explanation text,
  p_metadata jsonb,
  p_config jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_question_id uuid;
  v_metadata jsonb;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'You do not have permission to save questions.';
  END IF;

  IF p_institution_id IS NULL OR p_institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'Question institution does not match the current user.';
  END IF;

  IF p_prompt IS NULL OR btrim(p_prompt) = '' THEN
    RAISE EXCEPTION 'Question text is required.';
  END IF;

  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'Subject is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.subjects s
    WHERE s.id = p_subject_id
      AND s.institution_id = p_institution_id
  ) THEN
    RAISE EXCEPTION 'Subject is not available for this institution.';
  END IF;

  PERFORM public.validate_advanced_question_config(p_type, p_config);

  v_metadata := (coalesce(p_metadata, '{}'::jsonb) - 'advanced_config') || jsonb_build_object('advanced_config', p_config);

  IF p_question_id IS NULL THEN
    INSERT INTO public.questions (
      institution_id,
      subject_id,
      type,
      prompt,
      difficulty,
      points,
      unit,
      lesson,
      explanation,
      metadata
    )
    VALUES (
      p_institution_id,
      p_subject_id,
      p_type,
      btrim(p_prompt),
      p_difficulty,
      p_points,
      nullif(btrim(coalesce(p_unit, '')), ''),
      nullif(btrim(coalesce(p_lesson, '')), ''),
      nullif(btrim(coalesce(p_explanation, '')), ''),
      v_metadata
    )
    RETURNING id INTO v_question_id;
  ELSE
    UPDATE public.questions
    SET
      subject_id = p_subject_id,
      type = p_type,
      prompt = btrim(p_prompt),
      difficulty = p_difficulty,
      points = p_points,
      unit = nullif(btrim(coalesce(p_unit, '')), ''),
      lesson = nullif(btrim(coalesce(p_lesson, '')), ''),
      explanation = nullif(btrim(coalesce(p_explanation, '')), ''),
      metadata = v_metadata
    WHERE id = p_question_id
      AND institution_id = p_institution_id
    RETURNING id INTO v_question_id;

    IF v_question_id IS NULL THEN
      RAISE EXCEPTION 'Question was not found or cannot be edited.';
    END IF;
  END IF;

  DELETE FROM public.question_options
  WHERE question_id = v_question_id;

  RETURN (
    SELECT jsonb_build_object('question', to_jsonb(saved_question))
    FROM public.questions saved_question
    WHERE saved_question.id = v_question_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.grade_advanced_answer(
  p_type text,
  p_config jsonb,
  p_payload jsonb,
  p_points numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  total integer := 0;
  correct integer := 0;
  expected text;
  submitted text;
  submitted_values text[];
BEGIN
  IF p_type = 'fill_blank' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_config->'blanks', '[]'::jsonb))
    LOOP
      total := total + 1;
      submitted := coalesce(p_payload #>> ARRAY['blanks', item->>'id'], '');
      IF coalesce((item->>'ignore_extra_spaces')::boolean, true) THEN
        submitted := regexp_replace(btrim(submitted), '\s+', ' ', 'g');
      END IF;
      IF NOT coalesce((item->>'case_sensitive')::boolean, false) THEN
        submitted := lower(submitted);
      END IF;

      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(item->'accepted_answers') AS accepted(value)
        WHERE (
          CASE
            WHEN coalesce((item->>'case_sensitive')::boolean, false) THEN
              CASE WHEN coalesce((item->>'ignore_extra_spaces')::boolean, true)
                THEN regexp_replace(btrim(accepted.value), '\s+', ' ', 'g')
                ELSE accepted.value
              END
            ELSE
              lower(CASE WHEN coalesce((item->>'ignore_extra_spaces')::boolean, true)
                THEN regexp_replace(btrim(accepted.value), '\s+', ' ', 'g')
                ELSE accepted.value
              END)
          END
        ) = submitted
      ) THEN
        correct := correct + 1;
      END IF;
    END LOOP;
  ELSIF p_type = 'matching' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_config->'pairs', '[]'::jsonb))
    LOOP
      total := total + 1;
      expected := item->>'right_id';
      submitted := p_payload #>> ARRAY['matches', item->>'left_id'];
      IF submitted = expected THEN
        correct := correct + 1;
      END IF;
    END LOOP;

    IF coalesce((p_config->>'one_to_one')::boolean, true) THEN
      SELECT array_agg(value)
      INTO submitted_values
      FROM jsonb_each_text(coalesce(p_payload->'matches', '{}'::jsonb));
      IF submitted_values IS NOT NULL AND array_length(submitted_values, 1) <> (
        SELECT count(DISTINCT value)
        FROM unnest(submitted_values) AS picked(value)
      ) THEN
        RETURN jsonb_build_object('is_correct', false, 'awarded_points', 0, 'correct_count', 0, 'total_count', total);
      END IF;
    END IF;
  ELSIF p_type = 'ordering' THEN
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_config->'items', '[]'::jsonb)) WITH ORDINALITY
    LOOP
      total := total + 1;
      IF p_payload #>> ARRAY['order', (total - 1)::text] = item->>'id' THEN
        correct := correct + 1;
      END IF;
    END LOOP;
  ELSE
    RETURN jsonb_build_object('is_correct', null, 'awarded_points', null, 'correct_count', 0, 'total_count', 0);
  END IF;

  RETURN jsonb_build_object(
    'is_correct', total > 0 AND correct = total,
    'awarded_points', CASE WHEN total > 0 THEN round((p_points * correct / total)::numeric, 2) ELSE 0 END,
    'correct_count', correct,
    'total_count', total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_advanced_question_config(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_advanced_question(uuid, uuid, uuid, text, text, text, numeric, text, text, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grade_advanced_answer(text, jsonb, jsonb, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_exam_attempt(
  p_attempt_id uuid,
  p_answers jsonb DEFAULT '[]'::jsonb,
  p_auto boolean DEFAULT false,
  p_time_remaining_seconds integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  v_student_id uuid;
  submitted_status text;
  objective_score numeric(8,2) := 0;
  objective_total numeric(8,2) := 0;
  manual_total numeric(8,2) := 0;
  total_score numeric(8,2) := 0;
  pct numeric(5,2) := 0;
  passed boolean;
  needs_manual boolean := false;
  answer_item jsonb;
  answer_question_id uuid;
  answer_option_id uuid;
  answer_payload jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF public.current_user_role() <> 'student' THEN
    RAISE EXCEPTION 'only students can submit exam attempts';
  END IF;

  SELECT sp.id
  INTO v_student_id
  FROM public.student_profiles sp
  WHERE sp.user_id = auth.uid()
    AND sp.is_active = true
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'student profile was not found';
  END IF;

  SELECT *
  INTO attempt_row
  FROM public.exam_attempts ea
  WHERE ea.id = p_attempt_id
    AND ea.student_id = v_student_id
  FOR UPDATE;

  IF attempt_row.id IS NULL THEN
    RAISE EXCEPTION 'attempt was not found or is not owned by the current student';
  END IF;

  IF attempt_row.status <> 'in_progress' THEN
    RAISE EXCEPTION 'attempt has already been submitted';
  END IF;

  SELECT *
  INTO exam_row
  FROM public.examify_exams e
  WHERE e.id = attempt_row.exam_id
    AND e.institution_id = public.current_user_institution_id()
    AND e.status = 'published'
    AND (e.start_at IS NULL OR e.start_at <= now())
    AND (e.end_at IS NULL OR e.end_at >= now());

  IF exam_row.id IS NULL OR NOT public.is_exam_assigned_to_current_student(attempt_row.exam_id) THEN
    RAISE EXCEPTION 'exam is not available for this student';
  END IF;

  PERFORM set_config('app.exam_autograding', 'on', true);

  IF jsonb_typeof(coalesce(p_answers, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'answers payload must be an array';
  END IF;

  FOR answer_item IN SELECT value FROM jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  LOOP
    answer_question_id := NULLIF(answer_item->>'question_id', '')::uuid;
    answer_option_id := NULLIF(answer_item->>'option_id', '')::uuid;
    answer_payload := CASE
      WHEN answer_item ? 'answer_payload' AND jsonb_typeof(answer_item->'answer_payload') = 'object' THEN answer_item->'answer_payload'
      ELSE NULL
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM public.exam_questions eq
      WHERE eq.exam_id = attempt_row.exam_id
        AND eq.question_id = answer_question_id
    ) THEN
      RAISE EXCEPTION 'answer question does not belong to this exam';
    END IF;

    IF answer_option_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.question_options qo
      WHERE qo.id = answer_option_id
        AND qo.question_id = answer_question_id
    ) THEN
      RAISE EXCEPTION 'answer option does not belong to this question';
    END IF;

    IF answer_item ? 'answer_payload' AND jsonb_typeof(answer_item->'answer_payload') NOT IN ('object', 'null') THEN
      RAISE EXCEPTION 'answer payload must be an object';
    END IF;

    INSERT INTO public.answers (
      attempt_id,
      question_id,
      option_id,
      text_answer,
      numeric_answer,
      matching_data,
      ordering_data,
      answer_payload
    )
    VALUES (
      p_attempt_id,
      answer_question_id,
      answer_option_id,
      NULLIF(answer_item->>'text_answer', ''),
      NULLIF(answer_item->>'numeric_answer', '')::numeric,
      coalesce(answer_item->'matching_data', answer_payload->'matches'),
      coalesce(answer_item->'ordering_data', answer_payload->'order'),
      answer_payload
    )
    ON CONFLICT (attempt_id, question_id) DO UPDATE SET
      option_id = EXCLUDED.option_id,
      text_answer = EXCLUDED.text_answer,
      numeric_answer = EXCLUDED.numeric_answer,
      matching_data = EXCLUDED.matching_data,
      ordering_data = EXCLUDED.ordering_data,
      answer_payload = EXCLUDED.answer_payload,
      updated_at = now();
  END LOOP;

  INSERT INTO public.answers (attempt_id, question_id)
  SELECT p_attempt_id, eq.question_id
  FROM public.exam_questions eq
  WHERE eq.exam_id = attempt_row.exam_id
  ON CONFLICT (attempt_id, question_id) DO NOTHING;

  UPDATE public.answers a
  SET
    is_correct = EXISTS (
      SELECT 1
      FROM public.question_options qo
      WHERE qo.id = a.option_id
        AND qo.question_id = a.question_id
        AND qo.is_correct = true
    ),
    awarded_points = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.question_options qo
        WHERE qo.id = a.option_id
          AND qo.question_id = a.question_id
          AND qo.is_correct = true
      ) THEN eq.points
      ELSE 0
    END,
    graded_at = now(),
    updated_at = now()
  FROM public.exam_questions eq
  JOIN public.questions q ON q.id = eq.question_id
  WHERE a.attempt_id = p_attempt_id
    AND eq.exam_id = attempt_row.exam_id
    AND eq.question_id = a.question_id
    AND q.type IN ('multiple_choice', 'true_false');

  UPDATE public.answers a
  SET
    is_correct = (scored.result->>'is_correct')::boolean,
    awarded_points = (scored.result->>'awarded_points')::numeric,
    graded_at = now(),
    updated_at = now()
  FROM public.exam_questions eq
  JOIN public.questions q ON q.id = eq.question_id
  CROSS JOIN LATERAL public.grade_advanced_answer(
    q.type,
    coalesce(q.metadata->'advanced_config', '{}'::jsonb),
    coalesce(a.answer_payload, '{}'::jsonb),
    eq.points
  ) AS scored(result)
  WHERE a.attempt_id = p_attempt_id
    AND eq.exam_id = attempt_row.exam_id
    AND eq.question_id = a.question_id
    AND q.type IN ('fill_blank', 'matching', 'ordering');

  UPDATE public.answers a
  SET
    is_correct = NULL,
    awarded_points = NULL,
    updated_at = now()
  FROM public.exam_questions eq
  JOIN public.questions q ON q.id = eq.question_id
  WHERE a.attempt_id = p_attempt_id
    AND eq.exam_id = attempt_row.exam_id
    AND eq.question_id = a.question_id
    AND q.type NOT IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering');

  SELECT
    coalesce(sum(CASE WHEN q.type IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering') THEN a.awarded_points ELSE 0 END), 0),
    coalesce(sum(CASE WHEN q.type IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering') THEN eq.points ELSE 0 END), 0),
    coalesce(sum(CASE WHEN q.type NOT IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering') THEN eq.points ELSE 0 END), 0)
  INTO objective_score, objective_total, manual_total
  FROM public.exam_questions eq
  JOIN public.questions q ON q.id = eq.question_id
  LEFT JOIN public.answers a ON a.attempt_id = p_attempt_id AND a.question_id = eq.question_id
  WHERE eq.exam_id = attempt_row.exam_id;

  needs_manual := manual_total > 0;
  total_score := objective_score;
  pct := CASE WHEN exam_row.total_points > 0 THEN round((total_score / exam_row.total_points) * 100, 2) ELSE 0 END;
  passed := CASE WHEN needs_manual THEN NULL ELSE pct >= exam_row.passing_score END;
  submitted_status := CASE WHEN needs_manual THEN CASE WHEN p_auto THEN 'auto_submitted' ELSE 'submitted' END ELSE 'approved' END;

  UPDATE public.exam_attempts
  SET
    status = submitted_status,
    submitted_at = coalesce(submitted_at, now()),
    time_remaining_seconds = p_time_remaining_seconds,
    score = total_score,
    score_percentage = pct,
    is_passed = passed,
    graded_at = now(),
    approved_at = CASE WHEN needs_manual THEN NULL ELSE now() END,
    is_result_published = NOT needs_manual
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object(
    'attempt_id', p_attempt_id,
    'status', submitted_status,
    'score', total_score,
    'score_percentage', pct,
    'is_passed', passed,
    'needs_manual_grading', needs_manual,
    'objective_score', objective_score,
    'objective_total', objective_total,
    'manual_total', manual_total,
    'is_result_published', NOT needs_manual
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_exam_attempt(uuid, jsonb, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid, jsonb, boolean, integer) TO authenticated;
