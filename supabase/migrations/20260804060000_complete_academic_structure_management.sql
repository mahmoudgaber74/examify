-- Complete academic structure management on the existing canonical tables.
-- Canonical path: institutions -> branches? -> grade_levels -> classes -> sections.

ALTER TABLE public.grade_levels
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS branches_institution_name_unique
  ON public.branches(institution_id, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS grade_levels_institution_name_unique
  ON public.grade_levels(institution_id, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS classes_scope_name_unique
  ON public.classes(
    institution_id,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(grade_level_id, '00000000-0000-0000-0000-000000000000'::uuid),
    academic_year,
    lower(btrim(name))
  );

CREATE UNIQUE INDEX IF NOT EXISTS sections_class_name_unique
  ON public.sections(class_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_grade_levels_institution_active
  ON public.grade_levels(institution_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_classes_scope_active
  ON public.classes(institution_id, branch_id, grade_level_id, is_active);

CREATE INDEX IF NOT EXISTS idx_sections_class_active
  ON public.sections(class_id, is_active);

CREATE OR REPLACE FUNCTION public.enforce_academic_structure_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  class_row record;
  grade_institution uuid;
  branch_institution uuid;
  student_institution uuid;
  exam_institution uuid;
  section_class_id uuid;
  section_active boolean;
BEGIN
  IF TG_TABLE_NAME = 'branches' THEN
    IF TG_OP = 'UPDATE' AND NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN
      RAISE EXCEPTION 'academic_institution_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'grade_levels' THEN
    IF TG_OP = 'UPDATE' AND NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN
      RAISE EXCEPTION 'academic_institution_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'classes' THEN
    IF TG_OP = 'UPDATE' AND NEW.institution_id IS DISTINCT FROM OLD.institution_id THEN
      RAISE EXCEPTION 'academic_institution_immutable';
    END IF;

    IF NEW.grade_level_id IS NOT NULL THEN
      SELECT institution_id INTO grade_institution
      FROM public.grade_levels
      WHERE id = NEW.grade_level_id;
      IF grade_institution IS NULL OR grade_institution <> NEW.institution_id THEN
        RAISE EXCEPTION 'class_grade_level_institution_mismatch';
      END IF;
    END IF;

    IF NEW.branch_id IS NOT NULL THEN
      SELECT institution_id INTO branch_institution
      FROM public.branches
      WHERE id = NEW.branch_id;
      IF branch_institution IS NULL OR branch_institution <> NEW.institution_id THEN
        RAISE EXCEPTION 'class_branch_institution_mismatch';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'sections' THEN
    SELECT institution_id, is_active INTO class_row
    FROM public.classes
    WHERE id = NEW.class_id;
    IF class_row.institution_id IS NULL THEN
      RAISE EXCEPTION 'section_class_missing';
    END IF;
    IF TG_OP = 'INSERT' AND class_row.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'section_class_inactive';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.class_id IS DISTINCT FROM OLD.class_id THEN
      RAISE EXCEPTION 'section_class_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'class_students' THEN
    SELECT institution_id, grade_level_id, is_active INTO class_row
    FROM public.classes
    WHERE id = NEW.class_id;
    SELECT institution_id INTO student_institution
    FROM public.student_profiles
    WHERE id = NEW.student_id;

    IF class_row.institution_id IS NULL OR student_institution IS NULL OR class_row.institution_id <> student_institution THEN
      RAISE EXCEPTION 'class_student_institution_mismatch';
    END IF;
    IF class_row.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'class_student_class_inactive';
    END IF;
    IF NEW.section_id IS NOT NULL THEN
      SELECT class_id, is_active INTO section_class_id, section_active
      FROM public.sections
      WHERE id = NEW.section_id;
      IF section_class_id IS NULL OR section_class_id <> NEW.class_id THEN
        RAISE EXCEPTION 'class_student_section_mismatch';
      END IF;
      IF section_active IS NOT TRUE THEN
        RAISE EXCEPTION 'class_student_section_inactive';
      END IF;
    END IF;

    UPDATE public.student_profiles
    SET grade_level_id = class_row.grade_level_id
    WHERE id = NEW.student_id
      AND class_row.grade_level_id IS NOT NULL
      AND grade_level_id IS DISTINCT FROM class_row.grade_level_id;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'exam_assignments' THEN
    SELECT institution_id INTO exam_institution
    FROM public.examify_exams
    WHERE id = NEW.exam_id;

    IF NEW.class_id IS NOT NULL THEN
      SELECT institution_id, is_active INTO class_row
      FROM public.classes
      WHERE id = NEW.class_id;
      IF class_row.institution_id IS NULL OR class_row.institution_id <> exam_institution THEN
        RAISE EXCEPTION 'exam_assignment_class_institution_mismatch';
      END IF;
      IF class_row.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'exam_assignment_class_inactive';
      END IF;
    END IF;

    IF NEW.section_id IS NOT NULL THEN
      SELECT s.class_id, s.is_active, c.institution_id INTO section_class_id, section_active, branch_institution
      FROM public.sections s
      JOIN public.classes c ON c.id = s.class_id
      WHERE s.id = NEW.section_id;
      IF section_class_id IS NULL OR branch_institution <> exam_institution THEN
        RAISE EXCEPTION 'exam_assignment_section_institution_mismatch';
      END IF;
      IF NEW.class_id IS NOT NULL AND section_class_id <> NEW.class_id THEN
        RAISE EXCEPTION 'exam_assignment_section_class_mismatch';
      END IF;
      IF section_active IS NOT TRUE THEN
        RAISE EXCEPTION 'exam_assignment_section_inactive';
      END IF;
    END IF;

    IF NEW.student_id IS NOT NULL THEN
      SELECT institution_id INTO student_institution
      FROM public.student_profiles
      WHERE id = NEW.student_id;
      IF student_institution IS NULL OR student_institution <> exam_institution THEN
        RAISE EXCEPTION 'exam_assignment_student_institution_mismatch';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'attendance' THEN
    SELECT institution_id INTO student_institution
    FROM public.student_profiles
    WHERE id = NEW.student_id;
    IF student_institution IS NULL OR student_institution <> NEW.institution_id THEN
      RAISE EXCEPTION 'attendance_student_institution_mismatch';
    END IF;
    IF NEW.class_id IS NOT NULL THEN
      SELECT institution_id, is_active INTO class_row
      FROM public.classes
      WHERE id = NEW.class_id;
      IF class_row.institution_id IS NULL OR class_row.institution_id <> NEW.institution_id THEN
        RAISE EXCEPTION 'attendance_class_institution_mismatch';
      END IF;
      IF class_row.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'attendance_class_inactive';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'grade_book' THEN
    SELECT institution_id INTO student_institution
    FROM public.student_profiles
    WHERE id = NEW.student_id;
    IF student_institution IS NULL OR student_institution <> NEW.institution_id THEN
      RAISE EXCEPTION 'grade_book_student_institution_mismatch';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_academic_structure_integrity() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_branches_integrity ON public.branches;
CREATE TRIGGER trg_enforce_branches_integrity
  BEFORE INSERT OR UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_structure_integrity();

DROP TRIGGER IF EXISTS trg_enforce_grade_levels_integrity ON public.grade_levels;
CREATE TRIGGER trg_enforce_grade_levels_integrity
  BEFORE INSERT OR UPDATE ON public.grade_levels
  FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_structure_integrity();

DROP TRIGGER IF EXISTS trg_enforce_classes_integrity ON public.classes;
CREATE TRIGGER trg_enforce_classes_integrity
  BEFORE INSERT OR UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_structure_integrity();

DROP TRIGGER IF EXISTS trg_enforce_sections_integrity ON public.sections;
CREATE TRIGGER trg_enforce_sections_integrity
  BEFORE INSERT OR UPDATE ON public.sections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_structure_integrity();

DROP TRIGGER IF EXISTS trg_enforce_class_students_integrity ON public.class_students;
CREATE TRIGGER trg_enforce_class_students_integrity
  BEFORE INSERT OR UPDATE ON public.class_students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_structure_integrity();

DROP TRIGGER IF EXISTS trg_enforce_exam_assignments_academic_integrity ON public.exam_assignments;
CREATE TRIGGER trg_enforce_exam_assignments_academic_integrity
  BEFORE INSERT OR UPDATE ON public.exam_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_structure_integrity();

DROP TRIGGER IF EXISTS trg_enforce_attendance_academic_integrity ON public.attendance;
CREATE TRIGGER trg_enforce_attendance_academic_integrity
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_structure_integrity();

DROP TRIGGER IF EXISTS trg_enforce_grade_book_academic_integrity ON public.grade_book;
CREATE TRIGGER trg_enforce_grade_book_academic_integrity
  BEFORE INSERT OR UPDATE ON public.grade_book
  FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_structure_integrity();
