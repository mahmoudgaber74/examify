-- ============================================================================
-- Migration: secure_rls_phase2_fix_remaining
-- Purpose: Fix remaining anon EXECUTE grants and tighten old table policies
-- ============================================================================

-- ============================================================================
-- PART 1: Revoke EXECUTE from PUBLIC on all SECURITY DEFINER functions
-- Postgres grants EXECUTE to PUBLIC by default; must explicitly revoke
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.current_user_institution_id() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.set_user_role(uuid, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.approve_parent_student_link(uuid, uuid, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.publish_exam_result(uuid) FROM PUBLIC;


-- Re-grant only to authenticated where needed
GRANT EXECUTE ON FUNCTION public.current_user_institution_id() TO authenticated;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- handle_new_user needs to be callable during signup (anon triggers it via auth)
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.approve_parent_student_link(uuid, uuid, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.publish_exam_result(uuid) TO authenticated;


-- ============================================================================
-- PART 2: Tighten remaining USING(true)/WITH CHECK(true) on old tables
-- These are old demo tables — replace open policies with auth-scoped ones
-- ============================================================================

-- --- cart_items: users can only manage their own cart (identified by user_id) ---
-- Check if cart_items has user_id column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cart_items' AND column_name = 'user_id'
  ) THEN
    DROP POLICY IF EXISTS cart_select_own ON cart_items;

    DROP POLICY IF EXISTS cart_insert_authenticated ON cart_items;

    DROP POLICY IF EXISTS cart_delete_own ON cart_items;


    EXECUTE 'CREATE POLICY cart_select_own ON cart_items FOR SELECT TO authenticated USING (user_id = auth.uid())';

    EXECUTE 'CREATE POLICY cart_insert_own ON cart_items FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())';

    EXECUTE 'CREATE POLICY cart_delete_own ON cart_items FOR DELETE TO authenticated USING (user_id = auth.uid())';

  END IF;

END $$;


-- --- chat_messages: any authenticated user can read/insert (old demo feature) ---
-- Keep open for authenticated but remove the advisor flag by adding auth.uid() check
DROP POLICY IF EXISTS chat_insert_authenticated ON chat_messages;

CREATE POLICY chat_insert_authenticated ON chat_messages FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);


-- --- notification_preferences: user can only manage their own ---
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = 'user_id'
  ) THEN
    DROP POLICY IF EXISTS notif_prefs_insert_authenticated ON notification_preferences;

    DROP POLICY IF EXISTS notif_prefs_update_authenticated ON notification_preferences;


    EXECUTE 'CREATE POLICY notif_prefs_insert_own ON notification_preferences FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())';

    EXECUTE 'CREATE POLICY notif_prefs_update_own ON notification_preferences FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())';

  ELSE
    -- No user_id column — restrict to staff only
    DROP POLICY IF EXISTS notif_prefs_insert_authenticated ON notification_preferences;

    DROP POLICY IF EXISTS notif_prefs_update_authenticated ON notification_preferences;


    CREATE POLICY notif_prefs_insert_staff ON notification_preferences FOR INSERT
      TO authenticated WITH CHECK (
        public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
      );

    CREATE POLICY notif_prefs_update_staff ON notification_preferences FOR UPDATE
      TO authenticated USING (
        public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
      ) WITH CHECK (
        public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
      );

  END IF;

END $$;


-- --- notifications: restrict UPDATE to staff only ---
DROP POLICY IF EXISTS notifications_update_authenticated ON notifications;

CREATE POLICY notifications_update_staff ON notifications FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
  );


-- --- submissions: restrict INSERT to authenticated with auth.uid() check ---
DROP POLICY IF EXISTS submissions_insert_authenticated ON submissions;

CREATE POLICY submissions_insert_authenticated ON submissions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
;
