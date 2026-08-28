/*
# Harden self registration bootstrap

The signup screen needs a limited public institution list so non-admin users can
join an existing institution, and so first-user bootstrap is not inferred from a
query blocked by RLS.
*/

DROP POLICY IF EXISTS "institutions_public_signup_select" ON institutions;
CREATE POLICY "institutions_public_signup_select" ON institutions FOR SELECT
  TO anon USING (is_active = true);
