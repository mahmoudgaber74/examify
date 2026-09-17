/* Phase 7.1: server-issued attempt deadlines and one-time offline recovery. */
BEGIN;

ALTER TABLE public.exam_attempts
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS offline_recovery_token uuid;

/* Existing in-progress attempts receive a deterministic deadline from their
   server-created started_at. No browser timestamp is used. */
UPDATE public.exam_attempts ea
SET deadline_at = LEAST(
  ea.started_at + make_interval(mins => e.duration_minutes),
  COALESCE(e.end_at, '9999-12-31 23:59:59+00'::timestamptz)
),
offline_recovery_token = COALESCE(ea.offline_recovery_token, gen_random_uuid())
FROM public.examify_exams e
WHERE e.id = ea.exam_id
  AND ea.status = 'in_progress'
  AND ea.deadline_at IS NULL;

UPDATE public.exam_attempts
SET offline_recovery_token = gen_random_uuid()
WHERE status = 'in_progress'
  AND offline_recovery_token IS NULL;

CREATE OR REPLACE FUNCTION public.start_exam_attempt(p_exam_id uuid)
RETURNS public.exam_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  exam_row public.examify_exams%ROWTYPE;
  student_row public.student_profiles%ROWTYPE;
  attempt_row public.exam_attempts%ROWTYPE;
  next_number integer;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'student' THEN RAISE EXCEPTION 'student_required'; END IF;
  SELECT * INTO student_row FROM public.student_profiles WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'student_profile_not_found'; END IF;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = p_exam_id FOR UPDATE;
  IF NOT FOUND OR exam_row.institution_id <> public.current_user_institution_id() OR exam_row.status <> 'published' THEN RAISE EXCEPTION 'exam_not_available'; END IF;
  IF (exam_row.start_at IS NOT NULL AND exam_row.start_at > now()) OR (exam_row.end_at IS NOT NULL AND exam_row.end_at < now()) THEN RAISE EXCEPTION 'exam_outside_availability_window'; END IF;
  IF NOT public.is_exam_assigned_to_current_student(p_exam_id) THEN RAISE EXCEPTION 'exam_not_assigned'; END IF;
  SELECT * INTO attempt_row FROM public.exam_attempts WHERE exam_id = p_exam_id AND student_id = student_row.id AND status = 'in_progress' ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF attempt_row.deadline_at IS NULL THEN
      UPDATE public.exam_attempts SET deadline_at = LEAST(attempt_row.started_at + make_interval(mins => exam_row.duration_minutes), COALESCE(exam_row.end_at, '9999-12-31 23:59:59+00'::timestamptz)), offline_recovery_token = COALESCE(attempt_row.offline_recovery_token, gen_random_uuid()) WHERE id = attempt_row.id RETURNING * INTO attempt_row;
    END IF;
    RETURN attempt_row;
  END IF;
  SELECT count(*)::integer INTO next_number FROM public.exam_attempts WHERE exam_id = p_exam_id AND student_id = student_row.id AND status IN ('submitted', 'auto_submitted', 'graded', 'approved');
  IF next_number >= exam_row.max_attempts THEN RAISE EXCEPTION 'maximum_attempts_exceeded'; END IF;
  next_number := next_number + 1;
  INSERT INTO public.exam_attempts (exam_id, student_id, attempt_number, status, deadline_at, offline_recovery_token)
  VALUES (p_exam_id, student_row.id, next_number, 'in_progress', LEAST(now() + make_interval(mins => exam_row.duration_minutes), COALESCE(exam_row.end_at, '9999-12-31 23:59:59+00'::timestamptz)), gen_random_uuid())
  RETURNING * INTO attempt_row;
  RETURN attempt_row;
END; $$;
REVOKE ALL ON FUNCTION public.start_exam_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.submit_exam_attempt(uuid, jsonb, boolean, integer);

