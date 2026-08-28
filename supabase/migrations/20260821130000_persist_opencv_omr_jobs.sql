-- Persistent local OpenCV OMR orchestration.
-- This migration is additive: it does not remove or rewrite existing scan data.

ALTER TABLE public.omr_results
  ADD COLUMN IF NOT EXISTS engine text,
  ADD COLUMN IF NOT EXISTS engine_version text,
  ADD COLUMN IF NOT EXISTS document_confidence numeric(6,4),
  ADD COLUMN IF NOT EXISTS processing_time_ms integer,
  ADD COLUMN IF NOT EXISTS annotated_storage_path text,
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.omr_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES public.omr_results(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.bubble_sheets(id) ON DELETE SET NULL,
  request_id text NOT NULL UNIQUE,
  engine text NOT NULL DEFAULT 'opencv',
  engine_version text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'needs_review', 'failed', 'approved')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  next_retry_at timestamptz,
  processing_time_ms integer,
  error_code text,
  error_message_safe text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS omr_processing_jobs_active_scan_unique
  ON public.omr_processing_jobs(scan_id)
  WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS omr_processing_jobs_institution_status_idx
  ON public.omr_processing_jobs(institution_id, status, created_at DESC);

ALTER TABLE public.omr_processing_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS omr_processing_jobs_select ON public.omr_processing_jobs;
CREATE POLICY omr_processing_jobs_select ON public.omr_processing_jobs FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'super_admin'
    OR (institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader', 'data_entry'))
  );
DROP POLICY IF EXISTS omr_processing_jobs_no_direct_insert ON public.omr_processing_jobs;
CREATE POLICY omr_processing_jobs_no_direct_insert ON public.omr_processing_jobs FOR INSERT TO authenticated
  WITH CHECK (false);
DROP POLICY IF EXISTS omr_processing_jobs_no_direct_update ON public.omr_processing_jobs;
CREATE POLICY omr_processing_jobs_no_direct_update ON public.omr_processing_jobs FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.create_omr_processing_job(
  p_scan_id uuid,
  p_template_id uuid,
  p_request_id text,
  p_engine text DEFAULT 'opencv',
  p_engine_version text DEFAULT NULL,
  p_max_attempts integer DEFAULT 3
)
RETURNS public.omr_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  scan_row public.omr_results%ROWTYPE;
  job_row public.omr_processing_jobs%ROWTYPE;
  actor_role text := public.current_user_role();
  active_count integer;
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'omr_job_not_allowed';
  END IF;
  SELECT * INTO scan_row FROM public.omr_results WHERE id = p_scan_id FOR UPDATE;
  IF scan_row.id IS NULL THEN RAISE EXCEPTION 'omr_scan_not_found'; END IF;
  IF actor_role <> 'super_admin' AND scan_row.institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'omr_job_institution_denied';
  END IF;
  SELECT count(*) INTO active_count
  FROM public.omr_processing_jobs
  WHERE institution_id = scan_row.institution_id AND status IN ('queued', 'processing');
  IF active_count >= 5 THEN RAISE EXCEPTION 'omr_rate_limit_exceeded'; END IF;
  INSERT INTO public.omr_processing_jobs (
    institution_id, scan_id, template_id, request_id, engine, engine_version, max_attempts, created_by
  ) VALUES (
    scan_row.institution_id, scan_row.id, p_template_id, p_request_id, p_engine,
    p_engine_version, LEAST(GREATEST(p_max_attempts, 1), 10), auth.uid()
  ) RETURNING * INTO job_row;
  UPDATE public.omr_results SET engine = p_engine, engine_version = p_engine_version, status = 'queued'
    WHERE id = scan_row.id;
  RETURN job_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_omr_processing_job(p_job_id uuid)
