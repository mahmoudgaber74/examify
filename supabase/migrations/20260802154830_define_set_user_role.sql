/* Define the role-management function before the security migration revokes it. */

CREATE OR REPLACE FUNCTION public.set_user_role(p_target_user_id uuid, p_new_role text)
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

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin', 'school_admin') THEN
    RAISE EXCEPTION 'Not authorized to change roles';
  END IF;

  IF p_new_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader', 'data_entry', 'student', 'parent') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;

  IF v_caller_role = 'school_admin' AND p_new_role = 'super_admin' THEN
    RAISE EXCEPTION 'Not authorized to grant super_admin';
  END IF;

  UPDATE public.staff_profiles
  SET role = p_new_role
  WHERE user_id = p_target_user_id;

  INSERT INTO public.audit_log (actor_id, actor_role, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(),
    v_caller_role,
    'role_change',
    'staff_profile',
    p_target_user_id,
    jsonb_build_object('new_role', p_new_role)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, text) TO authenticated;
