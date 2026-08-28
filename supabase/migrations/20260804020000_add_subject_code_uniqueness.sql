/*
  Keep subject codes unique inside each institution when existing data allows it.
  The partial expression index ignores null/blank codes and does not rewrite
  existing rows. If duplicates already exist, the migration keeps running and
  leaves validation to the application until the data is cleaned.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.subjects
    WHERE code IS NOT NULL AND btrim(code) <> ''
    GROUP BY institution_id, upper(btrim(code))
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS subjects_institution_code_unique
      ON public.subjects (institution_id, upper(btrim(code)))
      WHERE code IS NOT NULL AND btrim(code) <> '';
  ELSE
    RAISE NOTICE 'Skipped subjects_institution_code_unique because duplicate subject codes already exist.';
  END IF;
END $$;
