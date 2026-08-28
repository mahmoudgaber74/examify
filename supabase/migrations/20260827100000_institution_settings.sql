-- Persist institution preferences used by the Settings screen.
ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.institutions.settings IS 'Institution-level preferences such as domain, timezone, language, academic year and brand color.';
