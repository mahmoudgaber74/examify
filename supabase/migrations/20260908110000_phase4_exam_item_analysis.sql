-- Phase 4 Step 4: server-authoritative exam item analysis.
-- Only finalized/graded attempts are included; in-progress and draft answers
-- must never influence teacher analytics.

CREATE OR REPLACE FUNCTION public.get_exam_item_analysis(exam_uuid uuid)
RETURNS TABLE (
  question_id uuid,
  question_number integer,
  prompt text,
  attempts_count integer,
  answered_count integer,
  correct_count integer,
  success_rate numeric,
  is_difficult boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE actor_role text := public.current_user_role();
DECLARE exam_institution uuid;
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'exam_item_analysis_not_allowed';
  END IF;
  SELECT e.institution_id INTO exam_institution
  FROM public.examify_exams e WHERE e.id = exam_uuid;
  IF exam_institution IS NULL THEN RAISE EXCEPTION 'exam_not_found'; END IF;
  IF actor_role <> 'super_admin' AND exam_institution <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'exam_institution_denied';
  END IF;

  RETURN QUERY
  SELECT eq.question_id,
    row_number() OVER (ORDER BY eq.sort_order, eq.id)::integer AS question_number,
    q.prompt,
    count(DISTINCT ea.id)::integer AS attempts_count,
    count(a.id) FILTER (WHERE a.is_correct IS NOT NULL)::integer AS answered_count,
    count(a.id) FILTER (WHERE a.is_correct = true)::integer AS correct_count,
    CASE WHEN count(a.id) FILTER (WHERE a.is_correct IS NOT NULL) = 0 THEN NULL::numeric
      ELSE round(100.0 * count(a.id) FILTER (WHERE a.is_correct = true) /
        count(a.id) FILTER (WHERE a.is_correct IS NOT NULL), 2) END AS success_rate,
    CASE WHEN count(a.id) FILTER (WHERE a.is_correct IS NOT NULL) = 0 THEN false
      ELSE (100.0 * count(a.id) FILTER (WHERE a.is_correct = true) /
        count(a.id) FILTER (WHERE a.is_correct IS NOT NULL)) < 40 END AS is_difficult
  FROM public.exam_questions eq
  JOIN public.questions q ON q.id = eq.question_id
  LEFT JOIN public.exam_attempts ea ON ea.exam_id = eq.exam_id
    AND ea.status IN ('graded', 'approved') AND ea.submitted_at IS NOT NULL
  LEFT JOIN public.answers a ON a.attempt_id = ea.id AND a.question_id = eq.question_id
  WHERE eq.exam_id = exam_uuid
  GROUP BY eq.question_id, eq.sort_order, eq.id, q.prompt
  ORDER BY eq.sort_order, eq.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_item_analysis(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_exam_item_analysis(uuid) TO authenticated;

