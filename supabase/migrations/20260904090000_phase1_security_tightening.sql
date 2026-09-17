/* Phase 1: close remaining legacy anonymous access and nullable-tenant leaks. */

REVOKE ALL ON TABLE public.students, public.exams, public.courses,
  public.certificates, public.submissions, public.chat_messages,
  public.cart_items, public.parents, public.parent_students,
  public.notifications, public.notification_preferences FROM anon;

-- These policies were created by legacy migrations. Keep the old migrations
-- replayable, but ensure a fresh/upgrade state cannot retain them.
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

-- A null tenant is legacy data, not a reason to expose it to every tenant.
DROP POLICY IF EXISTS "secure_courses_select" ON public.courses;
CREATE POLICY "secure_courses_select" ON public.courses FOR SELECT TO authenticated USING (
  public.is_super_admin() OR created_by = auth.uid()
  OR (institution_id IS NOT NULL AND institution_id = public.current_user_institution_id())
);
DROP POLICY IF EXISTS "secure_submissions_select" ON public.submissions;
CREATE POLICY "secure_submissions_select" ON public.submissions FOR SELECT TO authenticated USING (
  student_user_id = auth.uid() OR grader_user_id = auth.uid()
  OR (public.can_grade_current_institution() AND institution_id IS NOT NULL
      AND institution_id = public.current_user_institution_id())
  OR public.is_super_admin()
);
DROP POLICY IF EXISTS "secure_submissions_insert" ON public.submissions;
CREATE POLICY "secure_submissions_insert" ON public.submissions FOR INSERT TO authenticated WITH CHECK (
  public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
  AND (public.is_super_admin() OR institution_id = public.current_user_institution_id())
);
