/* Define result publication before the security migration revokes it. */

CREATE OR REPLACE FUNCTION public.publish_exam_result(p_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT role INTO v_caller_role
  FROM public.staff_profiles
  WHERE user_id = auth.uid() AND is_active = true;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'Not authorized to publish results';
  END IF;

  UPDATE public.exam_attempts
  SET is_result_published = true
  WHERE id = p_attempt_id;

  INSERT INTO public.audit_log (actor_id, actor_role, action, entity_type, entity_id)
  VALUES (auth.uid(), v_caller_role, 'publish_result', 'exam_attempt', p_attempt_id);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_exam_result(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_exam_result(uuid) TO authenticated;
