-- The initial bootstrap path is retained for migration compatibility, but is no
-- longer callable by browser or unauthenticated clients in an established deployment.
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.bootstrap_first_admin() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.can_bootstrap_first_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_bootstrap_first_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_bootstrap_first_admin() FROM authenticated;
