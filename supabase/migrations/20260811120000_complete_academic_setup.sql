/*
  Complete academic setup without removing legacy data.

  Canonical model:
  institutions -> branches -> academic_years -> education_stages
  -> grade_levels -> classes -> sections, with grade_subjects and
  subject_teachers assignments.
*/

CREATE TABLE IF NOT EXISTS public.academic_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academic_years_date_check CHECK (end_date > start_date)
);

CREATE TABLE IF NOT EXISTS public.education_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.grade_levels
  ADD COLUMN IF NOT EXISTS education_stage_id uuid REFERENCES public.education_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS capacity integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.sections
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.grade_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  grade_level_id uuid NOT NULL REFERENCES public.grade_levels(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  is_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subject_teachers
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grade_level_id uuid REFERENCES public.grade_levels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.subject_teachers
  DROP CONSTRAINT IF EXISTS subject_teachers_subject_id_class_id_teacher_id_key;

ALTER TABLE public.class_students
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grade_level_id uuid REFERENCES public.grade_levels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS seat_number text,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.class_students
  DROP CONSTRAINT IF EXISTS class_students_class_id_student_id_key;

ALTER TABLE public.class_students
  ADD CONSTRAINT class_students_status_check
  CHECK (status IN ('active', 'transferred', 'completed', 'archived')) NOT VALID;

INSERT INTO public.academic_years (institution_id, name, start_date, end_date, is_current, is_active)
SELECT DISTINCT
  c.institution_id,
  c.academic_year,
  CASE
    WHEN c.academic_year ~ '^[0-9]{4}[-/][0-9]{4}$'
      THEN (substring(c.academic_year from 1 for 4) || '-09-01')::date
    ELSE date_trunc('year', now())::date
  END,
  CASE
    WHEN c.academic_year ~ '^[0-9]{4}[-/][0-9]{4}$'
      THEN (substring(c.academic_year from 6 for 4) || '-06-30')::date
    ELSE (date_trunc('year', now()) + interval '1 year' - interval '1 day')::date
  END,
  false,
  true
FROM public.classes c
WHERE c.academic_year IS NOT NULL AND btrim(c.academic_year) <> ''
ON CONFLICT DO NOTHING;

UPDATE public.classes c
SET academic_year_id = ay.id
FROM public.academic_years ay
WHERE c.academic_year_id IS NULL
  AND ay.institution_id = c.institution_id
  AND ay.name = c.academic_year;

UPDATE public.subject_teachers st
SET institution_id = sp.institution_id,
    academic_year_id = c.academic_year_id,
    grade_level_id = c.grade_level_id
FROM public.staff_profiles sp, public.classes c
WHERE st.teacher_id = sp.id
  AND st.class_id = c.id
  AND st.institution_id IS NULL;

UPDATE public.class_students cs
SET institution_id = c.institution_id,
    academic_year_id = c.academic_year_id,
    grade_level_id = c.grade_level_id,
    seat_number = COALESCE(cs.seat_number, sp.seat_number)
FROM public.classes c, public.student_profiles sp
WHERE cs.class_id = c.id
  AND cs.student_id = sp.id
  AND cs.institution_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS academic_years_institution_name_unique
  ON public.academic_years(institution_id, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current_per_institution
  ON public.academic_years(institution_id)
  WHERE is_current;

CREATE UNIQUE INDEX IF NOT EXISTS education_stages_institution_name_unique
  ON public.education_stages(institution_id, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS education_stages_institution_code_unique
  ON public.education_stages(institution_id, lower(btrim(code)))
  WHERE code IS NOT NULL AND btrim(code) <> '';

DROP INDEX IF EXISTS grade_levels_institution_name_unique;
CREATE UNIQUE INDEX IF NOT EXISTS grade_levels_stage_name_unique
  ON public.grade_levels(
    institution_id,
    COALESCE(education_stage_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  );

CREATE UNIQUE INDEX IF NOT EXISTS grade_subjects_scope_unique
  ON public.grade_subjects(
    institution_id,
    academic_year_id,
    grade_level_id,
    subject_id,
    COALESCE(class_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE UNIQUE INDEX IF NOT EXISTS subject_teachers_scope_unique
  ON public.subject_teachers(
    subject_id,
    class_id,
    teacher_id,
    COALESCE(academic_year_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(section_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE UNIQUE INDEX IF NOT EXISTS class_students_one_active_year
  ON public.class_students(student_id, academic_year_id)
  WHERE status = 'active' AND academic_year_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS class_students_year_seat_unique
  ON public.class_students(institution_id, academic_year_id, lower(btrim(seat_number)))
  WHERE seat_number IS NOT NULL AND btrim(seat_number) <> '' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_grade_subjects_grade_year
  ON public.grade_subjects(institution_id, academic_year_id, grade_level_id, is_active);

CREATE INDEX IF NOT EXISTS idx_subject_teachers_teacher_active
  ON public.subject_teachers(teacher_id, is_active);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_single_current_academic_year()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE public.academic_years
    SET is_current = false
    WHERE institution_id = NEW.institution_id
      AND id <> NEW.id
      AND is_current;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_complete_academic_setup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inst uuid;
  linked_inst uuid;
  cls record;
  sec record;
  grade_inst uuid;
  year_inst uuid;
  subject_inst uuid;
  teacher_inst uuid;
BEGIN
  IF TG_TABLE_NAME = 'education_stages' THEN
    IF TG_OP = 'UPDATE' AND NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN
      RAISE EXCEPTION 'academic_institution_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'academic_years' THEN
    IF TG_OP = 'UPDATE' AND NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN
      RAISE EXCEPTION 'academic_institution_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'grade_levels' THEN
    IF NEW.education_stage_id IS NOT NULL THEN
      SELECT institution_id INTO linked_inst FROM public.education_stages WHERE id = NEW.education_stage_id;
      IF linked_inst IS NULL OR linked_inst <> NEW.institution_id THEN
        RAISE EXCEPTION 'grade_stage_institution_mismatch';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'classes' THEN
    IF NEW.academic_year_id IS NOT NULL THEN
      SELECT institution_id INTO linked_inst FROM public.academic_years WHERE id = NEW.academic_year_id;
      IF linked_inst IS NULL OR linked_inst <> NEW.institution_id THEN
        RAISE EXCEPTION 'class_academic_year_institution_mismatch';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'grade_subjects' THEN
    SELECT institution_id INTO year_inst FROM public.academic_years WHERE id = NEW.academic_year_id;
    SELECT institution_id INTO grade_inst FROM public.grade_levels WHERE id = NEW.grade_level_id;
    SELECT institution_id INTO subject_inst FROM public.subjects WHERE id = NEW.subject_id;
    IF year_inst <> NEW.institution_id OR grade_inst <> NEW.institution_id OR subject_inst <> NEW.institution_id THEN
      RAISE EXCEPTION 'grade_subject_institution_mismatch';
    END IF;
    IF NEW.class_id IS NOT NULL THEN
      SELECT institution_id, grade_level_id, academic_year_id INTO cls FROM public.classes WHERE id = NEW.class_id;
      IF cls.institution_id <> NEW.institution_id OR cls.grade_level_id <> NEW.grade_level_id OR cls.academic_year_id <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'grade_subject_class_scope_mismatch';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'subject_teachers' THEN
    SELECT institution_id, grade_level_id, academic_year_id INTO cls FROM public.classes WHERE id = NEW.class_id;
    SELECT institution_id INTO subject_inst FROM public.subjects WHERE id = NEW.subject_id;
    SELECT institution_id INTO teacher_inst FROM public.staff_profiles WHERE id = NEW.teacher_id;
    IF cls.institution_id IS NULL OR subject_inst IS NULL OR teacher_inst IS NULL OR cls.institution_id <> subject_inst OR cls.institution_id <> teacher_inst THEN
      RAISE EXCEPTION 'subject_teacher_institution_mismatch';
    END IF;
    NEW.institution_id := cls.institution_id;
    NEW.grade_level_id := COALESCE(NEW.grade_level_id, cls.grade_level_id);
    NEW.academic_year_id := COALESCE(NEW.academic_year_id, cls.academic_year_id);
    IF NEW.section_id IS NOT NULL THEN
      SELECT class_id INTO sec FROM public.sections WHERE id = NEW.section_id;
      IF sec.class_id <> NEW.class_id THEN
        RAISE EXCEPTION 'subject_teacher_section_mismatch';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'class_students' THEN
    SELECT institution_id, grade_level_id, academic_year_id, is_active INTO cls FROM public.classes WHERE id = NEW.class_id;
    SELECT institution_id INTO inst FROM public.student_profiles WHERE id = NEW.student_id;
    IF cls.institution_id IS NULL OR inst IS NULL OR cls.institution_id <> inst THEN
      RAISE EXCEPTION 'class_student_institution_mismatch';
    END IF;
    IF NEW.status = 'active' AND cls.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'class_student_class_inactive';
    END IF;
    NEW.institution_id := cls.institution_id;
    NEW.grade_level_id := cls.grade_level_id;
    NEW.academic_year_id := cls.academic_year_id;
    IF NEW.section_id IS NOT NULL THEN
      SELECT class_id, is_active INTO sec FROM public.sections WHERE id = NEW.section_id;
      IF sec.class_id <> NEW.class_id THEN
        RAISE EXCEPTION 'class_student_section_mismatch';
      END IF;
      IF NEW.status = 'active' AND sec.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'class_student_section_inactive';
      END IF;
    END IF;
    UPDATE public.student_profiles
    SET grade_level_id = cls.grade_level_id
    WHERE id = NEW.student_id
      AND cls.grade_level_id IS NOT NULL
      AND grade_level_id IS DISTINCT FROM cls.grade_level_id;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_complete_academic_setup() FROM PUBLIC;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['academic_years','education_stages','grade_subjects'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_years TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.education_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grade_subjects TO authenticated;

DROP TRIGGER IF EXISTS trg_academic_year_single_current ON public.academic_years;
CREATE TRIGGER trg_academic_year_single_current
  BEFORE INSERT OR UPDATE ON public.academic_years
  FOR EACH ROW EXECUTE FUNCTION public.set_single_current_academic_year();

DROP TRIGGER IF EXISTS trg_enforce_academic_years_complete ON public.academic_years;
CREATE TRIGGER trg_enforce_academic_years_complete
  BEFORE INSERT OR UPDATE ON public.academic_years
  FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_academic_setup();

DROP TRIGGER IF EXISTS trg_enforce_education_stages_complete ON public.education_stages;
CREATE TRIGGER trg_enforce_education_stages_complete
  BEFORE INSERT OR UPDATE ON public.education_stages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_academic_setup();

DROP TRIGGER IF EXISTS trg_enforce_grade_levels_complete ON public.grade_levels;
CREATE TRIGGER trg_enforce_grade_levels_complete
  BEFORE INSERT OR UPDATE ON public.grade_levels
  FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_academic_setup();

DROP TRIGGER IF EXISTS trg_enforce_classes_complete ON public.classes;
CREATE TRIGGER trg_enforce_classes_complete
  BEFORE INSERT OR UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_academic_setup();

DROP TRIGGER IF EXISTS trg_enforce_grade_subjects_complete ON public.grade_subjects;
CREATE TRIGGER trg_enforce_grade_subjects_complete
  BEFORE INSERT OR UPDATE ON public.grade_subjects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_academic_setup();

DROP TRIGGER IF EXISTS trg_enforce_subject_teachers_complete ON public.subject_teachers;
CREATE TRIGGER trg_enforce_subject_teachers_complete
  BEFORE INSERT OR UPDATE ON public.subject_teachers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_academic_setup();

DROP TRIGGER IF EXISTS trg_enforce_class_students_complete ON public.class_students;
CREATE TRIGGER trg_enforce_class_students_complete
  BEFORE INSERT OR UPDATE ON public.class_students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_complete_academic_setup();

DROP POLICY IF EXISTS "academic_years_select" ON public.academic_years;
CREATE POLICY "academic_years_select" ON public.academic_years FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "academic_years_insert" ON public.academic_years;
CREATE POLICY "academic_years_insert" ON public.academic_years FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "academic_years_update" ON public.academic_years;
CREATE POLICY "academic_years_update" ON public.academic_years FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "academic_years_delete" ON public.academic_years;
CREATE POLICY "academic_years_delete" ON public.academic_years FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "education_stages_select" ON public.education_stages;
CREATE POLICY "education_stages_select" ON public.education_stages FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "education_stages_insert" ON public.education_stages;
CREATE POLICY "education_stages_insert" ON public.education_stages FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "education_stages_update" ON public.education_stages;
CREATE POLICY "education_stages_update" ON public.education_stages FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "education_stages_delete" ON public.education_stages;
CREATE POLICY "education_stages_delete" ON public.education_stages FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "grade_subjects_select" ON public.grade_subjects;
CREATE POLICY "grade_subjects_select" ON public.grade_subjects FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "grade_subjects_insert" ON public.grade_subjects;
CREATE POLICY "grade_subjects_insert" ON public.grade_subjects FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "grade_subjects_update" ON public.grade_subjects;
CREATE POLICY "grade_subjects_update" ON public.grade_subjects FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "grade_subjects_delete" ON public.grade_subjects;
CREATE POLICY "grade_subjects_delete" ON public.grade_subjects FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );
