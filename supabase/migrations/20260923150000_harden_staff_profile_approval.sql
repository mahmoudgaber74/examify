/*
  Staff approval hardening.

  A pending staff member must not be able to update their own profile and
  activate themselves. Only an already-active school administrator (within
  the same institution) or a super administrator may manage staff profiles.
*/

CREATE OR REPLACE FUNCTION public.can_manage_staff_profile(p_institution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_profiles actor
    WHERE actor.user_id = auth.uid()
      AND actor.is_active = true
      AND actor.role IN ('super_admin', 'school_admin')
      AND (actor.role = 'super_admin' OR actor.institution_id = p_institution_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_staff_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_staff_profile(uuid) TO authenticated;

DROP POLICY IF EXISTS "staff_profiles_insert" ON public.staff_profiles;
CREATE POLICY "staff_profiles_insert" ON public.staff_profiles FOR INSERT
  TO authenticated WITH CHECK (public.can_manage_staff_profile(institution_id));

DROP POLICY IF EXISTS "staff_profiles_update" ON public.staff_profiles;
CREATE POLICY "staff_profiles_update" ON public.staff_profiles FOR UPDATE
  TO authenticated
  USING (public.can_manage_staff_profile(institution_id))
  WITH CHECK (public.can_manage_staff_profile(institution_id));

DROP POLICY IF EXISTS "staff_profiles_delete" ON public.staff_profiles;
CREATE POLICY "staff_profiles_delete" ON public.staff_profiles FOR DELETE
  TO authenticated USING (public.can_manage_staff_profile(institution_id));

CREATE OR REPLACE FUNCTION public.guard_staff_profile_admin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text;
BEGIN
  SELECT actor.role
    INTO v_actor_role
  FROM public.staff_profiles actor
  WHERE actor.user_id = auth.uid()
    AND actor.is_active = true
  LIMIT 1;

  IF v_actor_role = 'school_admin'
     AND (
       NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
       OR NEW.role IS DISTINCT FROM OLD.role
     ) THEN
    RAISE EXCEPTION 'staff_profile_identity_fields_are_immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_staff_profile_admin_update ON public.staff_profiles;
CREATE TRIGGER trg_guard_staff_profile_admin_update
  BEFORE UPDATE ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_profile_admin_update();
