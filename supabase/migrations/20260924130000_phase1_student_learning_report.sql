-- Phase 1E: server-authoritative student learning-outcome report.

CREATE OR REPLACE FUNCTION public.get_student_learning_outcome_report(
  p_exam_id uuid,
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_institution uuid := public.current_user_institution_id();
  v_exam public.examify_exams%ROWTYPE;
  v_student public.student_profiles%ROWTYPE;
  v_mastery jsonb;
  v_questions jsonb;
  v_attempts jsonb;
  v_attempt_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'student_report_authentication_required'; END IF;
  IF v_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader', 'student') THEN
    RAISE EXCEPTION 'student_report_role_not_allowed';
  END IF;

  SELECT * INTO v_exam FROM public.examify_exams e WHERE e.id = p_exam_id;
  IF v_exam.id IS NULL THEN RAISE EXCEPTION 'student_report_exam_not_found'; END IF;
  IF v_role <> 'super_admin' AND v_exam.institution_id <> v_institution THEN
    RAISE EXCEPTION 'student_report_institution_denied';
  END IF;
  IF v_role = 'teacher' AND NOT (
    v_exam.teacher_id = public.current_staff_profile_id()
    OR (
      v_exam.subject_id IS NOT NULL
      AND public.teacher_has_subject_scope(v_exam.subject_id)
      AND (v_exam.class_id IS NULL OR public.teacher_has_class_scope(v_exam.class_id, NULL))
    )
  ) THEN RAISE EXCEPTION 'student_report_teacher_scope_denied'; END IF;

  SELECT * INTO v_student
  FROM public.student_profiles sp
  WHERE sp.id = p_student_id AND sp.institution_id = v_exam.institution_id;
  IF v_student.id IS NULL THEN RAISE EXCEPTION 'student_report_student_not_found'; END IF;
  IF v_role = 'student' AND v_student.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'student_report_self_only';
  END IF;

  SELECT count(*)::integer, COALESCE(jsonb_agg(jsonb_build_object(
    'id', ea.id, 'attempt_number', ea.attempt_number, 'score', ea.score,
    'score_percentage', ea.score_percentage, 'submitted_at', ea.submitted_at
  ) ORDER BY ea.attempt_number), '[]'::jsonb)
  INTO v_attempt_count, v_attempts
  FROM public.exam_attempts ea
  WHERE ea.exam_id = p_exam_id AND ea.student_id = p_student_id
    AND ea.status IN ('graded', 'approved')
    AND ea.submitted_at IS NOT NULL AND ea.is_result_published = true;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.code), '[]'::jsonb)
  INTO v_mastery
  FROM public.get_learning_outcome_mastery(p_exam_id, p_student_id) m;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'question_id', row.question_id, 'question_number', row.question_number,
    'prompt', row.prompt, 'unit', row.unit, 'lesson', row.lesson,
    'attempts_count', row.attempts_count, 'answered_count', row.answered_count,
    'correct_count', row.correct_count, 'earned_points', row.earned_points,
    'possible_points', row.possible_points
  ) ORDER BY row.question_number), '[]'::jsonb)
  INTO v_questions
  FROM (
    SELECT eq.question_id,
      row_number() OVER (ORDER BY eq.sort_order, eq.id)::integer AS question_number,
      q.prompt, q.unit, q.lesson,
      count(DISTINCT ea.id)::integer AS attempts_count,
      count(a.id) FILTER (WHERE a.is_correct IS NOT NULL)::integer AS answered_count,
      count(a.id) FILTER (WHERE a.is_correct = true)::integer AS correct_count,
      COALESCE(sum(a.awarded_points) FILTER (WHERE a.is_correct IS NOT NULL), 0)::numeric AS earned_points,
      (count(DISTINCT ea.id) * eq.points)::numeric AS possible_points
    FROM public.exam_questions eq
    JOIN public.questions q ON q.id = eq.question_id
    LEFT JOIN public.exam_attempts ea ON ea.exam_id = eq.exam_id
      AND ea.student_id = p_student_id
      AND ea.status IN ('graded', 'approved')
      AND ea.submitted_at IS NOT NULL AND ea.is_result_published = true
    LEFT JOIN public.answers a ON a.attempt_id = ea.id AND a.question_id = eq.question_id
    WHERE eq.exam_id = p_exam_id
    GROUP BY eq.question_id, eq.sort_order, eq.id, q.prompt, q.unit, q.lesson, eq.points
  ) row;

  RETURN jsonb_build_object(
    'institution', jsonb_build_object('id', v_exam.institution_id,
      'name', (SELECT i.name FROM public.institutions i WHERE i.id = v_exam.institution_id),
      'logo_url', (SELECT i.logo_url FROM public.institutions i WHERE i.id = v_exam.institution_id)),
    'student', jsonb_build_object('id', v_student.id, 'full_name', v_student.full_name,
      'student_code', v_student.student_code, 'phone', v_student.phone),
    'exam', jsonb_build_object('id', v_exam.id, 'title', v_exam.title,
      'subject_id', v_exam.subject_id,
      'subject_name', (SELECT s.name FROM public.subjects s WHERE s.id = v_exam.subject_id),
      'class_id', v_exam.class_id,
      'class_name', (SELECT c.name FROM public.classes c WHERE c.id = v_exam.class_id),
      'total_points', v_exam.total_points, 'passing_score', v_exam.passing_score),
    'eligible_attempt_count', v_attempt_count,
    'attempts', v_attempts, 'mastery', v_mastery, 'questions', v_questions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_learning_outcome_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_student_learning_outcome_report(uuid, uuid) TO authenticated;
