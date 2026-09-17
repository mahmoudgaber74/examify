/* Phase 4 Step 2: AI may suggest; only an authorized teacher finalizes. */
ALTER TABLE public.answers
  ADD COLUMN IF NOT EXISTS ai_suggested_score numeric(8,2),
  ADD COLUMN IF NOT EXISTS ai_feedback text,
  ADD COLUMN IF NOT EXISTS is_teacher_approved boolean NOT NULL DEFAULT false;

ALTER TABLE public.answers
  ADD CONSTRAINT answers_ai_suggested_score_range
  CHECK (ai_suggested_score IS NULL OR ai_suggested_score >= 0);

CREATE OR REPLACE FUNCTION public.record_ai_answer_suggestion(
  p_answer_id uuid,
  p_suggested_score numeric,
  p_feedback text
)
RETURNS public.answers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  answer_row public.answers%ROWTYPE;
  exam_institution uuid;
  max_points numeric;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN RAISE EXCEPTION 'ai_suggestion_not_allowed'; END IF;
  IF p_feedback IS NULL OR length(trim(p_feedback)) = 0 THEN RAISE EXCEPTION 'ai_feedback_required'; END IF;
  SELECT * INTO answer_row FROM public.answers WHERE id = p_answer_id;
  IF answer_row.id IS NULL THEN RAISE EXCEPTION 'answer_not_found'; END IF;
  SELECT e.institution_id, COALESCE(eq.points, q.points, 1) INTO exam_institution, max_points
  FROM public.exam_attempts ea JOIN public.examify_exams e ON e.id = ea.exam_id JOIN public.questions q ON q.id = answer_row.question_id
  LEFT JOIN public.exam_questions eq ON eq.exam_id = ea.exam_id AND eq.question_id = answer_row.question_id
  WHERE ea.id = answer_row.attempt_id;
  IF public.current_user_role() <> 'super_admin' AND exam_institution <> public.current_user_institution_id() THEN RAISE EXCEPTION 'grading_institution_denied'; END IF;
  IF p_suggested_score IS NULL OR p_suggested_score < 0 OR p_suggested_score > max_points THEN RAISE EXCEPTION 'invalid_ai_suggested_score'; END IF;
  UPDATE public.answers SET ai_suggested_score = p_suggested_score, ai_feedback = trim(p_feedback), is_teacher_approved = false, updated_at = now() WHERE id = p_answer_id;
  SELECT * INTO answer_row FROM public.answers WHERE id = p_answer_id;
  RETURN answer_row;
END; $$;

CREATE OR REPLACE FUNCTION public.approve_ai_answer_score(
  p_answer_id uuid,
  p_final_score numeric,
  p_review_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  answer_row public.answers%ROWTYPE;
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  max_points numeric;
  total_score numeric;
  total_points numeric;
  percentage numeric;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN RAISE EXCEPTION 'grading_approval_not_allowed'; END IF;
  IF p_review_reason IS NULL OR length(trim(p_review_reason)) < 3 THEN RAISE EXCEPTION 'review_reason_required'; END IF;
  SELECT * INTO answer_row FROM public.answers WHERE id = p_answer_id;
  IF answer_row.id IS NULL THEN RAISE EXCEPTION 'answer_not_found'; END IF;
  SELECT * INTO attempt_row FROM public.exam_attempts WHERE id = answer_row.attempt_id;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id;
  IF public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id() THEN RAISE EXCEPTION 'grading_institution_denied'; END IF;
  SELECT COALESCE(eq.points, q.points, 1) INTO max_points FROM public.questions q LEFT JOIN public.exam_questions eq ON eq.exam_id = attempt_row.exam_id AND eq.question_id = q.id WHERE q.id = answer_row.question_id;
  IF p_final_score IS NULL OR p_final_score < 0 OR p_final_score > max_points THEN RAISE EXCEPTION 'invalid_final_score'; END IF;
  UPDATE public.answers SET awarded_points = p_final_score, is_correct = p_final_score >= max_points / 2, grader_notes = concat('AI suggestion: ', COALESCE(answer_row.ai_feedback, ''), E'
Teacher review: ', trim(p_review_reason)), graded_by = auth.uid(), graded_at = now(), is_teacher_approved = true, updated_at = now() WHERE id = p_answer_id;
  SELECT COALESCE(sum(COALESCE(a.awarded_points, 0)), 0), COALESCE(sum(eq.points), exam_row.total_points) INTO total_score, total_points FROM public.exam_questions eq LEFT JOIN public.answers a ON a.attempt_id = attempt_row.id AND a.question_id = eq.question_id WHERE eq.exam_id = attempt_row.exam_id;
  percentage := CASE WHEN total_points > 0 THEN round((total_score / total_points) * 100, 2) ELSE 0 END;
  UPDATE public.exam_attempts SET status = 'graded', score = total_score, score_percentage = percentage, is_passed = percentage >= exam_row.passing_score, graded_by = auth.uid(), graded_at = now(), is_result_published = false WHERE id = attempt_row.id;
  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details) VALUES (exam_row.institution_id, auth.uid(), public.current_user_role(), 'ai_answer_teacher_approved', 'answer', p_answer_id, jsonb_build_object('final_score', p_final_score, 'reason', trim(p_review_reason)));
  RETURN jsonb_build_object('status', 'approved', 'answer_id', p_answer_id, 'attempt_id', attempt_row.id, 'score', total_score, 'score_percentage', percentage);
END; $$;

REVOKE ALL ON FUNCTION public.record_ai_answer_suggestion(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_ai_answer_score(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ai_answer_suggestion(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_ai_answer_score(uuid, numeric, text) TO authenticated;
