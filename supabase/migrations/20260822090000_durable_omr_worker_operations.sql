-- Durable OMR worker lifecycle, retry/recovery, and operational controls.
-- Additive only; no existing scan or result rows are deleted.

ALTER TABLE public.omr_processing_jobs
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_timeout_seconds integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS last_error_class text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_requested_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE public.omr_processing_jobs DROP CONSTRAINT IF EXISTS omr_processing_jobs_status_check;
ALTER TABLE public.omr_processing_jobs ADD CONSTRAINT omr_processing_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'retrying', 'completed', 'needs_review', 'failed', 'approved', 'cancelled'));

DROP INDEX IF EXISTS omr_processing_jobs_active_scan_unique;
CREATE UNIQUE INDEX IF NOT EXISTS omr_processing_jobs_active_scan_unique
  ON public.omr_processing_jobs(scan_id)
  WHERE status IN ('queued', 'processing', 'retrying');
CREATE INDEX IF NOT EXISTS omr_processing_jobs_claim_idx
  ON public.omr_processing_jobs(status, next_retry_at, queued_at)
  WHERE status IN ('queued', 'retrying');
CREATE INDEX IF NOT EXISTS omr_processing_jobs_stale_idx
  ON public.omr_processing_jobs(status, heartbeat_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.omr_job_audit(
  p_job_id uuid, p_action text, p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.omr_processing_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.omr_processing_jobs WHERE id = p_job_id;
  IF j.id IS NULL THEN RETURN; END IF;
  INSERT INTO public.audit_log(institution_id, actor_id, actor_role, action, entity_type, entity_id, details)
  VALUES (j.institution_id, auth.uid(), COALESCE(public.current_user_role(), 'worker'), p_action,
    'omr_processing_job', p_job_id, jsonb_build_object('job_id', p_job_id, 'scan_id', j.scan_id) || COALESCE(p_details, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_next_omr_processing_jobs(
  p_worker_id text, p_limit integer DEFAULT 1
)
RETURNS SETOF public.omr_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'omr_worker_only'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.omr_processing_jobs
    WHERE status IN ('queued', 'retrying')
      AND attempt_count < max_attempts
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY queued_at, created_at
    FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit, 1), 10)
  )
  UPDATE public.omr_processing_jobs j
  SET status = 'processing', locked_at = now(), locked_by = p_worker_id,
      heartbeat_at = now(), started_at = COALESCE(started_at, now()),
      attempt_count = attempt_count + 1, updated_at = now()
  FROM candidates c WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_omr_processing_job(p_job_id uuid, p_worker_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'omr_worker_only'; END IF;
  UPDATE public.omr_processing_jobs SET heartbeat_at = now(), updated_at = now()
    WHERE id = p_job_id AND status = 'processing' AND locked_by = p_worker_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_omr_processing_job(
  p_job_id uuid, p_worker_id text, p_error_class text, p_error_code text,
  p_error_message_safe text, p_retryable boolean
)
RETURNS public.omr_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.omr_processing_jobs%ROWTYPE; next_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'omr_worker_only'; END IF;
  SELECT * INTO j FROM public.omr_processing_jobs WHERE id = p_job_id FOR UPDATE;
  IF j.id IS NULL OR j.status <> 'processing' OR j.locked_by <> p_worker_id THEN RAISE EXCEPTION 'omr_job_lock_denied'; END IF;
  next_status := CASE WHEN p_retryable AND j.attempt_count < j.max_attempts THEN 'retrying' ELSE 'failed' END;
  UPDATE public.omr_processing_jobs SET status = next_status,
    next_retry_at = CASE WHEN next_status = 'retrying' THEN now() + (LEAST(600, 30 * power(2, GREATEST(j.attempt_count - 1, 0))::integer) * interval '1 second') ELSE NULL END,
    last_error_class = p_error_class, error_code = p_error_code, error_message_safe = left(p_error_message_safe, 500),
    last_error_at = now(), locked_at = NULL, locked_by = NULL, heartbeat_at = NULL, updated_at = now()
    WHERE id = p_job_id RETURNING * INTO j;
  PERFORM public.omr_job_audit(p_job_id, 'omr_job_failed', jsonb_build_object('status', next_status, 'error_code', p_error_code, 'attempt_count', j.attempt_count));
  RETURN j;
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_stale_omr_processing_jobs(p_timeout_seconds integer DEFAULT 180)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed integer;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'omr_worker_only'; END IF;
  WITH stale AS (
    SELECT id, attempt_count, max_attempts FROM public.omr_processing_jobs
    WHERE status = 'processing' AND COALESCE(heartbeat_at, started_at, locked_at, created_at) < now() - make_interval(secs => GREATEST(p_timeout_seconds, 30))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.omr_processing_jobs j SET
    status = CASE WHEN s.attempt_count < s.max_attempts THEN 'retrying' ELSE 'failed' END,
    next_retry_at = CASE WHEN s.attempt_count < s.max_attempts THEN now() + interval '30 seconds' ELSE NULL END,
    last_error_class = 'stale_worker', error_code = 'worker_heartbeat_timeout', error_message_safe = 'انتهت مهلة العامل أثناء المعالجة',
    locked_at = NULL, locked_by = NULL, heartbeat_at = NULL, last_error_at = now(), updated_at = now()
  FROM stale s WHERE j.id = s.id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.manual_retry_omr_processing_job(p_job_id uuid)
RETURNS public.omr_processing_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.omr_processing_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.omr_processing_jobs WHERE id = p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'omr_job_not_found'; END IF;
  IF public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN RAISE EXCEPTION 'omr_retry_not_allowed'; END IF;
  IF public.current_user_role() <> 'super_admin' AND j.institution_id <> public.current_user_institution_id() THEN RAISE EXCEPTION 'omr_job_institution_denied'; END IF;
  IF j.status NOT IN ('failed', 'retrying') THEN RAISE EXCEPTION 'omr_job_not_retryable'; END IF;
  UPDATE public.omr_processing_jobs SET status = 'retrying', next_retry_at = now(), retry_requested_by = auth.uid(), error_code = NULL, error_message_safe = NULL, updated_at = now() WHERE id = p_job_id RETURNING * INTO j;
  PERFORM public.omr_job_audit(p_job_id, 'omr_job_manual_retry');
  RETURN j;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_omr_processing_job(p_job_id uuid)
RETURNS public.omr_processing_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.omr_processing_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.omr_processing_jobs WHERE id = p_job_id FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'omr_job_not_found'; END IF;
  IF public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher') THEN RAISE EXCEPTION 'omr_cancel_not_allowed'; END IF;
  IF public.current_user_role() <> 'super_admin' AND j.institution_id <> public.current_user_institution_id() THEN RAISE EXCEPTION 'omr_job_institution_denied'; END IF;
  IF j.status NOT IN ('queued', 'retrying') THEN RAISE EXCEPTION 'omr_job_not_cancellable'; END IF;
  UPDATE public.omr_processing_jobs SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now() WHERE id = p_job_id RETURNING * INTO j;
  PERFORM public.omr_job_audit(p_job_id, 'omr_job_cancelled');
  RETURN j;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_omr_processing_jobs(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.heartbeat_omr_processing_job(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_omr_processing_job(uuid, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stale_omr_processing_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_omr_processing_jobs(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_omr_processing_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_omr_processing_job(uuid, text, text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_stale_omr_processing_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.manual_retry_omr_processing_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_omr_processing_job(uuid) TO authenticated;

-- Idempotent enqueue for the Edge Function. A repeated click for the same
-- scan returns the existing active job instead of creating another one.
CREATE OR REPLACE FUNCTION public.enqueue_omr_processing_job(
  p_scan_id uuid, p_template_id uuid, p_request_id text,
  p_engine text DEFAULT 'opencv', p_engine_version text DEFAULT NULL,
  p_max_attempts integer DEFAULT 3
)
RETURNS public.omr_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE scan_row public.omr_results%ROWTYPE; job_row public.omr_processing_jobs%ROWTYPE;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin','school_admin','teacher','grader') THEN RAISE EXCEPTION 'omr_job_not_allowed'; END IF;
  SELECT * INTO scan_row FROM public.omr_results WHERE id = p_scan_id FOR UPDATE;
  IF scan_row.id IS NULL THEN RAISE EXCEPTION 'omr_scan_not_found'; END IF;
  IF public.current_user_role() <> 'super_admin' AND scan_row.institution_id <> public.current_user_institution_id() THEN RAISE EXCEPTION 'omr_job_institution_denied'; END IF;
  SELECT * INTO job_row FROM public.omr_processing_jobs WHERE scan_id = p_scan_id AND status IN ('queued','processing','retrying') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF job_row.id IS NOT NULL THEN RETURN job_row; END IF;
  IF (SELECT count(*) FROM public.omr_processing_jobs WHERE institution_id = scan_row.institution_id AND status IN ('queued','processing','retrying')) >= 5 THEN RAISE EXCEPTION 'omr_rate_limit_exceeded'; END IF;
  INSERT INTO public.omr_processing_jobs(institution_id,scan_id,template_id,request_id,engine,engine_version,max_attempts,created_by)
  VALUES(scan_row.institution_id,scan_row.id,p_template_id,p_request_id,p_engine,p_engine_version,LEAST(GREATEST(p_max_attempts,1),10),auth.uid()) RETURNING * INTO job_row;
  UPDATE public.omr_results SET engine=p_engine, engine_version=p_engine_version, status='queued' WHERE id=scan_row.id;
  PERFORM public.omr_job_audit(job_row.id, 'omr_job_enqueued', jsonb_build_object('request_id', p_request_id));
  RETURN job_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_omr_processing_job(uuid,uuid,text,text,text,integer) TO authenticated;

-- Worker-only atomic persistence. It intentionally mirrors the existing
-- completion mapping but authenticates the independent service worker.
CREATE OR REPLACE FUNCTION public.worker_complete_omr_processing_job(
  p_job_id uuid, p_worker_id text, p_status text, p_engine_version text,
  p_processing_time_ms integer, p_document_confidence numeric, p_warnings jsonb,
  p_annotated_storage_path text, p_questions jsonb
)
RETURNS public.omr_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.omr_processing_jobs%ROWTYPE; item jsonb; result_status text;
  qid uuid; oid uuid; correct boolean; correct_label text; detected text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'omr_worker_only'; END IF;
  SELECT * INTO j FROM public.omr_processing_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.id IS NULL OR j.status <> 'processing' OR j.locked_by <> p_worker_id THEN RAISE EXCEPTION 'omr_job_lock_denied'; END IF;
  result_status := CASE WHEN p_status IN ('completed','needs_review') THEN p_status ELSE 'failed' END;
  UPDATE public.omr_results SET engine='opencv',engine_version=p_engine_version,document_confidence=p_document_confidence,
    processing_time_ms=p_processing_time_ms,annotated_storage_path=p_annotated_storage_path,processed_storage_path=p_annotated_storage_path,
    warnings=COALESCE(p_warnings,'[]'::jsonb),processing_metadata=jsonb_build_object('engine','opencv','engine_version',p_engine_version,'processing_time_ms',p_processing_time_ms,'warnings',COALESCE(p_warnings,'[]'::jsonb)),status=result_status
    WHERE id=j.scan_id;
  DELETE FROM public.omr_answers WHERE omr_result_id=j.scan_id;
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_questions,'[]'::jsonb)) LOOP
    detected := item->>'detected_option';
    SELECT eq.question_id INTO qid FROM public.exam_questions eq JOIN public.omr_results r ON r.exam_id=eq.exam_id WHERE r.id=j.scan_id ORDER BY eq.sort_order,eq.id OFFSET ((item->>'question_number')::integer-1) LIMIT 1;
    SELECT qo.id,qo.is_correct INTO oid,correct FROM public.question_options qo WHERE qo.question_id=qid AND qo.label=detected LIMIT 1;
    SELECT qo.label INTO correct_label FROM public.question_options qo WHERE qo.question_id=qid AND qo.is_correct=true LIMIT 1;
    INSERT INTO public.omr_answers(omr_result_id,question_number,question_id,option_id,detected_answer,correct_answer,is_correct,confidence,needs_manual_review,review_reason,fill_ratios)
    VALUES(j.scan_id,(item->>'question_number')::integer,qid,oid,detected,correct_label,CASE WHEN detected IS NULL THEN NULL ELSE COALESCE(correct,false) END,COALESCE((item->>'confidence')::numeric,0),COALESCE((item->>'needs_manual_review')::boolean,false),item->>'status',COALESCE(item->'fill_scores','{}'::jsonb));
  END LOOP;
  UPDATE public.omr_results r SET total_questions=(SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id=r.id),correct_count=(SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id=r.id AND a.is_correct=true),wrong_count=(SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id=r.id AND a.is_correct=false AND a.detected_answer IS NOT NULL),empty_count=(SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id=r.id AND a.detected_answer IS NULL),score=(SELECT count(*) FROM public.omr_answers a WHERE a.omr_result_id=r.id AND a.is_correct=true) WHERE r.id=j.scan_id;
  UPDATE public.omr_processing_jobs SET status=result_status,engine_version=p_engine_version,processing_time_ms=p_processing_time_ms,completed_at=now(),locked_at=NULL,locked_by=NULL,heartbeat_at=NULL,error_code=NULL,error_message_safe=NULL,updated_at=now() WHERE id=j.id RETURNING * INTO j;
  PERFORM public.omr_job_audit(p_job_id,'omr_job_completed',jsonb_build_object('status',result_status,'worker_id',p_worker_id));
  RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION public.worker_complete_omr_processing_job(uuid,text,text,text,integer,numeric,jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_complete_omr_processing_job(uuid,text,text,text,integer,numeric,jsonb,text,jsonb) TO service_role;

-- PostgREST still requires table privileges even when the worker uses the
-- service role (the worker only reads these two source records directly).
GRANT SELECT ON public.omr_results, public.bubble_sheets TO service_role;

-- Operations reads through a bounded SECURITY DEFINER RPC so the table need
-- not be broadly granted to authenticated users. The institution predicate is
-- explicit here and remains independent of the table's RLS policy.
CREATE OR REPLACE FUNCTION public.list_omr_processing_jobs(p_status text DEFAULT NULL, p_limit integer DEFAULT 100)
RETURNS SETOF public.omr_processing_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.current_user_role() NOT IN ('super_admin','school_admin','teacher','grader') THEN RAISE EXCEPTION 'omr_operations_not_allowed'; END IF;
  RETURN QUERY SELECT j.* FROM public.omr_processing_jobs j
    WHERE (public.current_user_role() = 'super_admin' OR j.institution_id = public.current_user_institution_id())
      AND (p_status IS NULL OR j.status = p_status)
    ORDER BY j.queued_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),100);
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_omr_processing_jobs(text,integer) TO authenticated;
