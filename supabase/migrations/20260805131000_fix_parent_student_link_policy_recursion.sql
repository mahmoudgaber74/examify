/*
  Avoid RLS recursion when validating parent/student link institution matching.
*/

CREATE OR REPLACE FUNCTION public.student_profile_institution_id(target_student_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sp.institution_id
  FROM public.student_profiles sp
  WHERE sp.id = target_student_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.student_profile_institution_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_profile_institution_id(uuid) TO authenticated;

DROP POLICY IF EXISTS "parent_student_links_insert" ON public.parent_student_links;
CREATE POLICY "parent_student_links_insert" ON public.parent_student_links FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
        AND pp.institution_id = public.current_user_institution_id()
        AND public.student_profile_institution_id(parent_student_links.student_id) = pp.institution_id
    )
  );

DROP POLICY IF EXISTS "parent_student_links_update" ON public.parent_student_links;
CREATE POLICY "parent_student_links_update" ON public.parent_student_links FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
        AND pp.institution_id = public.current_user_institution_id()
        AND public.student_profile_institution_id(parent_student_links.student_id) = pp.institution_id
    )
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
        AND pp.institution_id = public.current_user_institution_id()
        AND public.student_profile_institution_id(parent_student_links.student_id) = pp.institution_id
    )
  );
