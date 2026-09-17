/*
  Internal-only result notification processor primitives.
  No provider delivery is performed by this migration.
*/

CREATE OR REPLACE FUNCTION public.claim_result_publication_event(p_event_id uuid)
RETURNS public.result_publication_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed public.result_publication_events;
BEGIN
  UPDATE public.result_publication_events
  SET status = 'processing',
      processing_started_at = now(),
      next_attempt_at = NULL,
      attempt_count = attempt_count + 1,
      last_error = NULL
  WHERE id = p_event_id
    AND (
      status = 'pending'
      OR (status = 'failed' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
      OR (status = 'processing' AND processing_started_at < now() - interval '10 minutes')
    )
  RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_result_publication_event(p_event_id uuid)
RETURNS public.result_publication_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  completed public.result_publication_events;
BEGIN
  UPDATE public.result_publication_events
  SET status = 'processed',
      processed_at = COALESCE(processed_at, now()),
      processing_started_at = NULL,
      next_attempt_at = NULL,
      last_error = NULL
  WHERE id = p_event_id
    AND status = 'processing'
  RETURNING * INTO completed;

  RETURN completed;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_result_publication_event(
  p_event_id uuid,
  p_error text,
  p_retry_after_seconds integer DEFAULT 300
)
RETURNS public.result_publication_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  failed public.result_publication_events;
  retry_seconds integer := GREATEST(30, LEAST(COALESCE(p_retry_after_seconds, 300), 86400));
BEGIN
  UPDATE public.result_publication_events
  SET status = 'failed',
      processing_started_at = NULL,
      next_attempt_at = now() + make_interval(secs => retry_seconds),
      last_error = LEFT(COALESCE(NULLIF(trim(p_error), ''), 'processor_failure'), 500)
  WHERE id = p_event_id
    AND status = 'processing'
  RETURNING * INTO failed;

  RETURN failed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_result_publication_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_result_publication_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_result_publication_event(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_result_publication_event(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_result_publication_event(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_result_publication_event(uuid, text, integer) TO service_role;
