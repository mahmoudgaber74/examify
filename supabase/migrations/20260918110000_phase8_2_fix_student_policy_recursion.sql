/* Phase 8.2: break the student_profiles <-> class_students policy recursion.
   Student ownership and institution scope remain server-side; class-scoped
   teacher access is represented by the institution/role branch here. */
DROP POLICY IF EXISTS student_profiles_select ON public.student_profiles;
CREATE POLICY student_profiles_select ON public.student_profiles
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'super_admin'
    OR (
      institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader', 'data_entry')
    )
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.parent_student_links psl
      JOIN public.parent_profiles pp ON pp.id = psl.parent_id
      WHERE pp.user_id = auth.uid()
        AND psl.student_id = student_profiles.id
    )
  );
