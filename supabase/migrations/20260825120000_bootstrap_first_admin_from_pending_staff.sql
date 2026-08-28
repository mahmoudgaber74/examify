/* Allow the first pending staff account to bootstrap the system safely. */
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'bootstrap_authentication_required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('examify:first-super-admin-bootstrap'));

  IF EXISTS (SELECT 1 FROM staff_profiles WHERE role = 'super_admin') THEN
    RAISE EXCEPTION 'bootstrap_already_completed';
  END IF;

  SELECT id INTO v_staff_id
    FROM staff_profiles
   WHERE user_id = auth.uid()
   FOR UPDATE;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'bootstrap_requires_staff_profile';
  END IF;

  UPDATE staff_profiles
     SET role = 'super_admin', is_active = true, updated_at = now()
   WHERE id = v_staff_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_first_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated;
