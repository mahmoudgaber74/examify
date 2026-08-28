/*
  Harden role-based RLS for student, parent, grade, and question visibility.

  The previous tenant-wide predicates were correct for staff workflows, but too
  broad for student and parent accounts that share an institution with other
  learners. These policies keep staff institution access while narrowing student
  and parent access to owned or linked records.
*/

DROP POLICY IF EXISTS "student_profiles_select" ON public.student_profiles;
CREATE POLICY "student_profiles_select" ON public.student_profiles FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (
      public.current_user_role() IN ('school_admin', 'teacher', 'grader', 'data_entry')
      AND institution_id = public.current_user_institution_id()
    )
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.parent_student_links psl
      JOIN public.parent_profiles pp ON pp.id = psl.parent_id
      WHERE pp.user_id = auth.uid()
        AND pp.is_active = true
        AND psl.student_id = student_profiles.id
    )
  );

DROP POLICY IF EXISTS "parent_profiles_select" ON public.parent_profiles;
CREATE POLICY "parent_profiles_select" ON public.parent_profiles FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (
      public.current_user_role() IN ('school_admin', 'teacher', 'data_entry')
      AND institution_id = public.current_user_institution_id()
    )
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "parent_student_links_select" ON public.parent_student_links;
CREATE POLICY "parent_student_links_select" ON public.parent_student_links FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
        AND pp.institution_id = public.current_user_institution_id()
        AND public.current_user_role() IN ('school_admin', 'teacher', 'data_entry')
    )
    OR EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
        AND pp.user_id = auth.uid()
        AND pp.is_active = true
    )
  );

DROP POLICY IF EXISTS "class_students_select" ON public.class_students;
CREATE POLICY "class_students_select" ON public.class_students FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1
      FROM public.classes c
      WHERE c.id = class_students.class_id
        AND c.institution_id = public.current_user_institution_id()
        AND public.current_user_role() IN ('school_admin', 'teacher', 'grader', 'data_entry')
    )
    OR EXISTS (
      SELECT 1
      FROM public.student_profiles sp
      WHERE sp.id = class_students.student_id
        AND sp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.parent_student_links psl
      JOIN public.parent_profiles pp ON pp.id = psl.parent_id
      WHERE pp.user_id = auth.uid()
        AND pp.is_active = true
        AND psl.student_id = class_students.student_id
    )
  );

DROP POLICY IF EXISTS "grade_book_select" ON public.grade_book;
CREATE POLICY "grade_book_select" ON public.grade_book FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (
      public.current_user_role() IN ('school_admin', 'teacher', 'grader')
      AND institution_id = public.current_user_institution_id()
    )
    OR EXISTS (
      SELECT 1
      FROM public.student_profiles sp
      WHERE sp.id = grade_book.student_id
        AND sp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.parent_student_links psl
      JOIN public.parent_profiles pp ON pp.id = psl.parent_id
      WHERE pp.user_id = auth.uid()
        AND pp.is_active = true
        AND psl.student_id = grade_book.student_id
        AND psl.can_view_grades = true
    )
  );

DROP POLICY IF EXISTS "questions_select" ON public.questions;
CREATE POLICY "questions_select" ON public.questions FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR is_public = true
    OR (
      public.current_user_role() IN ('school_admin', 'teacher', 'grader')
      AND institution_id = public.current_user_institution_id()
    )
    OR (
      public.current_user_role() = 'student'
      AND institution_id = public.current_user_institution_id()
      AND EXISTS (
        SELECT 1
        FROM public.exam_questions eq
        JOIN public.examify_exams e ON e.id = eq.exam_id
        WHERE eq.question_id = questions.id
          AND e.status = 'published'
          AND (e.start_at IS NULL OR e.start_at <= now())
          AND (e.end_at IS NULL OR e.end_at >= now())
          AND public.is_exam_assigned_to_current_student(e.id)
      )
    )
  );

DROP POLICY IF EXISTS "question_options_select" ON public.question_options;
CREATE POLICY "question_options_select" ON public.question_options FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.questions q
      WHERE q.id = question_options.question_id
        AND (
          public.current_user_role() = 'super_admin'
          OR q.is_public = true
          OR (
            public.current_user_role() IN ('school_admin', 'teacher', 'grader')
            AND q.institution_id = public.current_user_institution_id()
          )
          OR (
            public.current_user_role() = 'student'
            AND q.institution_id = public.current_user_institution_id()
            AND EXISTS (
              SELECT 1
              FROM public.exam_questions eq
              JOIN public.examify_exams e ON e.id = eq.exam_id
              WHERE eq.question_id = q.id
                AND e.status = 'published'
                AND (e.start_at IS NULL OR e.start_at <= now())
                AND (e.end_at IS NULL OR e.end_at >= now())
                AND public.is_exam_assigned_to_current_student(e.id)
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS "exam_attempts_select" ON public.exam_attempts;
CREATE POLICY "exam_attempts_select" ON public.exam_attempts FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1
      FROM public.examify_exams e
      WHERE e.id = exam_attempts.exam_id
        AND e.institution_id = public.current_user_institution_id()
        AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1
      FROM public.student_profiles sp
      WHERE sp.id = exam_attempts.student_id
        AND sp.user_id = auth.uid()
        AND (
          exam_attempts.status = 'in_progress'
          OR exam_attempts.is_result_published = true
        )
    )
  );

DROP POLICY IF EXISTS "answers_select" ON public.answers;
CREATE POLICY "answers_select" ON public.answers FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1
      FROM public.exam_attempts ea
      JOIN public.examify_exams e ON e.id = ea.exam_id
      WHERE ea.id = answers.attempt_id
        AND e.institution_id = public.current_user_institution_id()
        AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1
      FROM public.exam_attempts ea
      JOIN public.student_profiles sp ON sp.id = ea.student_id
      WHERE ea.id = answers.attempt_id
        AND sp.user_id = auth.uid()
        AND (
          ea.status = 'in_progress'
          OR ea.is_result_published = true
        )
    )
  );
