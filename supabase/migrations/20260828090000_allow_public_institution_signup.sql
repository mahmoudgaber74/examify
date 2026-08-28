/* The signup form needs to read only active institution names before login. */
DROP POLICY IF EXISTS "institutions_public_signup_select" ON public.institutions;
CREATE POLICY "institutions_public_signup_select" ON public.institutions
  FOR SELECT TO anon USING (is_active = true);
