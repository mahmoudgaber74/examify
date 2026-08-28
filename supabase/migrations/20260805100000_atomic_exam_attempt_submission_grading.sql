/*
  Atomic exam submission and objective auto-grading.

  The RPC uses SECURITY DEFINER because student RLS policies on answers and
  exam_attempts recurse through the same tables during grading updates. The
  function performs explicit auth.uid(), student, institution, attempt ownership,
  assignment, and availability checks before any write.
*/

CREATE OR REPLACE FUNCTION public.enforce_exam_attempt_canonical_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  autograding boolean := coalesce(current_setting('app.exam_autograding', true), '') = 'on';
  max_allowed_attempts integer;
  existing_attempts integer;
BEGIN
  IF actor_role = 'student' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT e.max_attempts
      INTO max_allowed_attempts
      FROM public.examify_exams e
      JOIN public.student_profiles sp ON sp.id = NEW.student_id
      WHERE e.id = NEW.exam_id
        AND e.institution_id = sp.institution_id
        AND sp.user_id = auth.uid()
        AND sp.is_active = true
        AND e.status = 'published'
        AND (e.start_at IS NULL OR e.start_at <= now())
        AND (e.end_at IS NULL OR e.end_at >= now())
        AND public.is_exam_assigned_to_current_student(e.id);

      IF max_allowed_attempts IS NULL THEN
        RAISE EXCEPTION 'exam attempt is not allowed for this student';
      END IF;

      SELECT count(*)
      INTO existing_attempts
      FROM public.exam_attempts ea
      WHERE ea.exam_id = NEW.exam_id
        AND ea.student_id = NEW.student_id;

      IF existing_attempts >= max_allowed_attempts THEN
        RAISE EXCEPTION 'maximum attempts exceeded';
      END IF;

      IF NEW.status <> 'in_progress'
        OR NEW.score IS NOT NULL
        OR NEW.score_percentage IS NOT NULL
        OR NEW.is_passed IS NOT NULL
        OR NEW.graded_by IS NOT NULL
        OR NEW.graded_at IS NOT NULL
        OR NEW.approved_by IS NOT NULL
        OR NEW.approved_at IS NOT NULL
        OR NEW.is_result_published <> false THEN
        RAISE EXCEPTION 'students can only create clean in-progress attempts';
      END IF;

      RETURN NEW;
    END IF;

    IF OLD.status <> 'in_progress' THEN
      RAISE EXCEPTION 'submitted attempts are locked for students';
    END IF;

    IF NEW.exam_id IS DISTINCT FROM OLD.exam_id
      OR NEW.student_id IS DISTINCT FROM OLD.student_id
      OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number THEN
      RAISE EXCEPTION 'students cannot change attempt identity fields';
    END IF;

    IF autograding THEN
      IF NEW.status NOT IN ('submitted', 'auto_submitted', 'graded', 'approved') THEN
        RAISE EXCEPTION 'invalid autograded attempt status';
      END IF;
      IF NEW.status IN ('submitted', 'auto_submitted', 'graded', 'approved') AND NEW.submitted_at IS NULL THEN
        NEW.submitted_at := now();
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.score IS DISTINCT FROM OLD.score
      OR NEW.score_percentage IS DISTINCT FROM OLD.score_percentage
      OR NEW.is_passed IS DISTINCT FROM OLD.is_passed
      OR NEW.graded_by IS DISTINCT FROM OLD.graded_by
      OR NEW.graded_at IS DISTINCT FROM OLD.graded_at
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.is_result_published IS DISTINCT FROM OLD.is_result_published THEN
      RAISE EXCEPTION 'students cannot change administrative attempt fields';
    END IF;

    IF NEW.status NOT IN ('in_progress', 'submitted', 'auto_submitted') THEN
      RAISE EXCEPTION 'students cannot set grading or approval statuses';
    END IF;

    IF NEW.status IN ('submitted', 'auto_submitted') AND NEW.submitted_at IS NULL THEN
      NEW.submitted_at := now();
    END IF;

    RETURN NEW;
  END IF;

  IF actor_role IN ('school_admin', 'teacher', 'grader') THEN
    IF TG_OP = 'UPDATE'
      AND (
        NEW.exam_id IS DISTINCT FROM OLD.exam_id
        OR NEW.student_id IS DISTINCT FROM OLD.student_id
        OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
      ) THEN
      RAISE EXCEPTION 'attempt identity fields are immutable';
    END IF;

    RETURN NEW;
  END IF;

  IF actor_role = 'super_admin' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'role cannot write exam attempts';
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_answer_canonical_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  autograding boolean := coalesce(current_setting('app.exam_autograding', true), '') = 'on';
  attempt_status text;
