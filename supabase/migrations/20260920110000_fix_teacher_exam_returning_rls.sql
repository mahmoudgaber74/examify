-- Keep exam creation authorization unchanged, but make the teacher SELECT
-- branch safe for INSERT ... RETURNING. The current row is evaluated directly
-- instead of re-querying examify_exams through teacher_can_access_exam().
DROP POLICY IF EXISTS examify_exams_select ON public.examify_exams;
CREATE POLICY examify_exams_select ON public.examify_exams
FOR SELECT TO authenticated
USING (
  public.current_user_role() = 'super_admin'
  OR (
    institution_id = public.current_user_institution_id()
    AND public.current_user_role() IN ('school_admin', 'grader')
  )
  OR (
    public.current_user_role() = 'teacher'
    AND institution_id = public.current_user_institution_id()
    AND subject_id IS NOT NULL
    AND class_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.subject_teachers st
      WHERE st.teacher_id = public.current_staff_profile_id()
        AND st.subject_id = public.examify_exams.subject_id
        AND st.class_id = public.examify_exams.class_id
        AND st.is_active = true
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.exam_assignments ea
            WHERE ea.exam_id = public.examify_exams.id
              AND ea.section_id IS NOT NULL
          )
          OR st.section_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.exam_assignments ea
            WHERE ea.exam_id = public.examify_exams.id
              AND ea.section_id = st.section_id
          )
        )
    )
  )
  OR (
    public.current_user_role() = 'student'
    AND institution_id = public.current_user_institution_id()
    AND status = 'published'
    AND public.is_exam_assigned_to_current_student(id)
  )
);
