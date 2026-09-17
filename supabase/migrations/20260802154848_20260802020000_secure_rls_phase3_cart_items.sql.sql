-- ============================================================================
-- Migration: secure_rls_phase3_cart_items
-- Purpose: Fix cart_items policies (no user_id column — restrict to staff)
-- ============================================================================

-- cart_items has no user_id column — restrict all operations to authenticated staff
DROP POLICY IF EXISTS cart_select_own ON cart_items;

DROP POLICY IF EXISTS cart_insert_authenticated ON cart_items;

DROP POLICY IF EXISTS cart_delete_own ON cart_items;


CREATE POLICY cart_select_authenticated ON cart_items FOR SELECT
  TO authenticated USING (true);


CREATE POLICY cart_insert_staff ON cart_items FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
  );


CREATE POLICY cart_delete_staff ON cart_items FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
  );
;
