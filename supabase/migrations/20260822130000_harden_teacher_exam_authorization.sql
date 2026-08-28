-- Harden teacher ownership and scope for exam structure writes.
-- Legacy exams with a NULL teacher_id remain readable but are not writable by teachers.

CREATE OR REPLACE FUNCTION public.current_staff_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT sp.id
  FROM public.staff_profiles sp
  WHERE sp.user_id = auth.uid()
    AND sp.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.teacher_can_manage_exam_scope(
  p_exam_id uuid,
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
    AND EXISTS (
      SELECT 1
      FROM public.examify_exams e
      JOIN public.subject_teachers st
        ON st.teacher_id = public.current_staff_profile_id()
       AND st.subject_id = p_subject_id
       AND st.class_id = p_class_id
       AND st.is_active = true
      WHERE e.id = p_exam_id
        AND e.teacher_id = public.current_staff_profile_id()
        AND e.institution_id = public.current_user_institution_id()
        AND e.subject_id = p_subject_id
        AND e.class_id = p_class_id
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.exam_assignments ea
            WHERE ea.exam_id = e.id AND ea.section_id IS NOT NULL
          )
          OR st.section_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.exam_assignments ea
            WHERE ea.exam_id = e.id
              AND ea.section_id = st.section_id
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.teacher_can_manage_question(p_question_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.current_user_role() = 'teacher'
    AND EXISTS (
      SELECT 1
      FROM public.questions q
      WHERE q.id = p_question_id
        AND q.institution_id = public.current_user_institution_id()
        AND (
          q.teacher_id = public.current_staff_profile_id()
          OR EXISTS (
            SELECT 1
            FROM public.exam_questions eq
            JOIN public.examify_exams e ON e.id = eq.exam_id
            WHERE eq.question_id = q.id
              AND public.teacher_can_manage_exam_scope(e.id, e.subject_id, e.class_id)
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.exam_question_scope_allowed(p_exam_id uuid, p_question_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.examify_exams e
    JOIN public.questions q ON q.id = p_question_id
    WHERE e.id = p_exam_id
      AND q.institution_id = e.institution_id
      AND (e.subject_id IS NULL OR q.subject_id = e.subject_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.set_exam_teacher_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.current_user_role() = 'teacher' THEN
    NEW.teacher_id := public.current_staff_profile_id();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_question_teacher_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.current_user_role() = 'teacher' THEN
    NEW.teacher_id := public.current_staff_profile_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_exam_teacher_owner ON public.examify_exams;
CREATE TRIGGER trg_set_exam_teacher_owner
BEFORE INSERT ON public.examify_exams
FOR EACH ROW EXECUTE FUNCTION public.set_exam_teacher_owner();

DROP TRIGGER IF EXISTS trg_set_question_teacher_owner ON public.questions;
CREATE TRIGGER trg_set_question_teacher_owner
BEFORE INSERT ON public.questions
FOR EACH ROW EXECUTE FUNCTION public.set_question_teacher_owner();

DROP POLICY IF EXISTS examify_exams_insert ON public.examify_exams;
CREATE POLICY examify_exams_insert ON public.examify_exams
FOR INSERT TO authenticated
WITH CHECK (
  institution_id = public.current_user_institution_id()
  AND (
    public.current_user_role() IN ('super_admin', 'school_admin')
    OR (
      public.current_user_role() = 'teacher'
      AND teacher_id = public.current_staff_profile_id()
      AND subject_id IS NOT NULL
      AND class_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.subject_teachers st
        WHERE st.teacher_id = public.current_staff_profile_id()
          AND st.subject_id = examify_exams.subject_id
          AND st.class_id = examify_exams.class_id
          AND st.is_active = true
      )
    )
  )
);

DROP POLICY IF EXISTS examify_exams_update ON public.examify_exams;
CREATE POLICY examify_exams_update ON public.examify_exams
FOR UPDATE TO authenticated
USING (
  public.current_user_role() IN ('super_admin', 'school_admin')
  AND institution_id = public.current_user_institution_id()
  OR public.teacher_can_manage_exam_scope(id, subject_id, class_id)
)
WITH CHECK (
  (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  )
  OR (
    public.teacher_can_manage_exam_scope(id, subject_id, class_id)
    AND teacher_id = public.current_staff_profile_id()
    AND institution_id = public.current_user_institution_id()
  )
);

DROP POLICY IF EXISTS examify_exams_delete ON public.examify_exams;
CREATE POLICY examify_exams_delete ON public.examify_exams
FOR DELETE TO authenticated
USING (
  public.current_user_role() IN ('super_admin', 'school_admin')
  AND institution_id = public.current_user_institution_id()
);

DROP POLICY IF EXISTS exam_questions_insert ON public.exam_questions;
CREATE POLICY exam_questions_insert ON public.exam_questions
FOR INSERT TO authenticated
WITH CHECK (
  public.exam_question_scope_allowed(exam_questions.exam_id, exam_questions.question_id)
  AND (
    public.current_user_role() IN ('super_admin', 'school_admin')
    OR EXISTS (
      SELECT 1 FROM public.examify_exams e
      WHERE e.id = exam_questions.exam_id
        AND public.teacher_can_manage_exam_scope(e.id, e.subject_id, e.class_id)
    )
  )
);

DROP POLICY IF EXISTS exam_questions_update ON public.exam_questions;
CREATE POLICY exam_questions_update ON public.exam_questions
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_questions.exam_id
      AND (
        (public.current_user_role() IN ('super_admin', 'school_admin') AND e.institution_id = public.current_user_institution_id())
        OR public.teacher_can_manage_exam_scope(e.id, e.subject_id, e.class_id)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_questions.exam_id
      AND (
        (public.current_user_role() IN ('super_admin', 'school_admin') AND e.institution_id = public.current_user_institution_id())
        OR public.teacher_can_manage_exam_scope(e.id, e.subject_id, e.class_id)
      )
  )
);

DROP POLICY IF EXISTS exam_questions_delete ON public.exam_questions;
CREATE POLICY exam_questions_delete ON public.exam_questions
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_questions.exam_id
      AND (
        (public.current_user_role() IN ('super_admin', 'school_admin') AND e.institution_id = public.current_user_institution_id())
        OR public.teacher_can_manage_exam_scope(e.id, e.subject_id, e.class_id)
      )
  )
);

DROP POLICY IF EXISTS questions_update ON public.questions;
CREATE POLICY questions_update ON public.questions
FOR UPDATE TO authenticated
USING (
  (public.current_user_role() IN ('super_admin', 'school_admin') AND institution_id = public.current_user_institution_id())
  OR public.teacher_can_manage_question(id)
)
WITH CHECK (
  (public.current_user_role() IN ('super_admin', 'school_admin') AND institution_id = public.current_user_institution_id())
  OR (public.teacher_can_manage_question(id) AND institution_id = public.current_user_institution_id())
);

DROP POLICY IF EXISTS question_options_insert ON public.question_options;
CREATE POLICY question_options_insert ON public.question_options
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = question_options.question_id
      AND (
        public.current_user_role() IN ('super_admin', 'school_admin')
        OR public.teacher_can_manage_question(q.id)
      )
  )
);

DROP POLICY IF EXISTS question_options_update ON public.question_options;
CREATE POLICY question_options_update ON public.question_options
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = question_options.question_id
      AND (
        (public.current_user_role() IN ('super_admin', 'school_admin') AND q.institution_id = public.current_user_institution_id())
        OR public.teacher_can_manage_question(q.id)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = question_options.question_id
      AND (
        (public.current_user_role() IN ('super_admin', 'school_admin') AND q.institution_id = public.current_user_institution_id())
        OR public.teacher_can_manage_question(q.id)
      )
  )
);

DROP POLICY IF EXISTS question_options_delete ON public.question_options;
CREATE POLICY question_options_delete ON public.question_options
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = question_options.question_id
      AND (
        (public.current_user_role() IN ('super_admin', 'school_admin') AND q.institution_id = public.current_user_institution_id())
        OR public.teacher_can_manage_question(q.id)
      )
  )
);

DROP POLICY IF EXISTS exam_assignments_insert ON public.exam_assignments;
CREATE POLICY exam_assignments_insert ON public.exam_assignments
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_assignments.exam_id
      AND (
        (public.current_user_role() IN ('super_admin', 'school_admin') AND e.institution_id = public.current_user_institution_id())
        OR public.teacher_can_manage_exam_scope(e.id, e.subject_id, e.class_id)
      )
  )
);

DROP POLICY IF EXISTS exam_assignments_delete ON public.exam_assignments;
CREATE POLICY exam_assignments_delete ON public.exam_assignments
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.examify_exams e
    WHERE e.id = exam_assignments.exam_id
      AND (
        (public.current_user_role() IN ('super_admin', 'school_admin') AND e.institution_id = public.current_user_institution_id())
        OR public.teacher_can_manage_exam_scope(e.id, e.subject_id, e.class_id)
      )
  )
);
