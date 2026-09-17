-- Keep asynchronous OpenCV result metadata aligned with the worker outcome.
-- Detection, scoring, and answer-count semantics are intentionally unchanged.

CREATE OR REPLACE FUNCTION public.worker_complete_omr_processing_job(
  p_job_id uuid, p_worker_id text, p_status text, p_engine_version text,
  p_processing_time_ms integer, p_document_confidence numeric, p_warnings jsonb,
  p_annotated_storage_path text, p_questions jsonb
)
RETURNS public.omr_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  j public.omr_processing_jobs%ROWTYPE;
  item jsonb;
  result_status text;
  result_review_reason text;
  qid uuid;
  oid uuid;
  correct boolean;
  correct_label text;
  detected text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'omr_worker_only';
  END IF;

  SELECT * INTO j
  FROM public.omr_processing_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF j.id IS NULL OR j.status <> 'processing' OR j.locked_by <> p_worker_id THEN
    RAISE EXCEPTION 'omr_job_lock_denied';
  END IF;

  result_status := CASE
    WHEN p_status IN ('completed', 'needs_review') THEN p_status
    ELSE 'failed'
  END;

  IF result_status = 'needs_review' THEN
    result_review_reason := NULLIF(COALESCE(p_warnings, '[]'::jsonb)->>0, '');

    IF result_review_reason IS NULL THEN
      SELECT NULLIF(question.value->>'status', '')
      INTO result_review_reason
      FROM jsonb_array_elements(COALESCE(p_questions, '[]'::jsonb))
        WITH ORDINALITY AS question(value, ordinal)
      WHERE question.value->>'needs_manual_review' = 'true'
         OR question.value->>'status' IN (
           'blank', 'multiple_marks', 'low_confidence', 'unreadable', 'needs_review'
         )
      ORDER BY question.ordinal
      LIMIT 1;
    END IF;

    result_review_reason := COALESCE(result_review_reason, 'processing_review_required');
  END IF;

  UPDATE public.omr_results
  SET engine = 'opencv',
      engine_version = p_engine_version,
      document_confidence = p_document_confidence,
      processing_time_ms = p_processing_time_ms,
      annotated_storage_path = p_annotated_storage_path,
      processed_storage_path = p_annotated_storage_path,
      warnings = COALESCE(p_warnings, '[]'::jsonb),
      processing_metadata = jsonb_build_object(
        'engine', 'opencv',
        'engine_version', p_engine_version,
        'processing_time_ms', p_processing_time_ms,
        'warnings', COALESCE(p_warnings, '[]'::jsonb)
      )
  WHERE id = j.scan_id;

  DELETE FROM public.omr_answers
  WHERE omr_result_id = j.scan_id;

  FOR item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_questions, '[]'::jsonb))
  LOOP
    detected := item->>'detected_option';

    SELECT eq.question_id INTO qid
    FROM public.exam_questions eq
    JOIN public.omr_results r ON r.exam_id = eq.exam_id
    WHERE r.id = j.scan_id
    ORDER BY eq.sort_order, eq.id
    OFFSET ((item->>'question_number')::integer - 1)
    LIMIT 1;

    SELECT qo.id, qo.is_correct INTO oid, correct
    FROM public.question_options qo
    WHERE qo.question_id = qid
      AND qo.label = detected
    LIMIT 1;

    SELECT qo.label INTO correct_label
    FROM public.question_options qo
    WHERE qo.question_id = qid
      AND qo.is_correct = true
    LIMIT 1;

    INSERT INTO public.omr_answers(
      omr_result_id, question_number, question_id, option_id,
      detected_answer, correct_answer, is_correct, confidence,
      needs_manual_review, review_reason, fill_ratios
    )
    VALUES(
      j.scan_id,
      (item->>'question_number')::integer,
      qid,
      oid,
      detected,
      correct_label,
      CASE WHEN detected IS NULL THEN NULL ELSE COALESCE(correct, false) END,
      COALESCE((item->>'confidence')::numeric, 0),
      COALESCE((item->>'needs_manual_review')::boolean, false),
      item->>'status',
      COALESCE(item->'fill_scores', '{}'::jsonb)
    );
  END LOOP;

  -- This is deliberately the final omr_results write. Answer synchronization
  -- triggers run above and cannot leave the result-level state contradictory.
  UPDATE public.omr_results r
  SET total_questions = (
        SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id = r.id
      ),
      correct_count = (
        SELECT count(*) FROM public.omr_answers a
        WHERE a.omr_result_id = r.id AND a.is_correct = true
      ),
      wrong_count = (
        SELECT count(*) FROM public.omr_answers a
        WHERE a.omr_result_id = r.id
          AND a.is_correct = false
          AND a.detected_answer IS NOT NULL
      ),
      empty_count = (
        SELECT count(*) FROM public.omr_answers a
        WHERE a.omr_result_id = r.id AND a.detected_answer IS NULL
      ),
      score = (
        SELECT count(*) FROM public.omr_answers a
        WHERE a.omr_result_id = r.id AND a.is_correct = true
      ),
      status = result_status,
      needs_review = (result_status = 'needs_review'),
      review_reason = CASE
        WHEN result_status = 'needs_review' THEN result_review_reason
        ELSE NULL
      END
  WHERE r.id = j.scan_id;

  UPDATE public.omr_processing_jobs
  SET status = result_status,
      engine_version = p_engine_version,
      processing_time_ms = p_processing_time_ms,
      completed_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      heartbeat_at = NULL,
      error_code = NULL,
      error_message_safe = NULL,
      updated_at = now()
  WHERE id = j.id
  RETURNING * INTO j;

  PERFORM public.omr_job_audit(
    p_job_id,
    'omr_job_completed',
    jsonb_build_object('status', result_status, 'worker_id', p_worker_id)
  );

  RETURN j;
END;
$$;

REVOKE ALL ON FUNCTION public.worker_complete_omr_processing_job(
  uuid, text, text, text, integer, numeric, jsonb, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_complete_omr_processing_job(
  uuid, text, text, text, integer, numeric, jsonb, text, jsonb
) TO service_role;

-- Repair only non-approved OpenCV rows whose persisted result-level review
-- metadata contradicts their terminal processing status. Scores and counts
-- are deliberately not recalculated or changed.
UPDATE public.omr_results
SET needs_review = (status = 'needs_review'),
    review_reason = CASE
      WHEN status = 'needs_review' THEN COALESCE(
        NULLIF(review_reason, ''),
        NULLIF(warnings->>0, ''),
        'processing_review_required'
      )
      ELSE NULL
    END
WHERE engine = 'opencv'
  AND approved_at IS NULL
  AND status IN ('completed', 'processed', 'needs_review')
  AND (
    needs_review IS DISTINCT FROM (status = 'needs_review')
    OR (status = 'needs_review' AND NULLIF(review_reason, '') IS NULL)
    OR (status IN ('completed', 'processed') AND review_reason IS NOT NULL)
  );