BEGIN
  IF actor_role = 'student' THEN
    SELECT ea.status
    INTO attempt_status
    FROM public.exam_attempts ea
    JOIN public.student_profiles sp ON sp.id = ea.student_id
    WHERE ea.id = NEW.attempt_id
      AND sp.user_id = auth.uid();

    IF attempt_status IS NULL THEN
      RAISE EXCEPTION 'answer attempt is not owned by the current student';
    END IF;

    IF attempt_status <> 'in_progress' THEN
      RAISE EXCEPTION 'answers can only be changed while the attempt is in progress';
    END IF;

    IF TG_OP = 'UPDATE'
      AND (
        NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
        OR NEW.question_id IS DISTINCT FROM OLD.question_id
      ) THEN
      RAISE EXCEPTION 'answer identity fields are immutable';
    END IF;

    IF autograding THEN
      RETURN NEW;
    END IF;

    IF NEW.is_correct IS NOT NULL
      OR NEW.awarded_points IS NOT NULL
      OR NEW.grader_notes IS NOT NULL
      OR NEW.graded_by IS NOT NULL
      OR NEW.graded_at IS NOT NULL THEN
      RAISE EXCEPTION 'students cannot write grading fields';
    END IF;

    RETURN NEW;
  END IF;

  IF actor_role IN ('school_admin', 'teacher', 'grader') THEN
    IF TG_OP = 'UPDATE'
      AND (
        NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
        OR NEW.question_id IS DISTINCT FROM OLD.question_id
      ) THEN
      RAISE EXCEPTION 'answer identity fields are immutable';
    END IF;

    RETURN NEW;
  END IF;

  IF actor_role = 'super_admin' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'role cannot write answers';
END;
$$;

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

    INSERT INTO public.answers (
      attempt_id,
      question_id,
      option_id,
      text_answer,
      numeric_answer,
      matching_data,
      ordering_data
    )
    VALUES (
      p_attempt_id,
      answer_question_id,
      answer_option_id,
      NULLIF(answer_item->>'text_answer', ''),
      NULLIF(answer_item->>'numeric_answer', '')::numeric,
      answer_item->'matching_data',
      answer_item->'ordering_data'
    )
    ON CONFLICT (attempt_id, question_id) DO UPDATE SET
      option_id = EXCLUDED.option_id,
      text_answer = EXCLUDED.text_answer,
      numeric_answer = EXCLUDED.numeric_answer,
      matching_data = EXCLUDED.matching_data,
      ordering_data = EXCLUDED.ordering_data,
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
    is_correct = NULL,
    awarded_points = NULL,
    updated_at = now()
  FROM public.exam_questions eq
  JOIN public.questions q ON q.id = eq.question_id
  WHERE a.attempt_id = p_attempt_id
    AND eq.exam_id = attempt_row.exam_id
    AND eq.question_id = a.question_id
    AND q.type NOT IN ('multiple_choice', 'true_false');

  SELECT
    coalesce(sum(CASE WHEN q.type IN ('multiple_choice', 'true_false') THEN a.awarded_points ELSE 0 END), 0),
    coalesce(sum(CASE WHEN q.type IN ('multiple_choice', 'true_false') THEN eq.points ELSE 0 END), 0),
    coalesce(sum(CASE WHEN q.type NOT IN ('multiple_choice', 'true_false') THEN eq.points ELSE 0 END), 0)
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
