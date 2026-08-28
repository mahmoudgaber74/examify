CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    nullif((auth.jwt() -> 'raw_app_meta_data' ->> 'role')::text, ''),
    (SELECT sp.role FROM public.staff_profiles sp WHERE sp.user_id = auth.uid() AND sp.is_active LIMIT 1),
    CASE WHEN EXISTS (SELECT 1 FROM public.student_profiles st WHERE st.user_id = auth.uid() AND st.is_active) THEN 'student' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.parent_profiles pp WHERE pp.user_id = auth.uid() AND pp.is_active) THEN 'parent' END,
    'anonymous'
  );
$$;
