-- Allow the unauthenticated signup form to read active institution names.
GRANT SELECT ON TABLE public.institutions TO anon;
GRANT SELECT ON TABLE public.institutions TO authenticated;
