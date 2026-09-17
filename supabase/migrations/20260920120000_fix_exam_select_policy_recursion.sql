-- Break the examify_exams SELECT -> exam_assignments SELECT ->
-- teacher_can_access_exam -> examify_exams policy recursion.
-- This helper reads only the dependent assignment tables as the definer and
-- evaluates the complete teacher scope from the policy row parameters.
CREATE OR REPLACE FUNCTION public.teacher_exam_select_scope(
  p_exam_id uuid,
  p_institution_id uuid,
  p_subject_id uuid,
  p_class_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.current_user_role() = 'teacher'
    AND p_institution_id = public.current_user_institution_id()
    AND p_subject_id IS NOT NULL
    AND p_class_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.subject_teachers st
      WHERE st.teacher_id = public.current_staff_profile_id()
        AND st.subject_id = p_subject_id
        AND st.class_id = p_class_id
        AND st.is_active = true
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.exam_assignments ea
            WHERE ea.exam_id = p_exam_id
              AND ea.section_id IS NOT NULL
          )
          OR st.section_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.exam_assignments ea
            WHERE ea.exam_id = p_exam_id
              AND ea.section_id = st.section_id
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.teacher_exam_select_scope(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.teacher_exam_select_scope(uuid, uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS examify_exams_select ON public.examify_exams;
CREATE POLICY examify_exams_select ON public.examify_exams
FOR SELECT TO authenticated
USING (
  public.current_user_role() = 'super_admin'
  OR (
    institution_id = public.current_user_institution_id()
    AND public.current_user_role() IN ('school_admin', 'grader')
  )
  OR public.teacher_exam_select_scope(id, institution_id, subject_id, class_id)
  OR (
    public.current_user_role() = 'student'
    AND institution_id = public.current_user_institution_id()
    AND status = 'published'
    AND public.is_exam_assigned_to_current_student(id)
  )
);
