/* Phase 7: server-authoritative exam lifecycle and idempotent publication events. */
BEGIN;

CREATE TABLE IF NOT EXISTS public.result_publication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'result_published' CHECK (event_type = 'result_published'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'created')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
ALTER TABLE public.result_publication_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.result_publication_events FROM anon, authenticated;

ALTER TABLE public.parent_notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS whatsapp_error text;
CREATE UNIQUE INDEX IF NOT EXISTS parent_notifications_dedupe_key_unique
  ON public.parent_notifications(institution_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

/* The browser may save answer content only while its own attempt is active.
   Grading, score, and publication writes go through SECURITY DEFINER RPCs. */
DROP POLICY IF EXISTS exam_attempts_update ON public.exam_attempts;
CREATE POLICY exam_attempts_update ON public.exam_attempts FOR UPDATE TO authenticated
USING (
  public.current_user_role() = 'student'
  AND status = 'in_progress'
  AND EXISTS (SELECT 1 FROM public.student_profiles sp WHERE sp.id = student_id AND sp.user_id = auth.uid())
)
WITH CHECK (
  public.current_user_role() = 'student'
  AND status = 'in_progress'
  AND is_result_published = false
  AND EXISTS (SELECT 1 FROM public.student_profiles sp WHERE sp.id = student_id AND sp.user_id = auth.uid())
);

DROP POLICY IF EXISTS answers_update ON public.answers;
CREATE POLICY answers_update ON public.answers FOR UPDATE TO authenticated
USING (
  public.current_user_role() = 'student'
  AND EXISTS (
    SELECT 1 FROM public.exam_attempts ea
    JOIN public.student_profiles sp ON sp.id = ea.student_id
    WHERE ea.id = attempt_id AND ea.status = 'in_progress' AND sp.user_id = auth.uid()
  )
)
WITH CHECK (
  public.current_user_role() = 'student'
  AND EXISTS (
    SELECT 1 FROM public.exam_attempts ea
    JOIN public.student_profiles sp ON sp.id = ea.student_id
    WHERE ea.id = attempt_id AND ea.status = 'in_progress' AND sp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS exam_attempts_select ON public.exam_attempts;
CREATE POLICY exam_attempts_select ON public.exam_attempts FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR public.teacher_can_access_exam(exam_id)
  OR EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_id AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'grader')
  )
  OR EXISTS (
    SELECT 1 FROM public.student_profiles sp
    WHERE sp.id = student_id AND sp.user_id = auth.uid()
      AND (status = 'in_progress' OR is_result_published = true)
  )
);

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

  SELECT * INTO attempt_row FROM public.exam_attempts WHERE exam_id = p_exam_id AND student_id = student_row.id AND status = 'in_progress' ORDER BY attempt_number DESC LIMIT 1;
  IF FOUND THEN RETURN attempt_row; END IF;
  SELECT count(*)::integer INTO next_number FROM public.exam_attempts WHERE exam_id = p_exam_id AND student_id = student_row.id AND status IN ('submitted', 'auto_submitted', 'graded', 'approved');
  IF next_number >= exam_row.max_attempts THEN RAISE EXCEPTION 'maximum_attempts_exceeded'; END IF;
  next_number := next_number + 1;
  INSERT INTO public.exam_attempts (exam_id, student_id, attempt_number, status) VALUES (p_exam_id, student_row.id, next_number, 'in_progress') RETURNING * INTO attempt_row;
  RETURN attempt_row;
END; $$;
REVOKE ALL ON FUNCTION public.start_exam_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid) TO authenticated;

/* Preserve the previous grading implementation behind an inaccessible name;
   this wrapper adds deadline and idempotency policy around it. */
