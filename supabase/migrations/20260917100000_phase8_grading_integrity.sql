/* Phase 8: keep machine assistance, OMR approval, and certificates inside the
   same authoritative academic chain. */
BEGIN;

/* AI suggestions are accepted only for an answer in a gradeable, unpublished
   attempt. The question and its maximum are always read from the exam. */
CREATE OR REPLACE FUNCTION public.record_ai_answer_suggestion(p_answer_id uuid, p_suggested_score numeric, p_feedback text)
RETURNS public.answers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE answer_row public.answers%ROWTYPE; attempt_row public.exam_attempts%ROWTYPE; exam_row public.examify_exams%ROWTYPE; max_points numeric;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin','school_admin','teacher','grader') THEN RAISE EXCEPTION 'ai_suggestion_not_allowed'; END IF;
  IF p_feedback IS NULL OR length(trim(p_feedback)) = 0 THEN RAISE EXCEPTION 'ai_feedback_required'; END IF;
  SELECT * INTO answer_row FROM public.answers WHERE id = p_answer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'answer_not_found'; END IF;
  SELECT * INTO attempt_row FROM public.exam_attempts WHERE id = answer_row.attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_not_found'; END IF;
  IF public.current_user_role() <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id() THEN RAISE EXCEPTION 'grading_institution_denied'; END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_can_access_exam(exam_row.id) THEN RAISE EXCEPTION 'grading_scope_denied'; END IF;
  IF attempt_row.status NOT IN ('submitted','auto_submitted','graded') OR attempt_row.is_result_published THEN RAISE EXCEPTION 'attempt_not_gradeable'; END IF;
  SELECT eq.points INTO max_points FROM public.exam_questions eq WHERE eq.exam_id = attempt_row.exam_id AND eq.question_id = answer_row.question_id;
  IF max_points IS NULL OR p_suggested_score IS NULL OR p_suggested_score < 0 OR p_suggested_score > max_points THEN RAISE EXCEPTION 'invalid_ai_suggested_score'; END IF;
  UPDATE public.answers SET ai_suggested_score = p_suggested_score, ai_feedback = trim(p_feedback), is_teacher_approved = false, updated_at = now() WHERE id = p_answer_id;
  SELECT * INTO answer_row FROM public.answers WHERE id = p_answer_id;
  RETURN answer_row;
END; $$;

