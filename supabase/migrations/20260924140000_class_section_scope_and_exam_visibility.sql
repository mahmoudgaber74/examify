/*
  Close the class/section relationship without rewriting or deleting legacy data.

  Sections remain children of classes.  The denormalized academic scope columns
  make tenant/year/grade/branch filtering explicit and are kept in sync from the
  parent class by triggers.  The migration also fixes section-specific student
  exam assignment matching at the RLS boundary.
*/

ALTER TABLE public.sections
  ADD COLUMN IF NOT EXISTS institution_id uuid,
  ADD COLUMN IF NOT EXISTS academic_year_id uuid,
  ADD COLUMN IF NOT EXISTS grade_level_id uuid,
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill only missing/incorrect denormalized scope values from the canonical
-- class. No section or enrollment row is removed.
UPDATE public.sections s
SET institution_id = c.institution_id,
    academic_year_id = c.academic_year_id,
    grade_level_id = c.grade_level_id,
    branch_id = c.branch_id
FROM public.classes c
WHERE c.id = s.class_id
  AND (
    s.institution_id IS DISTINCT FROM c.institution_id
    OR s.academic_year_id IS DISTINCT FROM c.academic_year_id
    OR s.grade_level_id IS DISTINCT FROM c.grade_level_id
    OR s.branch_id IS DISTINCT FROM c.branch_id
  );

ALTER TABLE public.sections
  ALTER COLUMN institution_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sections_institution_id_fkey') THEN
    ALTER TABLE public.sections
      ADD CONSTRAINT sections_institution_id_fkey
      FOREIGN KEY (institution_id) REFERENCES public.institutions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sections_academic_year_id_fkey') THEN
    ALTER TABLE public.sections
      ADD CONSTRAINT sections_academic_year_id_fkey
      FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sections_grade_level_id_fkey') THEN
    ALTER TABLE public.sections
      ADD CONSTRAINT sections_grade_level_id_fkey
      FOREIGN KEY (grade_level_id) REFERENCES public.grade_levels(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sections_branch_id_fkey') THEN
    ALTER TABLE public.sections
      ADD CONSTRAINT sections_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS sections_institution_parent_name_unique
  ON public.sections(institution_id, class_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_sections_institution_scope
  ON public.sections(institution_id, academic_year_id, grade_level_id, branch_id, is_active);

CREATE OR REPLACE FUNCTION public.sync_section_academic_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  parent public.classes%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM public.classes WHERE id = NEW.class_id;
  IF parent.id IS NULL THEN
    RAISE EXCEPTION 'section_class_missing';
  END IF;
  IF TG_OP = 'INSERT' AND parent.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'section_class_inactive';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.class_id IS DISTINCT FROM OLD.class_id THEN
    RAISE EXCEPTION 'section_class_immutable';
  END IF;

  NEW.institution_id := COALESCE(NEW.institution_id, parent.institution_id);
  NEW.academic_year_id := COALESCE(NEW.academic_year_id, parent.academic_year_id);
  NEW.grade_level_id := COALESCE(NEW.grade_level_id, parent.grade_level_id);
  NEW.branch_id := COALESCE(NEW.branch_id, parent.branch_id);

  IF NEW.institution_id IS DISTINCT FROM parent.institution_id
     OR NEW.academic_year_id IS DISTINCT FROM parent.academic_year_id
     OR NEW.grade_level_id IS DISTINCT FROM parent.grade_level_id
     OR NEW.branch_id IS DISTINCT FROM parent.branch_id THEN
    RAISE EXCEPTION 'section_academic_scope_mismatch';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_section_academic_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_section_academic_scope ON public.sections;
CREATE TRIGGER trg_sync_section_academic_scope
  BEFORE INSERT OR UPDATE ON public.sections
  FOR EACH ROW EXECUTE FUNCTION public.sync_section_academic_scope();

CREATE OR REPLACE FUNCTION public.sync_class_student_academic_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  parent public.classes%ROWTYPE;
  enrolled_student public.student_profiles%ROWTYPE;
  enrolled_section public.sections%ROWTYPE;
BEGIN
  SELECT * INTO parent FROM public.classes WHERE id = NEW.class_id;
  SELECT * INTO enrolled_student FROM public.student_profiles WHERE id = NEW.student_id;
  IF parent.id IS NULL OR enrolled_student.id IS NULL
     OR parent.institution_id IS DISTINCT FROM enrolled_student.institution_id THEN
    RAISE EXCEPTION 'class_student_institution_mismatch';
  END IF;
  IF NEW.status = 'active' AND parent.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'class_student_class_inactive';
  END IF;

  NEW.institution_id := parent.institution_id;
  NEW.academic_year_id := parent.academic_year_id;
  NEW.grade_level_id := parent.grade_level_id;

  IF NEW.section_id IS NOT NULL THEN
    SELECT * INTO enrolled_section FROM public.sections WHERE id = NEW.section_id;
    IF enrolled_section.id IS NULL OR enrolled_section.class_id IS DISTINCT FROM NEW.class_id
       OR enrolled_section.institution_id IS DISTINCT FROM parent.institution_id
       OR enrolled_section.academic_year_id IS DISTINCT FROM parent.academic_year_id
       OR enrolled_section.grade_level_id IS DISTINCT FROM parent.grade_level_id
       OR enrolled_section.branch_id IS DISTINCT FROM parent.branch_id THEN
      RAISE EXCEPTION 'class_student_section_scope_mismatch';
    END IF;
    IF NEW.status = 'active' AND enrolled_section.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'class_student_section_inactive';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_class_student_academic_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_class_student_academic_scope ON public.class_students;
CREATE TRIGGER trg_sync_class_student_academic_scope
  BEFORE INSERT OR UPDATE ON public.class_students
  FOR EACH ROW EXECUTE FUNCTION public.sync_class_student_academic_scope();

-- Students assigned to a class exam match the class. Students assigned to a
-- section exam must match that exact section, even when class_id is also set.
CREATE OR REPLACE FUNCTION public.is_exam_assigned_to_current_student(target_exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_profiles sp
    JOIN public.examify_exams e
      ON e.id = target_exam_id
     AND e.institution_id = sp.institution_id
    JOIN public.exam_assignments ea ON ea.exam_id = e.id
    LEFT JOIN public.class_students cs
      ON cs.student_id = sp.id
     AND cs.status = 'active'
     AND cs.institution_id = sp.institution_id
     AND (
       (ea.section_id IS NULL AND ea.class_id IS NOT NULL AND cs.class_id = ea.class_id)
       OR (ea.section_id IS NOT NULL AND cs.section_id = ea.section_id)
     )
    WHERE sp.user_id = auth.uid()
      AND sp.is_active = true
      AND (ea.student_id = sp.id OR cs.id IS NOT NULL)
  );
$$;

REVOKE ALL ON FUNCTION public.is_exam_assigned_to_current_student(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_exam_assigned_to_current_student(uuid) TO authenticated;

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sections_select ON public.sections;
CREATE POLICY sections_select ON public.sections FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR (
    institution_id = public.current_user_institution_id()
    AND (
      public.current_user_role() IN ('school_admin', 'grader', 'data_entry')
      OR public.teacher_has_class_scope(class_id, id)
    )
  )
);

DROP POLICY IF EXISTS sections_insert ON public.sections;
CREATE POLICY sections_insert ON public.sections FOR INSERT TO authenticated WITH CHECK (
  public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
  AND institution_id = public.current_user_institution_id()
  AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = sections.class_id AND c.institution_id = public.current_user_institution_id()
  )
);

DROP POLICY IF EXISTS sections_update ON public.sections;
CREATE POLICY sections_update ON public.sections FOR UPDATE TO authenticated
USING (
  public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
  AND institution_id = public.current_user_institution_id()
)
WITH CHECK (
  public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
  AND institution_id = public.current_user_institution_id()
  AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = sections.class_id AND c.institution_id = public.current_user_institution_id()
  )
);