ALTER FUNCTION public.submit_exam_attempt(uuid, jsonb, boolean, integer) RENAME TO submit_exam_attempt_legacy;
REVOKE ALL ON FUNCTION public.submit_exam_attempt_legacy(uuid, jsonb, boolean, integer) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.submit_exam_attempt(
  p_attempt_id uuid,
  p_answers jsonb DEFAULT '[]'::jsonb,
  p_auto boolean DEFAULT false,
  p_time_remaining_seconds integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  legacy_result jsonb;
  needs_manual boolean;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'student' THEN RAISE EXCEPTION 'student_required'; END IF;
  SELECT ea.* INTO attempt_row FROM public.exam_attempts ea JOIN public.student_profiles sp ON sp.id = ea.student_id WHERE ea.id = p_attempt_id AND sp.user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found_or_forbidden'; END IF;
  IF attempt_row.status <> 'in_progress' THEN
    RETURN jsonb_build_object('attempt_id', attempt_row.id, 'status', attempt_row.status, 'score', attempt_row.score, 'score_percentage', attempt_row.score_percentage, 'is_passed', attempt_row.is_passed, 'needs_manual_grading', attempt_row.status IN ('submitted', 'auto_submitted'), 'is_result_published', attempt_row.is_result_published);
  END IF;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id AND institution_id = public.current_user_institution_id() AND status = 'published';
  IF NOT FOUND OR NOT public.is_exam_assigned_to_current_student(attempt_row.exam_id) THEN RAISE EXCEPTION 'exam_not_available'; END IF;
  IF attempt_row.started_at + make_interval(mins => exam_row.duration_minutes) < now() AND NOT p_auto THEN RAISE EXCEPTION 'attempt_expired'; END IF;
  IF exam_row.end_at IS NOT NULL AND exam_row.end_at < now() AND NOT p_auto THEN RAISE EXCEPTION 'exam_window_closed'; END IF;

  legacy_result := public.submit_exam_attempt_legacy(p_attempt_id, p_answers, p_auto, p_time_remaining_seconds);
  needs_manual := coalesce((legacy_result->>'needs_manual_grading')::boolean, false);
  UPDATE public.exam_attempts
  SET status = CASE WHEN needs_manual THEN CASE WHEN p_auto THEN 'auto_submitted' ELSE 'submitted' END ELSE 'graded' END,
      is_result_published = false,
      approved_by = NULL,
      approved_at = NULL
  WHERE id = p_attempt_id;
  RETURN legacy_result || jsonb_build_object('status', CASE WHEN needs_manual THEN CASE WHEN p_auto THEN 'auto_submitted' ELSE 'submitted' END ELSE 'graded' END, 'is_result_published', false);
END; $$;
REVOKE ALL ON FUNCTION public.submit_exam_attempt(uuid, jsonb, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid, jsonb, boolean, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_manual_exam_grade(p_attempt_id uuid, p_score numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  pct numeric(5,2);
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN RAISE EXCEPTION 'grading_not_allowed'; END IF;
  SELECT ea.* INTO attempt_row FROM public.exam_attempts ea WHERE ea.id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id;
  IF NOT FOUND OR (public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id()) THEN RAISE EXCEPTION 'grading_institution_denied'; END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_can_access_exam(exam_row.id) THEN RAISE EXCEPTION 'grading_scope_denied'; END IF;
  IF attempt_row.status NOT IN ('submitted', 'auto_submitted', 'graded') OR attempt_row.is_result_published THEN RAISE EXCEPTION 'attempt_not_gradeable'; END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > exam_row.total_points THEN RAISE EXCEPTION 'invalid_score'; END IF;
  pct := CASE WHEN exam_row.total_points > 0 THEN round((p_score / exam_row.total_points) * 100, 2) ELSE 0 END;
  UPDATE public.exam_attempts SET score = p_score, score_percentage = pct, is_passed = pct >= exam_row.passing_score, status = 'graded', graded_by = auth.uid(), graded_at = now(), is_result_published = false WHERE id = p_attempt_id;
  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details) VALUES (exam_row.institution_id, auth.uid(), public.current_user_role(), 'manual_exam_grade_recorded', 'exam_attempt', p_attempt_id, jsonb_build_object('score', p_score, 'percentage', pct));
  RETURN jsonb_build_object('attempt_id', p_attempt_id, 'status', 'graded', 'score', p_score, 'score_percentage', pct, 'is_passed', pct >= exam_row.passing_score);
END; $$;
REVOKE ALL ON FUNCTION public.record_manual_exam_grade(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_manual_exam_grade(uuid, numeric) TO authenticated;

DROP FUNCTION IF EXISTS public.publish_exam_result(uuid);
CREATE OR REPLACE FUNCTION public.publish_exam_result(p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  event_row public.result_publication_events%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN RAISE EXCEPTION 'publication_not_allowed'; END IF;
  SELECT ea.* INTO attempt_row FROM public.exam_attempts ea WHERE ea.id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id;
  IF NOT FOUND OR (public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id()) THEN RAISE EXCEPTION 'publication_institution_denied'; END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_can_access_exam(exam_row.id) THEN RAISE EXCEPTION 'publication_scope_denied'; END IF;
  IF attempt_row.is_result_published THEN
    INSERT INTO public.result_publication_events (attempt_id, institution_id) VALUES (p_attempt_id, exam_row.institution_id) ON CONFLICT (attempt_id) DO NOTHING;
    SELECT * INTO event_row FROM public.result_publication_events WHERE attempt_id = p_attempt_id;
    RETURN jsonb_build_object('attempt_id', p_attempt_id, 'status', 'approved', 'is_result_published', true, 'publication_event_id', event_row.id);
  END IF;
  IF attempt_row.status <> 'graded' OR attempt_row.score IS NULL OR attempt_row.score < 0 OR attempt_row.score > exam_row.total_points THEN RAISE EXCEPTION 'result_not_ready_for_publication'; END IF;
  UPDATE public.exam_attempts SET status = 'approved', is_result_published = true, approved_by = auth.uid(), approved_at = now() WHERE id = p_attempt_id;
  INSERT INTO public.result_publication_events (attempt_id, institution_id) VALUES (p_attempt_id, exam_row.institution_id) ON CONFLICT (attempt_id) DO NOTHING;
  SELECT * INTO event_row FROM public.result_publication_events WHERE attempt_id = p_attempt_id;
  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details) VALUES (exam_row.institution_id, auth.uid(), public.current_user_role(), 'exam_result_published', 'exam_attempt', p_attempt_id, jsonb_build_object('score', attempt_row.score, 'event_id', event_row.id));
  RETURN jsonb_build_object('attempt_id', p_attempt_id, 'status', 'approved', 'is_result_published', true, 'publication_event_id', event_row.id);
END; $$;
REVOKE ALL ON FUNCTION public.publish_exam_result(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_exam_result(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unpublish_exam_result(p_attempt_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE attempt_row public.exam_attempts%ROWTYPE; exam_row public.examify_exams%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN RAISE EXCEPTION 'unpublish_not_allowed'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'unpublish_reason_required'; END IF;
  SELECT ea.* INTO attempt_row FROM public.exam_attempts ea WHERE ea.id = p_attempt_id FOR UPDATE;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id;
  IF NOT FOUND OR (public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id()) THEN RAISE EXCEPTION 'unpublish_institution_denied'; END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_can_access_exam(exam_row.id) THEN RAISE EXCEPTION 'unpublish_scope_denied'; END IF;
  IF NOT attempt_row.is_result_published THEN RETURN jsonb_build_object('attempt_id', p_attempt_id, 'is_result_published', false); END IF;
  UPDATE public.exam_attempts SET status = 'graded', is_result_published = false, approved_by = NULL, approved_at = NULL WHERE id = p_attempt_id;
  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details) VALUES (exam_row.institution_id, auth.uid(), public.current_user_role(), 'exam_result_unpublished', 'exam_attempt', p_attempt_id, jsonb_build_object('reason', trim(p_reason)));
  RETURN jsonb_build_object('attempt_id', p_attempt_id, 'is_result_published', false);
END; $$;
REVOKE ALL ON FUNCTION public.unpublish_exam_result(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unpublish_exam_result(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_exam(p_exam_id uuid)
RETURNS public.examify_exams LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE exam_row public.examify_exams%ROWTYPE; question_count integer;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher') THEN RAISE EXCEPTION 'exam_publish_not_allowed'; END IF;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = p_exam_id FOR UPDATE;
  IF NOT FOUND OR (public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id()) THEN RAISE EXCEPTION 'exam_publish_institution_denied'; END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_can_access_exam(p_exam_id) THEN RAISE EXCEPTION 'exam_publish_scope_denied'; END IF;
  SELECT count(*) INTO question_count FROM public.exam_questions WHERE exam_id = p_exam_id;
  IF exam_row.title IS NULL OR length(trim(exam_row.title)) = 0 OR exam_row.total_points <= 0 OR exam_row.passing_score < 0 OR exam_row.passing_score > exam_row.total_points OR exam_row.duration_minutes <= 0 OR question_count = 0 THEN RAISE EXCEPTION 'exam_not_ready_for_publication'; END IF;
  UPDATE public.examify_exams SET status = 'published', updated_at = now() WHERE id = p_exam_id RETURNING * INTO exam_row;
  RETURN exam_row;
END; $$;
REVOKE ALL ON FUNCTION public.publish_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_exam(uuid) TO authenticated;

/* Parent notification creation is now an outbox concern. Grade-book sync
   remains trigger-based, but direct parent notification inserts are removed. */
CREATE OR REPLACE FUNCTION public.sync_published_exam_result_to_grade_book()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE exam_row public.examify_exams%ROWTYPE;
BEGIN
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = NEW.exam_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.is_result_published IS NOT TRUE OR NEW.score IS NULL THEN
    DELETE FROM public.grade_book WHERE attempt_id = NEW.id;
    RETURN NEW;
  END IF;
  DELETE FROM public.grade_book WHERE attempt_id = NEW.id;
  INSERT INTO public.grade_book (institution_id, student_id, subject_id, exam_id, attempt_id, assessment_title, score, max_score, recorded_at)
  VALUES (exam_row.institution_id, NEW.student_id, exam_row.subject_id, NEW.exam_id, NEW.id, exam_row.title, NEW.score, exam_row.total_points, COALESCE(NEW.approved_at, NEW.graded_at, now()));
  RETURN NEW;
END; $$;

COMMIT;