RETURNS public.omr_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE job_row public.omr_processing_jobs%ROWTYPE;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'omr_job_not_allowed';
  END IF;
  UPDATE public.omr_processing_jobs
  SET status = 'processing', attempt_count = attempt_count + 1,
      started_at = now(), updated_at = now()
  WHERE id = p_job_id AND status IN ('queued', 'failed') AND attempt_count < max_attempts
    AND (next_retry_at IS NULL OR next_retry_at <= now())
  RETURNING * INTO job_row;
  IF job_row.id IS NULL THEN RAISE EXCEPTION 'omr_job_not_claimable'; END IF;
  RETURN job_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_omr_processing_job(
  p_job_id uuid,
  p_status text,
  p_engine_version text,
  p_processing_time_ms integer,
  p_document_confidence numeric,
  p_warnings jsonb,
  p_annotated_storage_path text,
  p_questions jsonb
)
RETURNS public.omr_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  job_row public.omr_processing_jobs%ROWTYPE;
  item jsonb;
  result_status text;
  detected text;
  question_id_value uuid;
  option_id_value uuid;
  correct_value boolean;
  correct_label_value text;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'omr_job_not_allowed';
  END IF;
  SELECT * INTO job_row FROM public.omr_processing_jobs WHERE id = p_job_id FOR UPDATE;
  IF job_row.id IS NULL THEN RAISE EXCEPTION 'omr_job_not_found'; END IF;
  IF public.current_user_role() <> 'super_admin' AND job_row.institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'omr_job_institution_denied';
  END IF;
  IF job_row.status IN ('approved') THEN RAISE EXCEPTION 'omr_job_approved_locked'; END IF;
  result_status := CASE WHEN p_status IN ('completed', 'needs_review') THEN p_status ELSE 'failed' END;
  UPDATE public.omr_results SET
    engine = 'opencv', engine_version = p_engine_version,
    document_confidence = p_document_confidence, processing_time_ms = p_processing_time_ms,
    annotated_storage_path = p_annotated_storage_path, processed_storage_path = p_annotated_storage_path,
    warnings = COALESCE(p_warnings, '[]'::jsonb), processing_metadata = jsonb_build_object(
      'engine', 'opencv', 'engine_version', p_engine_version, 'processing_time_ms', p_processing_time_ms,
      'warnings', COALESCE(p_warnings, '[]'::jsonb)
    ), status = result_status
  WHERE id = job_row.scan_id;
  DELETE FROM public.omr_answers WHERE omr_result_id = job_row.scan_id;
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_questions, '[]'::jsonb)) LOOP
    detected := item->>'detected_option';
    SELECT eq.question_id INTO question_id_value
      FROM public.exam_questions eq
      JOIN public.omr_results r ON r.exam_id = eq.exam_id
      WHERE r.id = job_row.scan_id
      ORDER BY eq.sort_order, eq.id
      OFFSET ((item->>'question_number')::integer - 1) LIMIT 1;
    SELECT qo.id, qo.is_correct INTO option_id_value, correct_value
      FROM public.question_options qo
      WHERE qo.question_id = question_id_value AND qo.label = detected
      LIMIT 1;
    SELECT qo.label INTO correct_label_value
      FROM public.question_options qo
      WHERE qo.question_id = question_id_value AND qo.is_correct = true
      LIMIT 1;
    INSERT INTO public.omr_answers (
      omr_result_id, question_number, question_id, option_id, detected_answer, correct_answer,
      is_correct, confidence, needs_manual_review, review_reason, fill_ratios
    ) VALUES (
      job_row.scan_id, (item->>'question_number')::integer, question_id_value, option_id_value, detected,
      correct_label_value,
      CASE WHEN detected IS NULL THEN NULL ELSE COALESCE(correct_value, false) END,
      COALESCE((item->>'confidence')::numeric, 0),
      COALESCE((item->>'needs_manual_review')::boolean, false), item->>'status',
      COALESCE(item->'fill_scores', '{}'::jsonb)
    );
  END LOOP;
  UPDATE public.omr_results r SET
    total_questions = (SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id = r.id),
    correct_count = (SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id = r.id AND a.is_correct = true),
    wrong_count = (SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id = r.id AND a.is_correct = false AND a.detected_answer IS NOT NULL),
    empty_count = (SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id = r.id AND a.detected_answer IS NULL),
    score = (SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id = r.id AND a.is_correct = true)
    WHERE r.id = job_row.scan_id;
  UPDATE public.omr_processing_jobs SET status = result_status,
    engine_version = p_engine_version, processing_time_ms = p_processing_time_ms,
    completed_at = now(), updated_at = now(), error_code = NULL, error_message_safe = NULL
    WHERE id = job_row.id RETURNING * INTO job_row;
  RETURN job_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_omr_processing_job(uuid, uuid, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_omr_processing_job(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_omr_processing_job(uuid, text, text, integer, numeric, jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_omr_processing_job(uuid, uuid, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_omr_processing_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_omr_processing_job(uuid, text, text, integer, numeric, jsonb, text, jsonb) TO authenticated;
