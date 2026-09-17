/* Phase 8.5: serialize concurrent approval requests for one OMR result. */
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_omr_result_idempotent(
  p_omr_result_id uuid,
  p_student_profile_id uuid DEFAULT NULL
)
RETURNS TABLE (
  omr_result_id uuid,
  exam_attempt_id uuid,
  score numeric,
  total_points numeric,
  score_percentage numeric,
  is_passed boolean,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result_row public.omr_results%ROWTYPE;
  attempt_row public.exam_attempts%ROWTYPE;
BEGIN
  IF p_omr_result_id IS NULL THEN
    RAISE EXCEPTION 'omr_result_required';
  END IF;

  /* The row lock alone did not make the observed two-request path converge
     reliably. This transaction-scoped lock serializes the wrapper and its
     delegated approval for the same logical OMR result. */
  PERFORM pg_advisory_xact_lock(hashtextextended(p_omr_result_id::text, 0));

  SELECT * INTO result_row
  FROM public.omr_results
  WHERE id = p_omr_result_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'omr_result_not_found'; END IF;
  IF public.current_user_role() NOT IN ('super_admin','school_admin','teacher','grader') THEN RAISE EXCEPTION 'omr_review_not_allowed'; END IF;
  IF public.current_user_role() <> 'super_admin' AND result_row.institution_id <> public.current_user_institution_id() THEN RAISE EXCEPTION 'omr_result_institution_denied'; END IF;
  IF result_row.status = 'approved' AND result_row.exam_attempt_id IS NOT NULL THEN
    SELECT * INTO attempt_row FROM public.exam_attempts WHERE id = result_row.exam_attempt_id;
    RETURN QUERY SELECT result_row.id, attempt_row.id, attempt_row.score, (SELECT e.total_points FROM public.examify_exams e WHERE e.id = result_row.exam_id), attempt_row.score_percentage, attempt_row.is_passed, 'approved'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.approve_omr_result(p_omr_result_id, p_student_profile_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_omr_result_idempotent(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_omr_result_idempotent(uuid,uuid) TO authenticated;

COMMIT;
