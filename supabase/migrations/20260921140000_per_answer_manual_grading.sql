/*
  Forward-only per-answer manual grading.
  Existing published attempts are not backfilled or rewritten.
*/

CREATE OR REPLACE FUNCTION public.record_manual_answer_grade(
  p_answer_id uuid,
  p_awarded_points numeric,
  p_grader_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  answer_row public.answers%ROWTYPE;
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  max_points numeric;
  question_type text;
  total_score numeric;
  percentage numeric;
  pending_manual boolean;
  normalized_notes text := NULLIF(trim(COALESCE(p_grader_notes, '')), '');
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'manual_answer_grading_not_allowed';
  END IF;

  SELECT * INTO answer_row
  FROM public.answers
  WHERE id = p_answer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'answer_not_found'; END IF;

  SELECT * INTO attempt_row
  FROM public.exam_attempts
  WHERE id = answer_row.attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;

  SELECT * INTO exam_row
  FROM public.examify_exams
  WHERE id = attempt_row.exam_id;
  IF NOT FOUND OR (public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id()) THEN
    RAISE EXCEPTION 'grading_institution_denied';
  END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_can_access_exam(exam_row.id) THEN
    RAISE EXCEPTION 'grading_scope_denied';
  END IF;

  IF attempt_row.status NOT IN ('submitted', 'auto_submitted', 'graded') OR attempt_row.is_result_published OR attempt_row.status = 'approved' THEN
    RAISE EXCEPTION 'attempt_not_gradeable';
  END IF;

  SELECT eq.points, q.type INTO max_points, question_type
  FROM public.exam_questions eq
  JOIN public.questions q ON q.id = eq.question_id
  WHERE eq.exam_id = attempt_row.exam_id AND eq.question_id = answer_row.question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'answer_question_not_in_exam'; END IF;
  IF question_type IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering') THEN
    RAISE EXCEPTION 'answer_is_automatically_graded';
  END IF;

  IF p_awarded_points IS NULL OR p_awarded_points::text = 'NaN' OR p_awarded_points < 0 OR p_awarded_points > max_points THEN
    RAISE EXCEPTION 'invalid_answer_score';
  END IF;

  UPDATE public.answers
  SET awarded_points = p_awarded_points,
      grader_notes = normalized_notes,
      graded_by = auth.uid(),
      graded_at = now(),
      is_correct = CASE
        WHEN p_awarded_points = max_points THEN true
        WHEN p_awarded_points = 0 THEN false
        ELSE NULL
      END,
      updated_at = now()
  WHERE id = answer_row.id;

  SELECT COALESCE(SUM(COALESCE(a.awarded_points, 0)), 0)
  INTO total_score
  FROM public.answers a
  WHERE a.attempt_id = attempt_row.id;
  IF total_score > exam_row.total_points THEN RAISE EXCEPTION 'score_exceeds_exam_total'; END IF;

  percentage := CASE WHEN exam_row.total_points > 0 THEN round((total_score / exam_row.total_points) * 100, 2) ELSE 0 END;

  SELECT EXISTS (
    SELECT 1
    FROM public.exam_questions eq
    JOIN public.questions q ON q.id = eq.question_id
    LEFT JOIN public.answers a ON a.attempt_id = attempt_row.id AND a.question_id = eq.question_id
    WHERE eq.exam_id = attempt_row.exam_id
      AND q.type NOT IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering')
      AND a.awarded_points IS NULL
  ) INTO pending_manual;

  UPDATE public.exam_attempts
  SET score = total_score,
      score_percentage = percentage,
      is_passed = CASE WHEN pending_manual THEN NULL ELSE percentage >= exam_row.passing_score END,
      status = CASE WHEN pending_manual THEN CASE WHEN attempt_row.status = 'auto_submitted' THEN 'auto_submitted' ELSE 'submitted' END ELSE 'graded' END,
      graded_by = CASE WHEN pending_manual THEN NULL ELSE auth.uid() END,
      graded_at = CASE WHEN pending_manual THEN NULL ELSE now() END,
      is_result_published = false
  WHERE id = attempt_row.id;

  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details)
  VALUES (
    exam_row.institution_id,
    auth.uid(),
    public.current_user_role(),
    'manual_answer_grade_recorded',
    'answer',
    answer_row.id,
    jsonb_build_object(
      'answer_id', answer_row.id,
      'attempt_id', attempt_row.id,
      'previous_awarded_points', answer_row.awarded_points,
      'new_awarded_points', p_awarded_points,
      'question_max_points', max_points,
      'previous_grader_notes', answer_row.grader_notes,
      'new_grader_notes', normalized_notes
    )
  );

  RETURN jsonb_build_object(
    'answer_id', answer_row.id,
    'attempt_id', attempt_row.id,
    'awarded_points', p_awarded_points,
    'score', total_score,
    'score_percentage', percentage,
    'status', CASE WHEN pending_manual THEN CASE WHEN attempt_row.status = 'auto_submitted' THEN 'auto_submitted' ELSE 'submitted' END ELSE 'graded' END,
    'is_passed', CASE WHEN pending_manual THEN NULL ELSE percentage >= exam_row.passing_score END,
    'pending_manual_answers', (SELECT count(*)::integer FROM public.exam_questions eq JOIN public.questions q ON q.id = eq.question_id LEFT JOIN public.answers a ON a.attempt_id = attempt_row.id AND a.question_id = eq.question_id WHERE eq.exam_id = attempt_row.exam_id AND q.type NOT IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering') AND a.awarded_points IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_manual_answer_grade(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_manual_answer_grade(uuid, numeric, text) TO authenticated;

/* The legacy whole-attempt RPC remains for compatibility, but is now an
   exceptional admin-only path; teachers and graders use answer-level grading. */
CREATE OR REPLACE FUNCTION public.record_manual_exam_grade(p_attempt_id uuid, p_score numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  pct numeric(5,2);
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin', 'school_admin') THEN RAISE EXCEPTION 'grading_not_allowed'; END IF;
  SELECT * INTO attempt_row FROM public.exam_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id;
  IF NOT FOUND OR (public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id()) THEN RAISE EXCEPTION 'grading_institution_denied'; END IF;
  IF attempt_row.status NOT IN ('submitted', 'auto_submitted', 'graded') OR attempt_row.is_result_published THEN RAISE EXCEPTION 'attempt_not_gradeable'; END IF;
  IF p_score IS NULL OR p_score::text = 'NaN' OR p_score < 0 OR p_score > exam_row.total_points THEN RAISE EXCEPTION 'invalid_score'; END IF;
  pct := CASE WHEN exam_row.total_points > 0 THEN round((p_score / exam_row.total_points) * 100, 2) ELSE 0 END;
  UPDATE public.exam_attempts SET score = p_score, score_percentage = pct, is_passed = pct >= exam_row.passing_score, status = 'graded', graded_by = auth.uid(), graded_at = now(), is_result_published = false WHERE id = p_attempt_id;
  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details) VALUES (exam_row.institution_id, auth.uid(), public.current_user_role(), 'manual_exam_grade_recorded', 'exam_attempt', p_attempt_id, jsonb_build_object('score', p_score, 'percentage', pct, 'exceptional_override', true));
  RETURN jsonb_build_object('attempt_id', p_attempt_id, 'status', 'graded', 'score', p_score, 'score_percentage', pct, 'is_passed', pct >= exam_row.passing_score);
END;
$$;

REVOKE ALL ON FUNCTION public.record_manual_exam_grade(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_manual_exam_grade(uuid, numeric) TO authenticated;
