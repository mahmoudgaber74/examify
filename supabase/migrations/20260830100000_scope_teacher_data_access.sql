-- Scope teacher reads and grading access to active subject/class assignments.
-- Administrative roles and student/parent ownership rules remain unchanged.

CREATE OR REPLACE FUNCTION public.teacher_has_class_scope(
  p_class_id uuid,
  p_section_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.current_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
      FROM public.subject_teachers st
      JOIN public.staff_profiles sp ON sp.id = st.teacher_id
      WHERE st.teacher_id = public.current_staff_profile_id()
        AND sp.institution_id = public.current_user_institution_id()
        AND st.class_id = p_class_id
        AND st.is_active = true
        AND (p_section_id IS NULL OR st.section_id IS NULL OR st.section_id = p_section_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.teacher_has_subject_scope(p_subject_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.current_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
      FROM public.subject_teachers st
      JOIN public.staff_profiles sp ON sp.id = st.teacher_id
      WHERE st.teacher_id = public.current_staff_profile_id()
        AND sp.institution_id = public.current_user_institution_id()
        AND st.subject_id = p_subject_id
        AND st.is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION public.teacher_can_access_exam(p_exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.current_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
      FROM public.examify_exams e
      WHERE e.id = p_exam_id
        AND e.institution_id = public.current_user_institution_id()
        AND e.subject_id IS NOT NULL
        AND e.class_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.subject_teachers st
          WHERE st.teacher_id = public.current_staff_profile_id()
            AND st.subject_id = e.subject_id
            AND st.class_id = e.class_id
            AND st.is_active = true
            AND (
              NOT EXISTS (
                SELECT 1 FROM public.exam_assignments ea
                WHERE ea.exam_id = e.id AND ea.section_id IS NOT NULL
              )
              OR st.section_id IS NULL
              OR EXISTS (
                SELECT 1 FROM public.exam_assignments ea
                WHERE ea.exam_id = e.id AND ea.section_id = st.section_id
              )
            )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.teacher_has_class_scope(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_has_subject_scope(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_can_access_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.teacher_has_class_scope(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_has_subject_scope(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_can_access_exam(uuid) TO authenticated;

DROP POLICY IF EXISTS staff_profiles_select ON public.staff_profiles;
CREATE POLICY staff_profiles_select ON public.staff_profiles FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR user_id = auth.uid()
  OR (institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'grader', 'data_entry'))
);

DROP POLICY IF EXISTS classes_select ON public.classes;
CREATE POLICY classes_select ON public.classes FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR (institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'grader', 'data_entry'))
  OR (institution_id = public.current_user_institution_id() AND public.teacher_has_class_scope(id))
);

DROP POLICY IF EXISTS sections_select ON public.sections;
CREATE POLICY sections_select ON public.sections FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = sections.class_id
      AND (
        (c.institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'grader', 'data_entry'))
        OR public.teacher_has_class_scope(sections.class_id, sections.id)
      )
  )
);

DROP POLICY IF EXISTS grade_subjects_select ON public.grade_subjects;
CREATE POLICY grade_subjects_select ON public.grade_subjects FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR (institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'grader', 'data_entry'))
  OR (
    institution_id = public.current_user_institution_id()
    AND public.teacher_has_subject_scope(subject_id)
    AND (class_id IS NULL OR public.teacher_has_class_scope(class_id))
  )
);

DROP POLICY IF EXISTS subjects_select ON public.subjects;
CREATE POLICY subjects_select ON public.subjects FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR (institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'grader', 'data_entry'))
  OR (institution_id = public.current_user_institution_id() AND public.teacher_has_subject_scope(id))
);

DROP POLICY IF EXISTS student_profiles_select ON public.student_profiles;
CREATE POLICY student_profiles_select ON public.student_profiles FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR (
    institution_id = public.current_user_institution_id()
    AND public.current_user_role() IN ('school_admin', 'grader', 'data_entry')
  )
  OR (
    institution_id = public.current_user_institution_id()
    AND EXISTS (
      SELECT 1
      FROM public.class_students cs
      WHERE cs.student_id = student_profiles.id
        AND public.teacher_has_class_scope(cs.class_id, cs.section_id)
    )
  )
  OR user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.parent_student_links psl
    JOIN public.parent_profiles pp ON pp.id = psl.parent_id
    WHERE pp.user_id = auth.uid() AND psl.student_id = student_profiles.id
  )
);