CREATE OR REPLACE FUNCTION public.submit_exam_attempt(
  p_attempt_id uuid,
  p_answers jsonb DEFAULT '[]'::jsonb,
  p_auto boolean DEFAULT false,
  p_time_remaining_seconds integer DEFAULT NULL,
  p_offline_recovery_token uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  answer_item jsonb;
  answer_question_id uuid;
  answer_option_id uuid;
  answer_payload jsonb;
  objective_score numeric(8,2) := 0;
  objective_total numeric(8,2) := 0;
  manual_total numeric(8,2) := 0;
  pct numeric(5,2) := 0;
  needs_manual boolean := false;
  submitted_status text;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'student' THEN RAISE EXCEPTION 'student_required'; END IF;
  SELECT ea.* INTO attempt_row FROM public.exam_attempts ea JOIN public.student_profiles sp ON sp.id = ea.student_id WHERE ea.id = p_attempt_id AND sp.user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found_or_forbidden'; END IF;
  IF attempt_row.status <> 'in_progress' THEN
    RETURN jsonb_build_object('attempt_id', attempt_row.id, 'status', attempt_row.status, 'score', attempt_row.score, 'score_percentage', attempt_row.score_percentage, 'is_passed', attempt_row.is_passed, 'needs_manual_grading', attempt_row.status IN ('submitted', 'auto_submitted'), 'is_result_published', attempt_row.is_result_published);
  END IF;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id AND institution_id = public.current_user_institution_id() AND status = 'published';
  IF NOT FOUND OR NOT public.is_exam_assigned_to_current_student(attempt_row.exam_id) THEN RAISE EXCEPTION 'exam_not_available'; END IF;
  IF attempt_row.deadline_at IS NULL OR attempt_row.offline_recovery_token IS NULL THEN RAISE EXCEPTION 'attempt_deadline_unavailable'; END IF;
  IF now() > attempt_row.deadline_at AND (NOT p_auto OR p_offline_recovery_token IS NULL OR p_offline_recovery_token <> attempt_row.offline_recovery_token) THEN RAISE EXCEPTION 'attempt_expired'; END IF;
  IF jsonb_typeof(coalesce(p_answers, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'answers_payload_must_be_array'; END IF;

  PERFORM set_config('app.exam_autograding', 'on', true);
  FOR answer_item IN SELECT value FROM jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) LOOP
    answer_question_id := NULLIF(answer_item->>'question_id', '')::uuid;
    answer_option_id := NULLIF(answer_item->>'option_id', '')::uuid;
    answer_payload := CASE WHEN answer_item ? 'answer_payload' AND jsonb_typeof(answer_item->'answer_payload') = 'object' THEN answer_item->'answer_payload' ELSE NULL END;
    IF NOT EXISTS (SELECT 1 FROM public.exam_questions eq WHERE eq.exam_id = attempt_row.exam_id AND eq.question_id = answer_question_id) THEN RAISE EXCEPTION 'answer_question_not_in_exam'; END IF;
    IF answer_option_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.question_options qo WHERE qo.id = answer_option_id AND qo.question_id = answer_question_id) THEN RAISE EXCEPTION 'answer_option_not_in_question'; END IF;
    IF answer_item ? 'answer_payload' AND jsonb_typeof(answer_item->'answer_payload') NOT IN ('object', 'null') THEN RAISE EXCEPTION 'answer_payload_must_be_object'; END IF;
    INSERT INTO public.answers (attempt_id, question_id, option_id, text_answer, numeric_answer, matching_data, ordering_data, answer_payload)
    VALUES (p_attempt_id, answer_question_id, answer_option_id, NULLIF(answer_item->>'text_answer', ''), NULLIF(answer_item->>'numeric_answer', '')::numeric, coalesce(answer_item->'matching_data', answer_payload->'matches'), coalesce(answer_item->'ordering_data', answer_payload->'order'), answer_payload)
    ON CONFLICT (attempt_id, question_id) DO UPDATE SET option_id = EXCLUDED.option_id, text_answer = EXCLUDED.text_answer, numeric_answer = EXCLUDED.numeric_answer, matching_data = EXCLUDED.matching_data, ordering_data = EXCLUDED.ordering_data, answer_payload = EXCLUDED.answer_payload, updated_at = now();
  END LOOP;
  INSERT INTO public.answers (attempt_id, question_id) SELECT p_attempt_id, eq.question_id FROM public.exam_questions eq WHERE eq.exam_id = attempt_row.exam_id ON CONFLICT (attempt_id, question_id) DO NOTHING;

  UPDATE public.answers a SET is_correct = EXISTS (SELECT 1 FROM public.question_options qo WHERE qo.id = a.option_id AND qo.question_id = a.question_id AND qo.is_correct = true), awarded_points = CASE WHEN EXISTS (SELECT 1 FROM public.question_options qo WHERE qo.id = a.option_id AND qo.question_id = a.question_id AND qo.is_correct = true) THEN eq.points ELSE 0 END, graded_at = now(), updated_at = now() FROM public.exam_questions eq JOIN public.questions q ON q.id = eq.question_id WHERE a.attempt_id = p_attempt_id AND eq.exam_id = attempt_row.exam_id AND eq.question_id = a.question_id AND q.type IN ('multiple_choice', 'true_false');
  UPDATE public.answers a SET is_correct = scored.is_correct, awarded_points = scored.awarded_points, graded_at = now(), updated_at = now() FROM (SELECT a2.id AS answer_id, (score_result.result->>'is_correct')::boolean AS is_correct, (score_result.result->>'awarded_points')::numeric AS awarded_points FROM public.answers a2 JOIN public.exam_questions eq ON eq.question_id = a2.question_id JOIN public.questions q ON q.id = eq.question_id CROSS JOIN LATERAL public.grade_advanced_answer(q.type, coalesce(q.metadata->'advanced_config', '{}'::jsonb), coalesce(a2.answer_payload, '{}'::jsonb), eq.points) AS score_result(result) WHERE a2.attempt_id = p_attempt_id AND eq.exam_id = attempt_row.exam_id AND q.type IN ('fill_blank', 'matching', 'ordering')) scored WHERE a.id = scored.answer_id;
  UPDATE public.answers a SET is_correct = NULL, awarded_points = NULL, updated_at = now() FROM public.exam_questions eq JOIN public.questions q ON q.id = eq.question_id WHERE a.attempt_id = p_attempt_id AND eq.exam_id = attempt_row.exam_id AND eq.question_id = a.question_id AND q.type NOT IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering');
  SELECT coalesce(sum(CASE WHEN q.type IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering') THEN a.awarded_points ELSE 0 END), 0), coalesce(sum(CASE WHEN q.type IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering') THEN eq.points ELSE 0 END), 0), coalesce(sum(CASE WHEN q.type NOT IN ('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering') THEN eq.points ELSE 0 END), 0) INTO objective_score, objective_total, manual_total FROM public.exam_questions eq JOIN public.questions q ON q.id = eq.question_id LEFT JOIN public.answers a ON a.attempt_id = p_attempt_id AND a.question_id = eq.question_id WHERE eq.exam_id = attempt_row.exam_id;
  needs_manual := manual_total > 0;
  pct := CASE WHEN exam_row.total_points > 0 THEN round((objective_score / exam_row.total_points) * 100, 2) ELSE 0 END;
  submitted_status := CASE WHEN needs_manual THEN CASE WHEN p_auto THEN 'auto_submitted' ELSE 'submitted' END ELSE 'graded' END;
  UPDATE public.exam_attempts SET status = submitted_status, submitted_at = coalesce(submitted_at, now()), time_remaining_seconds = NULL, score = objective_score, score_percentage = pct, is_passed = CASE WHEN needs_manual THEN NULL ELSE pct >= exam_row.passing_score END, graded_at = now(), is_result_published = false, offline_recovery_token = NULL WHERE id = p_attempt_id;
  RETURN jsonb_build_object('attempt_id', p_attempt_id, 'status', submitted_status, 'score', objective_score, 'score_percentage', pct, 'is_passed', CASE WHEN needs_manual THEN NULL ELSE pct >= exam_row.passing_score END, 'needs_manual_grading', needs_manual, 'objective_score', objective_score, 'objective_total', objective_total, 'manual_total', manual_total, 'is_result_published', false);
END; $$;
REVOKE ALL ON FUNCTION public.submit_exam_attempt(uuid, jsonb, boolean, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid, jsonb, boolean, integer, uuid) TO authenticated;

COMMIT;
