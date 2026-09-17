/*
  Expose only attempt-consumption metadata to the owning student.
  Detailed exam_attempts rows remain protected by exam_attempts_select.
*/
BEGIN;

CREATE OR REPLACE FUNCTION public.get_student_exam_attempt_summary(p_exam_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  student_row public.student_profiles%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  attempts_used integer;
  latest_attempt public.exam_attempts%ROWTYPE;
  in_progress_attempt public.exam_attempts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'student' THEN
    RAISE EXCEPTION 'student_required';
  END IF;

  SELECT *
  INTO student_row
  FROM public.student_profiles
  WHERE user_id = auth.uid()
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'student_profile_not_found';
  END IF;

  SELECT *
  INTO exam_row
  FROM public.examify_exams
  WHERE id = p_exam_id
    AND institution_id = student_row.institution_id
    AND status = 'published';

  IF NOT FOUND OR NOT public.is_exam_assigned_to_current_student(p_exam_id) THEN
    RAISE EXCEPTION 'exam_not_available';
  END IF;

  SELECT count(*)::integer
  INTO attempts_used
  FROM public.exam_attempts
  WHERE exam_id = p_exam_id
    AND student_id = student_row.id
    AND status IN ('submitted', 'auto_submitted', 'graded', 'approved');

  SELECT *
  INTO latest_attempt
  FROM public.exam_attempts
  WHERE exam_id = p_exam_id
    AND student_id = student_row.id
  ORDER BY attempt_number DESC, started_at DESC
  LIMIT 1;

  SELECT *
  INTO in_progress_attempt
  FROM public.exam_attempts
  WHERE exam_id = p_exam_id
    AND student_id = student_row.id
    AND status = 'in_progress'
  ORDER BY attempt_number DESC, started_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'attempts_used', attempts_used,
    'max_attempts', exam_row.max_attempts,
    'attempts_remaining', GREATEST(exam_row.max_attempts - attempts_used, 0),
    'has_in_progress', EXISTS (
      SELECT 1
      FROM public.exam_attempts ea
      WHERE ea.exam_id = p_exam_id
        AND ea.student_id = student_row.id
        AND ea.status = 'in_progress'
    ),
    /* An ID is returned only for a resumable, currently visible attempt. */
    'latest_attempt_id', in_progress_attempt.id,
    'latest_status', latest_attempt.status,
    'is_result_published', COALESCE(latest_attempt.is_result_published, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_exam_attempt_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_exam_attempt_summary(uuid) TO authenticated;

COMMIT;
