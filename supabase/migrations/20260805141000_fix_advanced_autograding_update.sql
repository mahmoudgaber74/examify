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
    is_correct = scored.is_correct,
    awarded_points = scored.awarded_points,
    graded_at = now(),
    updated_at = now()
  FROM (
    SELECT
      a2.id AS answer_id,
      (score_result.result->>'is_correct')::boolean AS is_correct,
      (score_result.result->>'awarded_points')::numeric AS awarded_points
    FROM public.answers a2
    JOIN public.exam_questions eq ON eq.question_id = a2.question_id
    JOIN public.questions q ON q.id = eq.question_id
    CROSS JOIN LATERAL public.grade_advanced_answer(
      q.type,
      coalesce(q.metadata->'advanced_config', '{}'::jsonb),
      coalesce(a2.answer_payload, '{}'::jsonb),
      eq.points
    ) AS score_result(result)
    WHERE a2.attempt_id = p_attempt_id
      AND eq.exam_id = attempt_row.exam_id
      AND q.type IN ('fill_blank', 'matching', 'ordering')
  ) scored
  WHERE a.id = scored.answer_id;

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