DROP POLICY IF EXISTS sections_delete ON public.sections;
CREATE POLICY sections_delete ON public.sections FOR DELETE TO authenticated USING (
  public.current_user_role() IN ('super_admin', 'school_admin')
  AND institution_id = public.current_user_institution_id()
);

DROP POLICY IF EXISTS class_students_select ON public.class_students;
CREATE POLICY class_students_select ON public.class_students FOR SELECT TO authenticated USING (
  public.current_user_role() = 'super_admin'
  OR institution_id = public.current_user_institution_id()
  OR EXISTS (SELECT 1 FROM public.student_profiles sp WHERE sp.id = class_students.student_id AND sp.user_id = auth.uid())
  OR public.teacher_has_class_scope(class_id, section_id)
  OR EXISTS (
    SELECT 1
    FROM public.parent_student_links psl
    JOIN public.parent_profiles pp ON pp.id = psl.parent_id
    WHERE pp.user_id = auth.uid()
      AND pp.institution_id = class_students.institution_id
      AND psl.student_id = class_students.student_id
  )
);

DROP POLICY IF EXISTS class_students_insert ON public.class_students;
CREATE POLICY class_students_insert ON public.class_students FOR INSERT TO authenticated WITH CHECK (
  public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
  AND institution_id = public.current_user_institution_id()
);

DROP POLICY IF EXISTS class_students_update ON public.class_students;
CREATE POLICY class_students_update ON public.class_students FOR UPDATE TO authenticated
USING (
  public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
  AND institution_id = public.current_user_institution_id()
)
WITH CHECK (
  public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
  AND institution_id = public.current_user_institution_id()
);

DROP POLICY IF EXISTS class_students_delete ON public.class_students;
CREATE POLICY class_students_delete ON public.class_students FOR DELETE TO authenticated USING (
  public.current_user_role() IN ('super_admin', 'school_admin')
  AND institution_id = public.current_user_institution_id()
);
