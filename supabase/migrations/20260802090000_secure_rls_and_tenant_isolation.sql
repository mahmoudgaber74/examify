/*
  Critical security hardening for legacy Examify tables.

  Non-destructive by design:
  - no DROP TABLE
  - no data deletion
  - tenant/owner columns are nullable for legacy rows
  - legacy open anon policies are replaced in the same migration
*/

-- Harden helper functions used by policies.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN 'anonymous'
    WHEN EXISTS (
      SELECT 1 FROM public.staff_profiles
      WHERE user_id = auth.uid() AND is_active = true
    ) THEN (
      SELECT role FROM public.staff_profiles
      WHERE user_id = auth.uid() AND is_active = true
      LIMIT 1
    )
    WHEN EXISTS (
      SELECT 1 FROM public.student_profiles
      WHERE user_id = auth.uid() AND is_active = true
    ) THEN 'student'
    WHEN EXISTS (
      SELECT 1 FROM public.parent_profiles
      WHERE user_id = auth.uid() AND is_active = true
    ) THEN 'parent'
    ELSE 'anonymous'
  END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_institution_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL::uuid
    WHEN EXISTS (
      SELECT 1 FROM public.staff_profiles
      WHERE user_id = auth.uid() AND is_active = true
    ) THEN (
      SELECT institution_id FROM public.staff_profiles
      WHERE user_id = auth.uid() AND is_active = true
      LIMIT 1
    )
    WHEN EXISTS (
      SELECT 1 FROM public.student_profiles
      WHERE user_id = auth.uid() AND is_active = true
    ) THEN (
      SELECT institution_id FROM public.student_profiles
      WHERE user_id = auth.uid() AND is_active = true
      LIMIT 1
    )
    WHEN EXISTS (
      SELECT 1 FROM public.parent_profiles
      WHERE user_id = auth.uid() AND is_active = true
    ) THEN (
      SELECT institution_id FROM public.parent_profiles
      WHERE user_id = auth.uid() AND is_active = true
      LIMIT 1
    )
    ELSE NULL::uuid
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() = 'super_admin';
$$;

-- No public anon policies are allowed after phase-one hardening.
DROP POLICY IF EXISTS "institutions_public_signup_select" ON public.institutions;

-- Authenticated users need table privileges before RLS policies can authorize legitimate app operations.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_current_institution()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry');
$$;

CREATE OR REPLACE FUNCTION public.can_grade_current_institution()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader');
$$;

