/*
  Canonical scoring model for future activity:
    examify_exams.total_points is the exam maximum.
    A draft may be built incrementally, but publication requires the question
    points to equal that maximum. Existing published exams/results are not
    changed by this migration.
*/

CREATE OR REPLACE FUNCTION public.get_exam_question_points_total(p_exam_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(eq.points), 0)::numeric
  FROM public.exam_questions eq
  WHERE eq.exam_id = p_exam_id;
$$;

REVOKE ALL ON FUNCTION public.get_exam_question_points_total(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.publish_exam(p_exam_id uuid)
RETURNS public.examify_exams
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  exam_row public.examify_exams%ROWTYPE;
  question_count integer;
  question_points_total numeric;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'exam_publish_not_allowed';
  END IF;

  SELECT * INTO exam_row
  FROM public.examify_exams
  WHERE id = p_exam_id
  FOR UPDATE;

  IF NOT FOUND OR (public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id()) THEN
    RAISE EXCEPTION 'exam_publish_institution_denied';
  END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_can_access_exam(p_exam_id) THEN
    RAISE EXCEPTION 'exam_publish_scope_denied';
  END IF;

  SELECT count(*)::integer, COALESCE(SUM(eq.points), 0)::numeric
  INTO question_count, question_points_total
  FROM public.exam_questions eq
  WHERE eq.exam_id = p_exam_id;

  IF exam_row.title IS NULL OR length(trim(exam_row.title)) = 0
     OR exam_row.total_points <= 0
     OR exam_row.passing_score < 0 OR exam_row.passing_score > 100
     OR exam_row.duration_minutes <= 0
     OR question_count = 0
     OR EXISTS (SELECT 1 FROM public.exam_questions eq WHERE eq.exam_id = p_exam_id AND eq.points <= 0)
  THEN
    RAISE EXCEPTION 'exam_not_ready_for_publication';
  END IF;

  IF question_points_total <> exam_row.total_points THEN
    RAISE EXCEPTION 'exam_question_points_mismatch: configured_total=%, question_points_total=%', exam_row.total_points, question_points_total;
  END IF;

  UPDATE public.examify_exams
  SET status = 'published', updated_at = now()
  WHERE id = p_exam_id
  RETURNING * INTO exam_row;
  RETURN exam_row;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_exam(uuid) TO authenticated;

/* Enforce the canonical maximum for every authoritative grading path,
   including OMR, without changing extraction or answer-selection logic. */
CREATE OR REPLACE FUNCTION public.enforce_exam_attempt_score_bounds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE exam_total numeric;
BEGIN
  IF NEW.score IS NULL THEN RETURN NEW; END IF;
  SELECT e.total_points INTO exam_total
  FROM public.examify_exams e
  WHERE e.id = NEW.exam_id;
  IF exam_total IS NULL OR NEW.score < 0 OR NEW.score > exam_total THEN
    RAISE EXCEPTION 'score_exceeds_exam_total';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_exam_attempt_score_bounds ON public.exam_attempts;
CREATE TRIGGER enforce_exam_attempt_score_bounds
BEFORE INSERT OR UPDATE OF score ON public.exam_attempts
FOR EACH ROW EXECUTE FUNCTION public.enforce_exam_attempt_score_bounds();

/* AI approval keeps its rubric and awarded-point behavior, but uses the
   canonical exam total for the percentage and rejects an aggregate overflow. */
CREATE OR REPLACE FUNCTION public.approve_ai_answer_score(p_answer_id uuid, p_final_score numeric, p_review_reason text)
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
  total_score numeric;
  percentage numeric;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin','school_admin','teacher','grader') THEN RAISE EXCEPTION 'grading_approval_not_allowed'; END IF;
  IF p_review_reason IS NULL OR length(trim(p_review_reason)) < 3 THEN RAISE EXCEPTION 'review_reason_required'; END IF;
  SELECT * INTO answer_row FROM public.answers WHERE id = p_answer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'answer_not_found'; END IF;
  SELECT * INTO attempt_row FROM public.exam_attempts WHERE id = answer_row.attempt_id FOR UPDATE;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id;
  IF NOT FOUND OR (public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id()) THEN RAISE EXCEPTION 'grading_institution_denied'; END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_can_access_exam(exam_row.id) THEN RAISE EXCEPTION 'grading_scope_denied'; END IF;
  IF attempt_row.status NOT IN ('submitted','auto_submitted','graded') OR attempt_row.is_result_published THEN RAISE EXCEPTION 'attempt_not_gradeable'; END IF;
  SELECT eq.points INTO max_points FROM public.exam_questions eq WHERE eq.exam_id = attempt_row.exam_id AND eq.question_id = answer_row.question_id;
  IF max_points IS NULL OR p_final_score IS NULL OR p_final_score < 0 OR p_final_score > max_points THEN RAISE EXCEPTION 'invalid_final_score'; END IF;
  IF answer_row.is_teacher_approved THEN
    RETURN jsonb_build_object('status','approved','answer_id',p_answer_id,'attempt_id',attempt_row.id,'score',answer_row.awarded_points);
  END IF;
  UPDATE public.answers
  SET awarded_points = p_final_score,
      is_correct = p_final_score >= max_points,
      grader_notes = concat('AI suggestion: ', COALESCE(answer_row.ai_feedback, ''), E'
Teacher review: ', trim(p_review_reason)),
      graded_by = auth.uid(), graded_at = now(), is_teacher_approved = true, updated_at = now()
  WHERE id = p_answer_id;
  SELECT COALESCE(sum(COALESCE(a.awarded_points, 0)), 0)
  INTO total_score
  FROM public.exam_questions eq
  LEFT JOIN public.answers a ON a.attempt_id = attempt_row.id AND a.question_id = eq.question_id
  WHERE eq.exam_id = attempt_row.exam_id;
  IF total_score > exam_row.total_points THEN RAISE EXCEPTION 'score_exceeds_exam_total'; END IF;
  percentage := CASE WHEN exam_row.total_points > 0 THEN round((total_score / exam_row.total_points) * 100, 2) ELSE 0 END;
  UPDATE public.exam_attempts
  SET status = 'graded', score = total_score, score_percentage = percentage,
      is_passed = CASE WHEN EXISTS (
        SELECT 1 FROM public.exam_questions eq JOIN public.questions q ON q.id = eq.question_id
        WHERE eq.exam_id = attempt_row.exam_id AND q.type NOT IN ('multiple_choice','true_false','fill_blank','matching','ordering')
          AND NOT EXISTS (SELECT 1 FROM public.answers ax WHERE ax.attempt_id = attempt_row.id AND ax.question_id = eq.question_id AND ax.is_teacher_approved)
      ) THEN NULL ELSE percentage >= exam_row.passing_score END,
      graded_by = auth.uid(), graded_at = now(), is_result_published = false
  WHERE id = attempt_row.id;
  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details)
  VALUES (exam_row.institution_id, auth.uid(), public.current_user_role(), 'ai_answer_teacher_approved', 'answer', p_answer_id, jsonb_build_object('final_score', p_final_score, 'reason', trim(p_review_reason)));
  RETURN jsonb_build_object('status','approved','answer_id',p_answer_id,'attempt_id',attempt_row.id,'score',total_score,'score_percentage',percentage);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_ai_answer_score(uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_ai_answer_score(uuid,numeric,text) TO authenticated;