DROP POLICY IF EXISTS class_students_select ON public.class_students;
CREATE POLICY class_students_select ON public.class_students FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR (
    public.current_user_role() IN ('school_admin', 'grader', 'data_entry')
    AND EXISTS (SELECT 1 FROM public.classes c WHERE c.id = class_students.class_id AND c.institution_id = public.current_user_institution_id())
  )
  OR public.teacher_has_class_scope(class_id, section_id)
  OR EXISTS (
    SELECT 1 FROM public.student_profiles sp
    WHERE sp.id = class_students.student_id AND sp.user_id = auth.uid()
  )
);

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
);

DROP POLICY IF EXISTS questions_insert ON public.questions;
CREATE POLICY questions_insert ON public.questions FOR INSERT TO authenticated WITH CHECK (
  institution_id = public.current_user_institution_id()
  AND (
    public.current_user_role() IN ('super_admin', 'school_admin')
    OR (
      public.current_user_role() = 'teacher'
      AND teacher_id = public.current_staff_profile_id()
      AND subject_id IS NOT NULL
      AND public.teacher_has_subject_scope(subject_id)
    )
  )
);

DROP POLICY IF EXISTS examify_exams_select ON public.examify_exams;
CREATE POLICY examify_exams_select ON public.examify_exams FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR (
    institution_id = public.current_user_institution_id()
    AND public.current_user_role() IN ('school_admin', 'grader')
  )
  OR public.teacher_can_access_exam(id)
  OR (
    public.current_user_role() = 'student'
    AND institution_id = public.current_user_institution_id()
    AND status = 'published'
    AND public.is_exam_assigned_to_current_student(id)
  )
);

DROP POLICY IF EXISTS exam_questions_select ON public.exam_questions;
CREATE POLICY exam_questions_select ON public.exam_questions FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_questions.exam_id
      AND (
        public.current_user_role() = 'super_admin'
        OR (e.institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'grader'))
        OR public.teacher_can_access_exam(e.id)
        OR (public.current_user_role() = 'student' AND public.is_exam_assigned_to_current_student(e.id))
      )
  )
);

DROP POLICY IF EXISTS exam_assignments_select ON public.exam_assignments;
CREATE POLICY exam_assignments_select ON public.exam_assignments FOR SELECT TO authenticated USING (
  public.teacher_can_access_exam(exam_id)
  OR EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_assignments.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'grader')
  )
  OR EXISTS (
    SELECT 1 FROM public.student_profiles sp
    WHERE sp.id = exam_assignments.student_id AND sp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS exam_attempts_select ON public.exam_attempts;
CREATE POLICY exam_attempts_select ON public.exam_attempts FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR public.teacher_can_access_exam(exam_id)
  OR EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_attempts.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'grader')
  )
  OR EXISTS (
    SELECT 1 FROM public.student_profiles sp
    WHERE sp.id = exam_attempts.student_id AND sp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS exam_attempts_update ON public.exam_attempts;
CREATE POLICY exam_attempts_update ON public.exam_attempts FOR UPDATE TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR public.teacher_can_access_exam(exam_id)
  OR (
    EXISTS (
      SELECT 1 FROM public.examify_exams e
      WHERE e.id = exam_attempts.exam_id
        AND e.institution_id = public.current_user_institution_id()
        AND public.current_user_role() IN ('school_admin', 'grader')
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.student_profiles sp WHERE sp.id = exam_attempts.student_id AND sp.user_id = auth.uid()
  )
) WITH CHECK (
  public.current_user_role() = 'super_admin'
  OR public.teacher_can_access_exam(exam_id)
  OR EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_attempts.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'grader')
  )
  OR EXISTS (
    SELECT 1 FROM public.student_profiles sp WHERE sp.id = exam_attempts.student_id AND sp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS answers_select ON public.answers;
CREATE POLICY answers_select ON public.answers FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR EXISTS (
    SELECT 1 FROM public.exam_attempts ea
    WHERE ea.id = answers.attempt_id
      AND (public.teacher_can_access_exam(ea.exam_id) OR EXISTS (
        SELECT 1 FROM public.examify_exams e
        WHERE e.id = ea.exam_id AND e.institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'grader')
      ))
  )
  OR EXISTS (
    SELECT 1 FROM public.exam_attempts ea
    JOIN public.student_profiles sp ON sp.id = ea.student_id
    WHERE ea.id = answers.attempt_id AND sp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS answers_update ON public.answers;
CREATE POLICY answers_update ON public.answers FOR UPDATE TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR EXISTS (
    SELECT 1 FROM public.exam_attempts ea
    WHERE ea.id = answers.attempt_id
      AND (public.teacher_can_access_exam(ea.exam_id) OR EXISTS (
        SELECT 1 FROM public.examify_exams e
        WHERE e.id = ea.exam_id AND e.institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'grader')
      ))
  )
);