-- Add non-breaking tenant/owner columns to legacy/demo tables.
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_students_user_id ON public.students(user_id);
CREATE INDEX IF NOT EXISTS idx_students_institution_id ON public.students(institution_id);

ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_exams_institution_id ON public.exams(institution_id);
CREATE INDEX IF NOT EXISTS idx_exams_created_by ON public.exams(created_by);

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_courses_institution_id ON public.courses(institution_id);
CREATE INDEX IF NOT EXISTS idx_courses_created_by ON public.courses(created_by);

ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS issued_to_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_certificates_institution_id ON public.certificates(institution_id);
CREATE INDEX IF NOT EXISTS idx_certificates_issued_to_user_id ON public.certificates(issued_to_user_id);

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS student_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS grader_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_submissions_institution_id ON public.submissions(institution_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student_user_id ON public.submissions(student_user_id);

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL DEFAULT public.current_user_institution_id();
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON public.chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_institution_id ON public.chat_messages(institution_id);

ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS idx_cart_items_user_id ON public.cart_items(user_id);

ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_parents_user_id ON public.parents(user_id);
CREATE INDEX IF NOT EXISTS idx_parents_institution_id ON public.parents(institution_id);

ALTER TABLE public.parent_students ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_parent_students_institution_id ON public.parent_students(institution_id);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_institution_id ON public.notifications(institution_id);

ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notification_preferences_institution_id ON public.notification_preferences(institution_id);

-- Ensure RLS remains enabled on every legacy sensitive table.
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Remove all legacy open anon policies.
DROP POLICY IF EXISTS "anon_select_students" ON public.students;
DROP POLICY IF EXISTS "anon_insert_students" ON public.students;
DROP POLICY IF EXISTS "anon_update_students" ON public.students;
DROP POLICY IF EXISTS "anon_delete_students" ON public.students;
DROP POLICY IF EXISTS "anon_select_exams" ON public.exams;
DROP POLICY IF EXISTS "anon_insert_exams" ON public.exams;
DROP POLICY IF EXISTS "anon_update_exams" ON public.exams;
DROP POLICY IF EXISTS "anon_delete_exams" ON public.exams;
DROP POLICY IF EXISTS "anon_select_courses" ON public.courses;
DROP POLICY IF EXISTS "anon_insert_courses" ON public.courses;
DROP POLICY IF EXISTS "anon_update_courses" ON public.courses;
DROP POLICY IF EXISTS "anon_delete_courses" ON public.courses;
DROP POLICY IF EXISTS "anon_select_certificates" ON public.certificates;
DROP POLICY IF EXISTS "anon_insert_certificates" ON public.certificates;
DROP POLICY IF EXISTS "anon_update_certificates" ON public.certificates;
DROP POLICY IF EXISTS "anon_delete_certificates" ON public.certificates;
DROP POLICY IF EXISTS "anon_select_submissions" ON public.submissions;
DROP POLICY IF EXISTS "anon_insert_submissions" ON public.submissions;
DROP POLICY IF EXISTS "anon_update_submissions" ON public.submissions;
DROP POLICY IF EXISTS "anon_delete_submissions" ON public.submissions;
DROP POLICY IF EXISTS "anon_select_chat" ON public.chat_messages;
DROP POLICY IF EXISTS "anon_insert_chat" ON public.chat_messages;
DROP POLICY IF EXISTS "anon_delete_chat" ON public.chat_messages;
DROP POLICY IF EXISTS "anon_select_cart" ON public.cart_items;
DROP POLICY IF EXISTS "anon_insert_cart" ON public.cart_items;
DROP POLICY IF EXISTS "anon_delete_cart" ON public.cart_items;
DROP POLICY IF EXISTS "anon_select_parents" ON public.parents;
DROP POLICY IF EXISTS "anon_insert_parents" ON public.parents;
DROP POLICY IF EXISTS "anon_update_parents" ON public.parents;
DROP POLICY IF EXISTS "anon_delete_parents" ON public.parents;
DROP POLICY IF EXISTS "anon_select_parent_students" ON public.parent_students;
DROP POLICY IF EXISTS "anon_insert_parent_students" ON public.parent_students;
DROP POLICY IF EXISTS "anon_update_parent_students" ON public.parent_students;
DROP POLICY IF EXISTS "anon_delete_parent_students" ON public.parent_students;
DROP POLICY IF EXISTS "anon_select_notifications" ON public.notifications;
DROP POLICY IF EXISTS "anon_insert_notifications" ON public.notifications;
DROP POLICY IF EXISTS "anon_update_notifications" ON public.notifications;
DROP POLICY IF EXISTS "anon_delete_notifications" ON public.notifications;
DROP POLICY IF EXISTS "anon_select_notification_preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "anon_insert_notification_preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "anon_update_notification_preferences" ON public.notification_preferences;
DROP POLICY IF EXISTS "anon_delete_notification_preferences" ON public.notification_preferences;

-- Harden audit logs: authenticated users may only append records for themselves
-- and their current institution; update/delete remain unavailable through RLS.
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_update" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_delete" ON public.audit_log;
DROP POLICY IF EXISTS "secure_audit_log_insert" ON public.audit_log;
CREATE POLICY "secure_audit_log_insert" ON public.audit_log FOR INSERT
  TO authenticated WITH CHECK (
    actor_id = auth.uid()
    AND (
      public.is_super_admin()
      OR institution_id = public.current_user_institution_id()
    )
  );

-- Legacy students.
DROP POLICY IF EXISTS "secure_students_select" ON public.students;
CREATE POLICY "secure_students_select" ON public.students FOR SELECT
  TO authenticated USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (institution_id IS NOT NULL AND institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_students_insert" ON public.students;
CREATE POLICY "secure_students_insert" ON public.students FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND (institution_id IS NULL OR public.is_super_admin() OR institution_id = public.current_user_institution_id())
    AND (user_id IS NULL OR public.current_user_role() IN ('super_admin', 'school_admin'))
  );

DROP POLICY IF EXISTS "secure_students_update" ON public.students;
CREATE POLICY "secure_students_update" ON public.students FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_students_delete" ON public.students;
CREATE POLICY "secure_students_delete" ON public.students FOR DELETE
  TO authenticated USING (public.is_super_admin());

-- Legacy exams/courses use institution ownership when present.
DROP POLICY IF EXISTS "secure_exams_select" ON public.exams;
CREATE POLICY "secure_exams_select" ON public.exams FOR SELECT
  TO authenticated USING (
    public.is_super_admin()
    OR created_by = auth.uid()
    OR (institution_id IS NOT NULL AND institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_exams_insert" ON public.exams;
CREATE POLICY "secure_exams_insert" ON public.exams FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND (institution_id IS NULL OR public.is_super_admin() OR institution_id = public.current_user_institution_id())
    AND (created_by IS NULL OR created_by = auth.uid() OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "secure_exams_update" ON public.exams;
CREATE POLICY "secure_exams_update" ON public.exams FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND (public.is_super_admin() OR created_by = auth.uid() OR institution_id = public.current_user_institution_id())
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND (public.is_super_admin() OR created_by = auth.uid() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_exams_delete" ON public.exams;
CREATE POLICY "secure_exams_delete" ON public.exams FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_courses_select" ON public.courses;
CREATE POLICY "secure_courses_select" ON public.courses FOR SELECT
  TO authenticated USING (
    public.is_super_admin()
    OR created_by = auth.uid()
    OR institution_id IS NULL
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "secure_courses_insert" ON public.courses;
CREATE POLICY "secure_courses_insert" ON public.courses FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND (institution_id IS NULL OR public.is_super_admin() OR institution_id = public.current_user_institution_id())
    AND (created_by IS NULL OR created_by = auth.uid() OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "secure_courses_update" ON public.courses;
CREATE POLICY "secure_courses_update" ON public.courses FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND (public.is_super_admin() OR created_by = auth.uid() OR institution_id = public.current_user_institution_id())
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND (public.is_super_admin() OR created_by = auth.uid() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_courses_delete" ON public.courses;
CREATE POLICY "secure_courses_delete" ON public.courses FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

-- Certificates are private except for authenticated owners/admins; public verification should use a minimal RPC later.
DROP POLICY IF EXISTS "secure_certificates_select" ON public.certificates;
CREATE POLICY "secure_certificates_select" ON public.certificates FOR SELECT
  TO authenticated USING (
    public.is_super_admin()
    OR issued_to_user_id = auth.uid()
    OR issued_by = auth.uid()
    OR (institution_id IS NOT NULL AND institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_certificates_insert" ON public.certificates;
CREATE POLICY "secure_certificates_insert" ON public.certificates FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND (institution_id IS NULL OR public.is_super_admin() OR institution_id = public.current_user_institution_id())
    AND (issued_by IS NULL OR issued_by = auth.uid() OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "secure_certificates_update" ON public.certificates;
CREATE POLICY "secure_certificates_update" ON public.certificates FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_certificates_delete" ON public.certificates;
CREATE POLICY "secure_certificates_delete" ON public.certificates FOR DELETE
  TO authenticated USING (public.is_super_admin());

-- Legacy grading/tutor/cart tables.
DROP POLICY IF EXISTS "secure_submissions_select" ON public.submissions;
CREATE POLICY "secure_submissions_select" ON public.submissions FOR SELECT
  TO authenticated USING (
    public.can_grade_current_institution()
    AND (public.is_super_admin() OR institution_id IS NULL OR institution_id = public.current_user_institution_id())
    OR student_user_id = auth.uid()
    OR grader_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "secure_submissions_insert" ON public.submissions;
CREATE POLICY "secure_submissions_insert" ON public.submissions FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND (institution_id IS NULL OR public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_submissions_update" ON public.submissions;
CREATE POLICY "secure_submissions_update" ON public.submissions FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND (public.is_super_admin() OR institution_id IS NULL OR institution_id = public.current_user_institution_id() OR grader_user_id = auth.uid())
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND (public.is_super_admin() OR institution_id IS NULL OR institution_id = public.current_user_institution_id() OR grader_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "secure_submissions_delete" ON public.submissions;
CREATE POLICY "secure_submissions_delete" ON public.submissions FOR DELETE
  TO authenticated USING (public.is_super_admin());

DROP POLICY IF EXISTS "secure_chat_select" ON public.chat_messages;
CREATE POLICY "secure_chat_select" ON public.chat_messages FOR SELECT
  TO authenticated USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "secure_chat_insert" ON public.chat_messages;
CREATE POLICY "secure_chat_insert" ON public.chat_messages FOR INSERT
  TO authenticated WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND (institution_id IS NULL OR institution_id = public.current_user_institution_id() OR public.is_super_admin())
  );

DROP POLICY IF EXISTS "secure_chat_delete" ON public.chat_messages;
CREATE POLICY "secure_chat_delete" ON public.chat_messages FOR DELETE
  TO authenticated USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "secure_cart_select" ON public.cart_items;
CREATE POLICY "secure_cart_select" ON public.cart_items FOR SELECT
  TO authenticated USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "secure_cart_insert" ON public.cart_items;
CREATE POLICY "secure_cart_insert" ON public.cart_items FOR INSERT
  TO authenticated WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "secure_cart_delete" ON public.cart_items;
CREATE POLICY "secure_cart_delete" ON public.cart_items FOR DELETE
  TO authenticated USING (user_id = auth.uid() OR public.is_super_admin());

-- Legacy parent tables.
DROP POLICY IF EXISTS "secure_parents_select" ON public.parents;
CREATE POLICY "secure_parents_select" ON public.parents FOR SELECT
  TO authenticated USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (institution_id IS NOT NULL AND institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'teacher', 'data_entry'))
  );

DROP POLICY IF EXISTS "secure_parents_insert" ON public.parents;
CREATE POLICY "secure_parents_insert" ON public.parents FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND (institution_id IS NULL OR public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_parents_update" ON public.parents;
CREATE POLICY "secure_parents_update" ON public.parents FOR UPDATE
  TO authenticated USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'teacher', 'data_entry'))
  ) WITH CHECK (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (institution_id = public.current_user_institution_id() AND public.current_user_role() IN ('school_admin', 'teacher', 'data_entry'))
  );

DROP POLICY IF EXISTS "secure_parents_delete" ON public.parents;
CREATE POLICY "secure_parents_delete" ON public.parents FOR DELETE
  TO authenticated USING (public.is_super_admin());

DROP POLICY IF EXISTS "secure_parent_students_select" ON public.parent_students;
CREATE POLICY "secure_parent_students_select" ON public.parent_students FOR SELECT
  TO authenticated USING (
    public.is_super_admin()
    OR institution_id = public.current_user_institution_id()
    OR EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = parent_students.parent_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "secure_parent_students_insert" ON public.parent_students;
CREATE POLICY "secure_parent_students_insert" ON public.parent_students FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND (institution_id IS NULL OR public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_parent_students_update" ON public.parent_students;
CREATE POLICY "secure_parent_students_update" ON public.parent_students FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_parent_students_delete" ON public.parent_students;
CREATE POLICY "secure_parent_students_delete" ON public.parent_students FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_notifications_select" ON public.notifications;
CREATE POLICY "secure_notifications_select" ON public.notifications FOR SELECT
  TO authenticated USING (
    public.is_super_admin()
    OR institution_id = public.current_user_institution_id()
    OR EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = notifications.parent_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "secure_notifications_insert" ON public.notifications;
CREATE POLICY "secure_notifications_insert" ON public.notifications FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader', 'data_entry')
    AND (institution_id IS NULL OR public.is_super_admin() OR institution_id = public.current_user_institution_id())
  );

DROP POLICY IF EXISTS "secure_notifications_update" ON public.notifications;
CREATE POLICY "secure_notifications_update" ON public.notifications FOR UPDATE
  TO authenticated USING (
    public.is_super_admin()
    OR institution_id = public.current_user_institution_id()
    OR EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = notifications.parent_id AND p.user_id = auth.uid()
    )
  ) WITH CHECK (
    public.is_super_admin()
    OR institution_id = public.current_user_institution_id()
    OR EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = notifications.parent_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "secure_notifications_delete" ON public.notifications;
CREATE POLICY "secure_notifications_delete" ON public.notifications FOR DELETE
  TO authenticated USING (public.is_super_admin());

DROP POLICY IF EXISTS "secure_notification_preferences_select" ON public.notification_preferences;
CREATE POLICY "secure_notification_preferences_select" ON public.notification_preferences FOR SELECT
  TO authenticated USING (
    public.is_super_admin()
    OR institution_id = public.current_user_institution_id()
    OR EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = notification_preferences.parent_id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "secure_notification_preferences_insert" ON public.notification_preferences;
CREATE POLICY "secure_notification_preferences_insert" ON public.notification_preferences FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = notification_preferences.parent_id AND p.user_id = auth.uid()
    )
    OR (
      public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
      AND (institution_id IS NULL OR public.is_super_admin() OR institution_id = public.current_user_institution_id())
    )
  );

DROP POLICY IF EXISTS "secure_notification_preferences_update" ON public.notification_preferences;
CREATE POLICY "secure_notification_preferences_update" ON public.notification_preferences FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = notification_preferences.parent_id AND p.user_id = auth.uid()
    )
    OR (
      public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
      AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = notification_preferences.parent_id AND p.user_id = auth.uid()
    )
    OR (
      public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
      AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
    )
  );

DROP POLICY IF EXISTS "secure_notification_preferences_delete" ON public.notification_preferences;
CREATE POLICY "secure_notification_preferences_delete" ON public.notification_preferences FOR DELETE
  TO authenticated USING (public.is_super_admin());

-- Storage tables are owned by Supabase internal roles during CLI reset.
-- The local reset role cannot create storage.objects policies here.
