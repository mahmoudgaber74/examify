/*
  The remote project already owns the later, canonical jsonb-returning
  publish_exam_result(uuid) implementation from the exam-lifecycle migration.
  Keep that implementation intact and only restore the intended privilege
  boundary while recording this historical migration as applied.
*/

DO $$
BEGIN
  IF to_regprocedure('public.publish_exam_result(uuid)') IS NULL THEN
    RAISE EXCEPTION 'publish_exam_result(uuid) must exist before this compatibility migration';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_exam_result(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_exam_result(uuid) TO authenticated;
