/*
  Complete SIS role permissions.

  school_admin manages SIS inside the institution. data_entry can create/update
  student and parent records but cannot manage subjects, grades, attendance, or
  institutions. teacher keeps read access to SIS data through existing SELECT
  policies but does not perform administrative SIS writes.
*/

DROP POLICY IF EXISTS "student_profiles_insert" ON public.student_profiles;
CREATE POLICY "student_profiles_insert" ON public.student_profiles FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "student_profiles_update" ON public.student_profiles;
CREATE POLICY "student_profiles_update" ON public.student_profiles FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "class_students_insert" ON public.class_students;
CREATE POLICY "class_students_insert" ON public.class_students FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_students.class_id
        AND c.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "class_students_update" ON public.class_students;
CREATE POLICY "class_students_update" ON public.class_students FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_students.class_id
        AND c.institution_id = public.current_user_institution_id()
    )
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_students.class_id
        AND c.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "class_students_delete" ON public.class_students;
CREATE POLICY "class_students_delete" ON public.class_students FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_students.class_id
        AND c.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "parent_profiles_insert" ON public.parent_profiles;
CREATE POLICY "parent_profiles_insert" ON public.parent_profiles FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "parent_profiles_update" ON public.parent_profiles;
CREATE POLICY "parent_profiles_update" ON public.parent_profiles FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "parent_student_links_insert" ON public.parent_student_links;
CREATE POLICY "parent_student_links_insert" ON public.parent_student_links FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      JOIN public.student_profiles sp ON sp.id = parent_student_links.student_id
      WHERE pp.id = parent_student_links.parent_id
        AND pp.institution_id = public.current_user_institution_id()
        AND sp.institution_id = pp.institution_id
    )
  );

DROP POLICY IF EXISTS "parent_student_links_update" ON public.parent_student_links;
CREATE POLICY "parent_student_links_update" ON public.parent_student_links FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      JOIN public.student_profiles sp ON sp.id = parent_student_links.student_id
      WHERE pp.id = parent_student_links.parent_id
        AND pp.institution_id = public.current_user_institution_id()
        AND sp.institution_id = pp.institution_id
    )
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      JOIN public.student_profiles sp ON sp.id = parent_student_links.student_id
      WHERE pp.id = parent_student_links.parent_id
        AND pp.institution_id = public.current_user_institution_id()
        AND sp.institution_id = pp.institution_id
    )
  );

DROP POLICY IF EXISTS "attendance_insert" ON public.attendance;
CREATE POLICY "attendance_insert" ON public.attendance FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "attendance_update" ON public.attendance;
CREATE POLICY "attendance_update" ON public.attendance FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "grade_book_insert" ON public.grade_book;
CREATE POLICY "grade_book_insert" ON public.grade_book FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "grade_book_update" ON public.grade_book;
CREATE POLICY "grade_book_update" ON public.grade_book FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );
