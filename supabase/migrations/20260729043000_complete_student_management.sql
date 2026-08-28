-- Complete student management fields and permissions.

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS family_name text,
  ADD COLUMN IF NOT EXISTS seat_number text,
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';

ALTER TABLE student_profiles
  ADD CONSTRAINT student_profiles_status_check
  CHECK (status IN ('active', 'suspended', 'graduated', 'archived')) NOT VALID;

ALTER TABLE student_profiles
  ADD CONSTRAINT student_profiles_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profiles_institution_code_unique
  ON student_profiles(institution_id, lower(student_code))
  WHERE student_code IS NOT NULL AND btrim(student_code) <> '';

DROP POLICY IF EXISTS "student_profiles_insert" ON student_profiles;
CREATE POLICY "student_profiles_insert" ON student_profiles FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "student_profiles_update" ON student_profiles;
CREATE POLICY "student_profiles_update" ON student_profiles FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "class_students_insert" ON class_students;
CREATE POLICY "class_students_insert" ON class_students FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_students.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "class_students_update" ON class_students;
CREATE POLICY "class_students_update" ON class_students FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_students.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_students.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  );

