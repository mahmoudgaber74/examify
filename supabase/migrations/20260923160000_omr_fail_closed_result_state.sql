-- Keep the persisted OMR result fail-closed at the database boundary.
--
-- The worker writes answer rows first and then writes the result summary. A
-- trigger on omr_answers already raises the review flag, but a later summary
-- UPDATE could previously overwrite that flag with `completed`. Never allow
-- a result with unresolved answer rows (or no answer rows at all) to look
-- processable/approved.

CREATE OR REPLACE FUNCTION public.enforce_omr_result_review_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  has_pending_review boolean;
  has_answers boolean;
  pending_reason text;
BEGIN
  SELECT EXISTS (
           SELECT 1
           FROM public.omr_answers oa
           WHERE oa.omr_result_id = NEW.id
             AND oa.needs_manual_review = true
         ),
         EXISTS (
           SELECT 1
           FROM public.omr_answers oa
           WHERE oa.omr_result_id = NEW.id
         ),
         (
           SELECT NULLIF(oa.review_reason, '')
           FROM public.omr_answers oa
           WHERE oa.omr_result_id = NEW.id
             AND oa.needs_manual_review = true
           ORDER BY oa.question_number
           LIMIT 1
         )
    INTO has_pending_review, has_answers, pending_reason;

  IF has_pending_review THEN
    NEW.needs_review := true;
    NEW.status := 'needs_review';
    NEW.review_reason := COALESCE(
      NULLIF(NEW.review_reason, ''),
      pending_reason,
      'processing_review_required'
    );
  -- `processed` is also used by the legacy browser fallback before its
  -- answer rows are inserted. Only the terminal worker status is checked
  -- here so that fallback flow is not falsely flagged during its transaction.
  ELSIF NEW.status = 'completed' AND NOT has_answers THEN
    NEW.needs_review := true;
    NEW.status := 'needs_review';
    NEW.review_reason := COALESCE(NULLIF(NEW.review_reason, ''), 'omr_answers_missing');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_omr_result_review_state ON public.omr_results;
CREATE TRIGGER trg_enforce_omr_result_review_state
BEFORE INSERT OR UPDATE OF status, needs_review, review_reason
ON public.omr_results
FOR EACH ROW
EXECUTE FUNCTION public.enforce_omr_result_review_state();

REVOKE ALL ON FUNCTION public.enforce_omr_result_review_state() FROM PUBLIC, anon, authenticated;

-- Review values must follow the actual option labels in the finalized exam.
-- The old RPC accepted only A-D, which made valid E-H sheets impossible to
-- resolve manually even though the OMR contract supports up to eight options.
CREATE OR REPLACE FUNCTION public.resolve_omr_answer(
  p_omr_answer_id uuid,
  p_manual_answer text
)
RETURNS TABLE (
  omr_result_id uuid,
  needs_review boolean,
  score integer,
  correct_count integer,
  wrong_count integer,
  empty_count integer,
  review_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  answer_row public.omr_answers%ROWTYPE;
  result_row public.omr_results%ROWTYPE;
  selected_option_id uuid;
  selected_label text;
  next_correct boolean;
  next_needs_review boolean;
  next_reason text;
  next_correct_count integer;
  next_wrong_count integer;
  next_empty_count integer;
  reviewer_id uuid;
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'omr_review_not_allowed';
  END IF;

  SELECT oa.* INTO answer_row
  FROM public.omr_answers oa
  WHERE oa.id = p_omr_answer_id
  FOR UPDATE;
  IF answer_row.id IS NULL THEN
    RAISE EXCEPTION 'omr_answer_not_found';
  END IF;

  SELECT r.* INTO result_row
  FROM public.omr_results r
  WHERE r.id = answer_row.omr_result_id
  FOR UPDATE;
  IF result_row.id IS NULL THEN
    RAISE EXCEPTION 'omr_result_not_found';
  END IF;
  IF actor_role <> 'super_admin'
     AND result_row.institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'omr_result_institution_denied';
  END IF;

  IF p_manual_answer IS NULL OR btrim(p_manual_answer) = '' OR length(btrim(p_manual_answer)) > 120 THEN
    RAISE EXCEPTION 'omr_manual_answer_invalid';
  END IF;

  SELECT qo.id, qo.label
  INTO selected_option_id, selected_label
  FROM public.question_options qo
  WHERE qo.question_id = answer_row.question_id
    AND upper(btrim(qo.label)) = upper(btrim(p_manual_answer))
  ORDER BY qo.sort_order, qo.id
  LIMIT 1;
  IF selected_option_id IS NULL THEN
    RAISE EXCEPTION 'omr_option_not_found';
  END IF;

  SELECT COALESCE(qo.is_correct, false)
  INTO next_correct
  FROM public.question_options qo
  WHERE qo.id = selected_option_id;

  UPDATE public.omr_answers
  SET option_id = selected_option_id,
      manual_override = selected_label,
      is_correct = next_correct,
      needs_manual_review = false,
      review_reason = NULL,
      manually_reviewed_at = now()
  WHERE id = answer_row.id;

  SELECT sp.id INTO reviewer_id
  FROM public.staff_profiles sp
  WHERE sp.user_id = auth.uid() AND sp.is_active = true
  LIMIT 1;

  SELECT EXISTS (
           SELECT 1 FROM public.omr_answers oa
           WHERE oa.omr_result_id = result_row.id AND oa.needs_manual_review
         ),
         (
           SELECT oa.review_reason FROM public.omr_answers oa
           WHERE oa.omr_result_id = result_row.id AND oa.needs_manual_review
           ORDER BY oa.question_number LIMIT 1
         ),
         COALESCE((SELECT count(*) FROM public.omr_answers oa
                   WHERE oa.omr_result_id = result_row.id AND oa.is_correct), 0)::integer,
         COALESCE((SELECT count(*) FROM public.omr_answers oa
                   WHERE oa.omr_result_id = result_row.id
                     AND oa.is_correct = false
                     AND COALESCE(oa.manual_override, oa.detected_answer) IS NOT NULL), 0)::integer,
         COALESCE((SELECT count(*) FROM public.omr_answers oa
                   WHERE oa.omr_result_id = result_row.id
                     AND COALESCE(oa.manual_override, oa.detected_answer) IS NULL), 0)::integer
  INTO next_needs_review, next_reason, next_correct_count, next_wrong_count, next_empty_count;

  UPDATE public.omr_results r
  SET needs_review = next_needs_review,
      review_reason = next_reason,
      resolved_by = CASE WHEN next_needs_review THEN NULL ELSE reviewer_id END,
      score = next_correct_count,
      correct_count = next_correct_count,
      wrong_count = next_wrong_count,
      empty_count = next_empty_count,
      status = CASE WHEN next_needs_review THEN 'needs_review' ELSE 'processed' END
  WHERE r.id = result_row.id;

  RETURN QUERY
  SELECT result_row.id, next_needs_review, next_correct_count,
    next_correct_count, next_wrong_count, next_empty_count, next_reason;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_omr_answer(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_omr_answer(uuid, text) TO authenticated;
