CREATE OR REPLACE FUNCTION public.can_bootstrap_first_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.staff_profiles WHERE role = 'super_admin');
$$;

GRANT EXECUTE ON FUNCTION public.can_bootstrap_first_admin() TO anon, authenticated;