CREATE OR REPLACE FUNCTION public.approve_ai_answer_score(p_answer_id uuid, p_final_score numeric, p_review_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE answer_row public.answers%ROWTYPE; attempt_row public.exam_attempts%ROWTYPE; exam_row public.examify_exams%ROWTYPE; max_points numeric; total_score numeric; total_points numeric; percentage numeric;
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
  UPDATE public.answers SET awarded_points = p_final_score, is_correct = p_final_score >= max_points, grader_notes = concat('AI suggestion: ', COALESCE(answer_row.ai_feedback, ''), E'
Teacher review: ', trim(p_review_reason)), graded_by = auth.uid(), graded_at = now(), is_teacher_approved = true, updated_at = now() WHERE id = p_answer_id;
  SELECT COALESCE(sum(COALESCE(a.awarded_points, 0)), 0), COALESCE(sum(eq.points), exam_row.total_points) INTO total_score, total_points FROM public.exam_questions eq LEFT JOIN public.answers a ON a.attempt_id = attempt_row.id AND a.question_id = eq.question_id WHERE eq.exam_id = attempt_row.exam_id;
  percentage := CASE WHEN total_points > 0 THEN round((total_score / total_points) * 100, 2) ELSE 0 END;
  UPDATE public.exam_attempts SET status = 'graded', score = total_score, score_percentage = percentage, is_passed = CASE WHEN EXISTS (SELECT 1 FROM public.exam_questions eq JOIN public.questions q ON q.id = eq.question_id WHERE eq.exam_id = attempt_row.exam_id AND q.type NOT IN ('multiple_choice','true_false','fill_blank','matching','ordering') AND NOT EXISTS (SELECT 1 FROM public.answers ax WHERE ax.attempt_id = attempt_row.id AND ax.question_id = eq.question_id AND ax.is_teacher_approved)) THEN NULL ELSE percentage >= exam_row.passing_score END, graded_by = auth.uid(), graded_at = now(), is_result_published = false WHERE id = attempt_row.id;
  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details) VALUES (exam_row.institution_id, auth.uid(), public.current_user_role(), 'ai_answer_teacher_approved', 'answer', p_answer_id, jsonb_build_object('final_score', p_final_score, 'reason', trim(p_review_reason)));
  RETURN jsonb_build_object('status','approved','answer_id',p_answer_id,'attempt_id',attempt_row.id,'score',total_score,'score_percentage',percentage);
END; $$;

REVOKE ALL ON FUNCTION public.record_ai_answer_suggestion(uuid,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_ai_answer_score(uuid,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ai_answer_suggestion(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_ai_answer_score(uuid,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_certificate_for_exam(p_student_id uuid, p_exam_id uuid, p_issuer text)
RETURNS public.certificates LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result public.certificates%ROWTYPE; student public.student_profiles%ROWTYPE; exam public.examify_exams%ROWTYPE; attempt public.exam_attempts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin','school_admin','teacher') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO student FROM public.student_profiles WHERE id = p_student_id AND institution_id = public.current_user_institution_id() AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'student_not_found'; END IF;
  SELECT * INTO exam FROM public.examify_exams WHERE id = p_exam_id AND institution_id = student.institution_id AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_not_found'; END IF;
  IF public.current_user_role() = 'teacher' AND NOT public.teacher_can_access_exam(exam.id) THEN RAISE EXCEPTION 'certificate_scope_denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(student.id::text || ':' || exam.id::text));
  SELECT * INTO result FROM public.certificates WHERE student_id = student.id AND achievement_exam_id = exam.id LIMIT 1;
  IF FOUND THEN RETURN result; END IF;
  SELECT * INTO attempt FROM public.exam_attempts WHERE student_id = student.id AND exam_id = exam.id AND status IN ('graded','approved') AND is_passed = true AND is_result_published = true ORDER BY score_percentage DESC NULLS LAST, submitted_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'achievement_not_verified'; END IF;
  INSERT INTO public.certificates (recipient, program, issuer, issued_date, issued_at, credential_id, verified_method, score, institution_id, issued_to_user_id, issued_by, student_id, achievement_exam_id, status)
  VALUES (student.full_name, exam.title, 'Examify', CURRENT_DATE, now(), 'EXM-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 20)), 'Verified Certificate Record', round(attempt.score_percentage), student.institution_id, student.user_id, auth.uid(), student.id, exam.id, 'active')
  RETURNING * INTO result;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.issue_certificate_for_exam(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_certificate_for_exam(uuid,uuid,text) TO authenticated;

/* Correct the existing review RPC's ambiguous output-column references. */
CREATE OR REPLACE FUNCTION public.resolve_omr_answer(p_omr_answer_id uuid, p_manual_answer text)
RETURNS TABLE (omr_result_id uuid, needs_review boolean, score integer, correct_count integer, wrong_count integer, empty_count integer, review_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_role text := public.current_user_role(); answer_row public.omr_answers%ROWTYPE; result_row public.omr_results%ROWTYPE; v_option_id uuid; next_correct boolean; next_needs_review boolean; next_reason text; next_score integer; next_correct_count integer; next_wrong_count integer; next_empty_count integer; reviewer_id uuid;
BEGIN
  IF actor_role NOT IN ('super_admin','school_admin','teacher','grader') THEN RAISE EXCEPTION 'omr_review_not_allowed'; END IF;
  IF p_manual_answer IS NULL OR lower(trim(p_manual_answer)) NOT IN ('a','b','c','d') THEN RAISE EXCEPTION 'omr_manual_answer_invalid'; END IF;
  SELECT oa.* INTO answer_row FROM public.omr_answers oa WHERE oa.id = p_omr_answer_id FOR UPDATE;
  IF answer_row.id IS NULL THEN RAISE EXCEPTION 'omr_answer_not_found'; END IF;
  SELECT r.* INTO result_row FROM public.omr_results r WHERE r.id = answer_row.omr_result_id FOR UPDATE;
  IF result_row.id IS NULL THEN RAISE EXCEPTION 'omr_result_not_found'; END IF;
  IF actor_role <> 'super_admin' AND result_row.institution_id <> public.current_user_institution_id() THEN RAISE EXCEPTION 'omr_result_institution_denied'; END IF;
  SELECT qo.id INTO v_option_id FROM public.question_options qo WHERE qo.question_id = answer_row.question_id AND upper(qo.label) = upper(trim(p_manual_answer)) LIMIT 1;
  IF v_option_id IS NULL THEN RAISE EXCEPTION 'omr_option_not_found'; END IF;
  next_correct := upper(trim(p_manual_answer)) = upper(COALESCE(answer_row.correct_answer, ''));
  UPDATE public.omr_answers SET option_id = v_option_id, manual_override = upper(trim(p_manual_answer)), is_correct = next_correct, needs_manual_review = false, review_reason = NULL, manually_reviewed_at = now() WHERE id = answer_row.id;
  SELECT sp.id INTO reviewer_id FROM public.staff_profiles sp WHERE sp.user_id = auth.uid() AND sp.is_active = true LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.omr_answers oa WHERE oa.omr_result_id = result_row.id AND oa.needs_manual_review),
         (SELECT oa.review_reason FROM public.omr_answers oa WHERE oa.omr_result_id = result_row.id AND oa.needs_manual_review ORDER BY oa.question_number LIMIT 1),
         COALESCE((SELECT count(*) FROM public.omr_answers oa WHERE oa.omr_result_id = result_row.id AND oa.is_correct), 0)::integer,
         COALESCE((SELECT count(*) FROM public.omr_answers oa WHERE oa.omr_result_id = result_row.id AND oa.is_correct = false AND COALESCE(oa.manual_override, oa.detected_answer) IS NOT NULL), 0)::integer,
         COALESCE((SELECT count(*) FROM public.omr_answers oa WHERE oa.omr_result_id = result_row.id AND COALESCE(oa.manual_override, oa.detected_answer) IS NULL), 0)::integer
    INTO next_needs_review, next_reason, next_correct_count, next_wrong_count, next_empty_count;
  next_score := next_correct_count;
  UPDATE public.omr_results r SET needs_review = next_needs_review, review_reason = next_reason, resolved_by = CASE WHEN next_needs_review THEN NULL ELSE reviewer_id END, score = next_score, correct_count = next_correct_count, wrong_count = next_wrong_count, empty_count = next_empty_count, status = CASE WHEN next_needs_review THEN 'needs_review' ELSE 'processed' END WHERE r.id = result_row.id;
  RETURN QUERY SELECT result_row.id, next_needs_review, next_score, next_correct_count, next_wrong_count, next_empty_count, next_reason;
END; $$;
REVOKE ALL ON FUNCTION public.resolve_omr_answer(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_omr_answer(uuid,text) TO authenticated;

/* OMR approval is idempotent and a partially manual attempt cannot be marked
   passed. The existing approval function remains the implementation delegate. */
CREATE OR REPLACE FUNCTION public.approve_omr_result_idempotent(p_omr_result_id uuid, p_student_profile_id uuid DEFAULT NULL)
RETURNS TABLE (omr_result_id uuid, exam_attempt_id uuid, score numeric, total_points numeric, score_percentage numeric, is_passed boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result_row public.omr_results%ROWTYPE; attempt_row public.exam_attempts%ROWTYPE;
BEGIN
  SELECT * INTO result_row FROM public.omr_results WHERE id = p_omr_result_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'omr_result_not_found'; END IF;
  IF public.current_user_role() NOT IN ('super_admin','school_admin','teacher','grader') THEN RAISE EXCEPTION 'omr_review_not_allowed'; END IF;
  IF public.current_user_role() <> 'super_admin' AND result_row.institution_id <> public.current_user_institution_id() THEN RAISE EXCEPTION 'omr_result_institution_denied'; END IF;
  IF result_row.status = 'approved' AND result_row.exam_attempt_id IS NOT NULL THEN
    SELECT * INTO attempt_row FROM public.exam_attempts WHERE id = result_row.exam_attempt_id;
    RETURN QUERY SELECT result_row.id, attempt_row.id, attempt_row.score, (SELECT e.total_points FROM public.examify_exams e WHERE e.id = result_row.exam_id), attempt_row.score_percentage, attempt_row.is_passed, 'approved'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.approve_omr_result(p_omr_result_id, p_student_profile_id);
END; $$;
REVOKE ALL ON FUNCTION public.approve_omr_result(uuid,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.approve_omr_result_idempotent(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_omr_result_idempotent(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.normalize_nonfinal_exam_pass_flag()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IN ('submitted','auto_submitted') AND NEW.is_result_published = false THEN NEW.is_passed := NULL; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_normalize_nonfinal_exam_pass_flag ON public.exam_attempts;
CREATE TRIGGER trg_normalize_nonfinal_exam_pass_flag BEFORE INSERT OR UPDATE ON public.exam_attempts FOR EACH ROW EXECUTE FUNCTION public.normalize_nonfinal_exam_pass_flag();

/* Public verification returns a minimum disclosure record and never exposes
   the certificates table through an anonymous SELECT policy. */
CREATE OR REPLACE FUNCTION public.verify_certificate(p_credential_id text)
RETURNS TABLE (verification_status text, credential_id text, recipient text, program text, issuer text, issued_date date, certificate_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY SELECT CASE WHEN c.status = 'revoked' THEN 'REVOKED' ELSE 'VALID' END, c.credential_id, c.recipient, c.program, c.issuer, c.issued_date, c.status FROM public.certificates c WHERE c.credential_id = trim(p_credential_id) LIMIT 1;
  IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::date, NULL::text; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.verify_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(text) TO anon, authenticated;

COMMIT;
