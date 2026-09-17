/*
  Allow an owning active student to read an in-progress attempt immediately
  after start_exam_attempt(), while keeping completed-result privacy intact.
*/
DROP POLICY IF EXISTS exam_attempts_select ON public.exam_attempts;

CREATE POLICY exam_attempts_select ON public.exam_attempts
FOR SELECT TO authenticated
USING (
  public.current_user_role() = 'super_admin'
  OR public.teacher_can_access_exam(exam_attempts.exam_id)
  OR EXISTS (
    SELECT 1
    FROM public.examify_exams e
    WHERE e.id = exam_attempts.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'grader')
  )
  OR (
    public.current_user_role() = 'student'
    AND EXISTS (
      SELECT 1
      FROM public.student_profiles sp
      WHERE sp.id = exam_attempts.student_id
        AND sp.user_id = auth.uid()
        AND sp.is_active = true
        AND (
          exam_attempts.status = 'in_progress'
          OR exam_attempts.is_result_published = true
        )
    )
  )
);
