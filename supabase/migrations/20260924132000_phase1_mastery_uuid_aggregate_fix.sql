-- Phase 1D follow-up: avoid unsupported min/max aggregates on UUID metadata.

CREATE OR REPLACE FUNCTION public.get_learning_outcome_mastery(
  p_exam_id uuid,
  p_student_id uuid DEFAULT NULL
)
RETURNS TABLE (
  learning_outcome_id uuid,
  code text,
  name_ar text,
  subject_id uuid,
  question_count integer,
  attempt_count integer,
  answered_count integer,
  earned_points numeric,
  possible_points numeric,
  mastery_percentage numeric,
  classification text,
  recommendation text,
  is_sufficient boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  exam_institution uuid;
  requested_student_institution uuid;
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader', 'student') THEN
    RAISE EXCEPTION 'learning_outcome_mastery_not_allowed';
  END IF;
  SELECT e.institution_id INTO exam_institution
  FROM public.examify_exams e WHERE e.id = p_exam_id;
  IF exam_institution IS NULL THEN RAISE EXCEPTION 'exam_not_found'; END IF;
  IF actor_role <> 'super_admin' AND exam_institution <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'exam_institution_denied';
  END IF;
  IF p_student_id IS NOT NULL THEN
    SELECT sp.institution_id INTO requested_student_institution
    FROM public.student_profiles sp WHERE sp.id = p_student_id;
    IF requested_student_institution IS NULL OR requested_student_institution <> exam_institution THEN
      RAISE EXCEPTION 'student_institution_denied';
    END IF;
    IF actor_role = 'student' AND NOT EXISTS (
      SELECT 1 FROM public.student_profiles sp WHERE sp.id = p_student_id AND sp.user_id = auth.uid()
    ) THEN RAISE EXCEPTION 'student_scope_denied'; END IF;
  ELSIF actor_role = 'student' THEN
    RAISE EXCEPTION 'student_scope_required';
  END IF;
  RETURN QUERY
  WITH eligible_attempts AS (
    SELECT ea.id, ea.student_id FROM public.exam_attempts ea
    WHERE ea.exam_id = p_exam_id AND ea.submitted_at IS NOT NULL
      AND ea.status IN ('graded', 'approved') AND ea.is_result_published = true
      AND (p_student_id IS NULL OR ea.student_id = p_student_id)
  ),
  outcome_questions AS (
    SELECT qlo.learning_outcome_id, eq.question_id, eq.points, qlo.weight,
      lo.code, lo.name_ar, lo.subject_id
    FROM public.exam_questions eq
    JOIN public.questions q ON q.id = eq.question_id
    JOIN public.question_learning_outcomes qlo ON qlo.question_id = q.id
    JOIN public.learning_outcomes lo ON lo.id = qlo.learning_outcome_id
    WHERE eq.exam_id = p_exam_id AND lo.status = 'active'
      AND lo.institution_id = exam_institution
  ),
  grouped AS (
    SELECT oq.learning_outcome_id, min(oq.code) AS code, min(oq.name_ar) AS name_ar,
      (array_agg(oq.subject_id))[1] AS subject_id,
      count(DISTINCT oq.question_id)::integer AS question_count,
      count(DISTINCT ea.id)::integer AS attempt_count,
      count(a.id) FILTER (WHERE a.is_correct IS NOT NULL)::integer AS answered_count,
      COALESCE(sum(CASE WHEN a.is_correct = true THEN oq.points * oq.weight ELSE 0 END), 0)::numeric AS earned_points,
      COALESCE(sum(CASE WHEN ea.id IS NOT NULL THEN oq.points * oq.weight ELSE 0 END), 0)::numeric AS possible_points
    FROM outcome_questions oq
    LEFT JOIN eligible_attempts ea ON true
    LEFT JOIN public.answers a ON a.attempt_id = ea.id AND a.question_id = oq.question_id
    GROUP BY oq.learning_outcome_id
  )
  SELECT g.learning_outcome_id, g.code, g.name_ar, g.subject_id,
    g.question_count, g.attempt_count, g.answered_count, g.earned_points, g.possible_points,
    CASE WHEN g.possible_points = 0 THEN NULL::numeric ELSE round(100 * g.earned_points / g.possible_points, 2) END,
    CASE WHEN g.attempt_count < 5 OR g.possible_points = 0 THEN 'insufficient_data'
      WHEN 100 * g.earned_points / g.possible_points < 50 THEN 'needs_review'
      WHEN 100 * g.earned_points / g.possible_points < 70 THEN 'developing' ELSE 'good' END,
    CASE WHEN g.attempt_count < 5 OR g.possible_points = 0 THEN 'بيانات غير كافية للحكم'
      WHEN 100 * g.earned_points / g.possible_points < 50 THEN 'يحتاج مراجعة أساسية'
      WHEN 100 * g.earned_points / g.possible_points < 70 THEN 'يحتاج تدريبًا إضافيًا' ELSE 'مستوى إتقان جيد' END,
    (g.attempt_count >= 5 AND g.possible_points > 0)
  FROM grouped g ORDER BY g.code, g.learning_outcome_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_learning_outcome_mastery(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_learning_outcome_mastery(uuid, uuid) TO authenticated;
