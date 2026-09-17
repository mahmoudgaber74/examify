/*
  Allow a student to read only questions belonging to an exam for which the
  student has an active in-progress attempt. This is intentionally narrower
  than assignment visibility and avoids the questions -> exam_questions policy
  recursion by reading the dependent tables as a SECURITY DEFINER helper.
*/

CREATE OR REPLACE FUNCTION public.student_can_read_active_exam_question(p_question_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND public.current_user_role() = 'student'
    AND EXISTS (
      SELECT 1
      FROM public.student_profiles sp
      JOIN public.exam_attempts ea
        ON ea.student_id = sp.id
       AND ea.status = 'in_progress'
      JOIN public.examify_exams e
        ON e.id = ea.exam_id
       AND e.institution_id = sp.institution_id
      JOIN public.exam_questions eq
        ON eq.exam_id = e.id
       AND eq.question_id = p_question_id
      JOIN public.questions q
        ON q.id = eq.question_id
       AND q.institution_id = e.institution_id
      WHERE sp.user_id = auth.uid()
        AND sp.is_active = true
        AND sp.institution_id IS NOT NULL
        AND e.institution_id IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION public.student_can_read_active_exam_question(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_can_read_active_exam_question(uuid) TO authenticated;

DROP POLICY IF EXISTS questions_select ON public.questions;
CREATE POLICY questions_select ON public.questions FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR is_public = true
  OR (institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'grader', 'data_entry'))
  OR (
    institution_id = public.current_user_institution_id()
    AND public.current_user_role() = 'teacher'
    AND (teacher_id = public.current_staff_profile_id() OR public.teacher_has_subject_scope(subject_id))
  )
  OR public.student_can_read_active_exam_question(id)
);
