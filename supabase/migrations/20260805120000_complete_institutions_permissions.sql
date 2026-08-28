/*
  Complete institution branch permissions.

  super_admin can manage branches across institutions. school_admin remains
  limited to branches in the current user's institution.
*/

DROP POLICY IF EXISTS "branches_insert" ON public.branches;
CREATE POLICY "branches_insert" ON public.branches FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() = 'super_admin'
    OR (
      public.current_user_role() = 'school_admin'
      AND institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "branches_update" ON public.branches;
CREATE POLICY "branches_update" ON public.branches FOR UPDATE
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (
      public.current_user_role() = 'school_admin'
      AND institution_id = public.current_user_institution_id()
    )
  ) WITH CHECK (
    public.current_user_role() = 'super_admin'
    OR (
      public.current_user_role() = 'school_admin'
      AND institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "branches_delete" ON public.branches;
CREATE POLICY "branches_delete" ON public.branches FOR DELETE
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (
      public.current_user_role() = 'school_admin'
      AND institution_id = public.current_user_institution_id()
    )
  );
