-- Phase 4 Step 3: OMR ambiguity is a first-class human-review state.
-- This migration is additive and keeps all existing tenant/RLS policies intact.

ALTER TABLE public.omr_results
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_omr_results_needs_review
  ON public.omr_results (institution_id, created_at DESC)
  WHERE needs_review = true;

-- Normalize worker output at the database boundary. A worker that omits the
-- flag cannot accidentally turn an ambiguous scan into an ordinary wrong
-- answer.
CREATE OR REPLACE FUNCTION public.normalize_omr_answer_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE normalized_reason text := lower(COALESCE(NEW.review_reason, ''));
BEGIN
  IF NEW.needs_manual_review
     OR (NEW.manual_override IS NULL AND (NEW.confidence < 0.75
       OR NEW.detected_answer IS NULL
       OR normalized_reason IN ('multiple', 'multiple_marks', 'ambiguous', 'unreadable', 'invalid'))) THEN
    NEW.needs_manual_review := true;
    NEW.is_correct := NULL;
    NEW.review_reason := CASE
      WHEN normalized_reason IN ('multiple', 'multiple_marks', 'ambiguous') THEN 'multiple_marks'
      WHEN NEW.detected_answer IS NULL THEN 'no_mark_detected'
      WHEN normalized_reason IN ('unreadable', 'invalid') THEN 'unreadable_mark'
      WHEN NEW.confidence < 0.75 THEN 'low_confidence'
      ELSE COALESCE(NEW.review_reason, 'ambiguous_mark')
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_omr_answer_review ON public.omr_answers;
CREATE TRIGGER trg_normalize_omr_answer_review
BEFORE INSERT OR UPDATE OF detected_answer, confidence, needs_manual_review, review_reason ON public.omr_answers
FOR EACH ROW EXECUTE FUNCTION public.normalize_omr_answer_review();

-- Keep the result-level queue synchronized with the per-question truth written by
-- the asynchronous OMR worker (and by the review RPC below).
CREATE OR REPLACE FUNCTION public.sync_omr_review_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE result_id uuid := COALESCE(NEW.omr_result_id, OLD.omr_result_id);
DECLARE flagged boolean;
DECLARE reason text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.omr_answers
    WHERE omr_result_id = result_id AND needs_manual_review = true
  ), (
    SELECT oa.review_reason FROM public.omr_answers oa
    WHERE oa.omr_result_id = result_id AND oa.needs_manual_review = true
    ORDER BY oa.question_number LIMIT 1
  ) INTO flagged, reason;

  UPDATE public.omr_results
  SET needs_review = flagged,
      review_reason = reason,
      resolved_by = CASE WHEN flagged THEN NULL ELSE resolved_by END,
      status = CASE WHEN flagged THEN 'needs_review' ELSE status END
  WHERE id = result_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_omr_review_state ON public.omr_answers;
CREATE TRIGGER trg_sync_omr_review_state
AFTER INSERT OR UPDATE OF needs_manual_review, review_reason OR DELETE ON public.omr_answers
FOR EACH ROW EXECUTE FUNCTION public.sync_omr_review_state();

-- Resolve exactly one ambiguous answer. The RPC performs the staff role and
-- institution checks inside the database; the client never writes review truth
-- directly and cannot resolve another institution's answer by guessing an ID.
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
DECLARE actor_role text := public.current_user_role();
DECLARE answer_row public.omr_answers%ROWTYPE;
DECLARE result_row public.omr_results%ROWTYPE;
DECLARE v_option_id uuid;
DECLARE next_correct boolean;
DECLARE next_needs_review boolean;
DECLARE next_reason text;
DECLARE next_score integer;
DECLARE next_correct_count integer;
DECLARE next_wrong_count integer;
DECLARE next_empty_count integer;
DECLARE reviewer_id uuid;
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'omr_review_not_allowed';
  END IF;
  IF p_manual_answer IS NULL OR lower(trim(p_manual_answer)) NOT IN ('a','b','c','d') THEN
    RAISE EXCEPTION 'omr_manual_answer_invalid';
  END IF;

  SELECT oa.* INTO answer_row
  FROM public.omr_answers oa
  WHERE oa.id = p_omr_answer_id FOR UPDATE;
  IF answer_row.id IS NULL THEN RAISE EXCEPTION 'omr_answer_not_found'; END IF;

  SELECT r.* INTO result_row
  FROM public.omr_results r
  WHERE r.id = answer_row.omr_result_id FOR UPDATE;
  IF result_row.id IS NULL THEN RAISE EXCEPTION 'omr_result_not_found'; END IF;
  IF actor_role <> 'super_admin' AND result_row.institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'omr_result_institution_denied';
  END IF;

  SELECT qo.id INTO v_option_id
  FROM public.question_options qo
  WHERE qo.question_id = answer_row.question_id
    AND upper(qo.label) = upper(trim(p_manual_answer))
  LIMIT 1;
  IF v_option_id IS NULL THEN RAISE EXCEPTION 'omr_option_not_found'; END IF;

  next_correct := upper(trim(p_manual_answer)) = upper(COALESCE(answer_row.correct_answer, ''));
  UPDATE public.omr_answers
  SET option_id = v_option_id,
      manual_override = upper(trim(p_manual_answer)),
      is_correct = next_correct,
      needs_manual_review = false,
      review_reason = NULL,
      manually_reviewed_at = now()
  WHERE id = answer_row.id;

  SELECT sp.id INTO reviewer_id FROM public.staff_profiles sp
  WHERE sp.user_id = auth.uid() AND sp.is_active = true LIMIT 1;
  SELECT EXISTS (SELECT 1 FROM public.omr_answers WHERE omr_result_id = result_row.id AND needs_manual_review),
         (SELECT oa.review_reason FROM public.omr_answers oa WHERE oa.omr_result_id = result_row.id AND oa.needs_manual_review ORDER BY oa.question_number LIMIT 1),
         COALESCE((SELECT count(*) FROM public.omr_answers WHERE omr_result_id = result_row.id AND is_correct), 0)::integer,
         COALESCE((SELECT count(*) FROM public.omr_answers WHERE omr_result_id = result_row.id AND is_correct = false AND COALESCE(manual_override, detected_answer) IS NOT NULL), 0)::integer,
         COALESCE((SELECT count(*) FROM public.omr_answers WHERE omr_result_id = result_row.id AND COALESCE(manual_override, detected_answer) IS NULL), 0)::integer
    INTO next_needs_review, next_reason, next_correct_count, next_wrong_count, next_empty_count;
  next_score := next_correct_count;
  UPDATE public.omr_results r SET
    needs_review = next_needs_review,
    review_reason = next_reason,
    resolved_by = CASE WHEN next_needs_review THEN NULL ELSE reviewer_id END,
    score = next_score, correct_count = next_correct_count,
    wrong_count = next_wrong_count, empty_count = next_empty_count,
    status = CASE WHEN next_needs_review THEN 'needs_review' ELSE 'processed' END
  WHERE r.id = result_row.id;

  RETURN QUERY SELECT result_row.id, next_needs_review, next_score,
    next_correct_count, next_wrong_count, next_empty_count, next_reason;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_omr_answer(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_omr_answer(uuid, text) TO authenticated;
