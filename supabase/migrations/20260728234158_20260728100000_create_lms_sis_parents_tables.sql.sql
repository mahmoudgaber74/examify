/*
# المرحلة الرابعة — LMS و SIS و أولياء الأمور

## الجداول الجديدة
1. `lessons` — الدروس داخل المواد
2. `lesson_progress` — تتبع تقدم الطلاب في الدروس
3. `attendance` — الحضور والغياب
4. `grade_book` — درجات الطلاب التراكمية
5. `parent_notifications` — إشعارات أولياء الأمور
*/

CREATE TABLE IF NOT EXISTS lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  content_html text,
  video_url text,
  attachments jsonb DEFAULT '[]',
  duration_minutes integer DEFAULT 45,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started', -- not_started, in_progress, completed
  progress_percent integer NOT NULL DEFAULT 0,
  time_spent_seconds integer NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  completed_at timestamptz,
  UNIQUE(lesson_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  date date NOT NULL,
  status text NOT NULL DEFAULT 'present', -- present, absent, late, excused
  notes text,
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(student_id, date, subject_id)
);

CREATE TABLE IF NOT EXISTS grade_book (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  exam_id uuid REFERENCES examify_exams(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES exam_attempts(id) ON DELETE SET NULL,
  assessment_title text NOT NULL,
  score numeric(8,2) NOT NULL,
  max_score numeric(8,2) NOT NULL DEFAULT 100,
  weight numeric(5,2) NOT NULL DEFAULT 1,
  term text DEFAULT '1',
  recorded_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parent_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  parent_id uuid NOT NULL REFERENCES parent_profiles(id) ON DELETE CASCADE,
  student_id uuid REFERENCES student_profiles(id) ON DELETE CASCADE,
  type text NOT NULL, -- grade_posted, absence_alert, low_score, announcement, attendance_summary
  title text NOT NULL,
  body text,
  data jsonb DEFAULT '{}',
  is_read boolean NOT NULL DEFAULT false,
  sent_via_whatsapp boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_book ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_notifications ENABLE ROW LEVEL SECURITY;

-- lessons
DROP POLICY IF EXISTS "lessons_select" ON lessons;
CREATE POLICY "lessons_select" ON lessons FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "lessons_insert" ON lessons;
CREATE POLICY "lessons_insert" ON lessons FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "lessons_update" ON lessons;
CREATE POLICY "lessons_update" ON lessons FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "lessons_delete" ON lessons;
CREATE POLICY "lessons_delete" ON lessons FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- lesson_progress
DROP POLICY IF EXISTS "lesson_progress_select" ON lesson_progress;
CREATE POLICY "lesson_progress_select" ON lesson_progress FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (SELECT 1 FROM lessons l WHERE l.id = lesson_progress.lesson_id AND l.institution_id = public.current_user_institution_id())
    OR EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = lesson_progress.student_id AND sp.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM parent_student_links psl
      JOIN parent_profiles pp ON pp.id = psl.parent_id
      WHERE pp.user_id = auth.uid() AND psl.student_id = lesson_progress.student_id
    )
  );
DROP POLICY IF EXISTS "lesson_progress_insert" ON lesson_progress;
CREATE POLICY "lesson_progress_insert" ON lesson_progress FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = lesson_progress.student_id AND sp.user_id = auth.uid())
    OR (public.current_user_role() IN ('super_admin', 'school_admin', 'teacher') AND EXISTS (
      SELECT 1 FROM lessons l WHERE l.id = lesson_progress.lesson_id AND l.institution_id = public.current_user_institution_id()
    ))
  );
DROP POLICY IF EXISTS "lesson_progress_update" ON lesson_progress;
CREATE POLICY "lesson_progress_update" ON lesson_progress FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = lesson_progress.student_id AND sp.user_id = auth.uid())
    OR (public.current_user_role() IN ('super_admin', 'school_admin', 'teacher') AND EXISTS (
      SELECT 1 FROM lessons l WHERE l.id = lesson_progress.lesson_id AND l.institution_id = public.current_user_institution_id()
    ))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = lesson_progress.student_id AND sp.user_id = auth.uid())
    OR (public.current_user_role() IN ('super_admin', 'school_admin', 'teacher') AND EXISTS (
      SELECT 1 FROM lessons l WHERE l.id = lesson_progress.lesson_id AND l.institution_id = public.current_user_institution_id()
    ))
  );

-- attendance
DROP POLICY IF EXISTS "attendance_select" ON attendance;
CREATE POLICY "attendance_select" ON attendance FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
    OR EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = attendance.student_id AND sp.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM parent_student_links psl
      JOIN parent_profiles pp ON pp.id = psl.parent_id
      WHERE pp.user_id = auth.uid() AND psl.student_id = attendance.student_id
    )
  );
DROP POLICY IF EXISTS "attendance_insert" ON attendance;
CREATE POLICY "attendance_insert" ON attendance FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "attendance_update" ON attendance;
CREATE POLICY "attendance_update" ON attendance FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "attendance_delete" ON attendance;
CREATE POLICY "attendance_delete" ON attendance FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- grade_book
DROP POLICY IF EXISTS "grade_book_select" ON grade_book;
CREATE POLICY "grade_book_select" ON grade_book FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
    OR EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.id = grade_book.student_id AND sp.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM parent_student_links psl
      JOIN parent_profiles pp ON pp.id = psl.parent_id
      WHERE pp.user_id = auth.uid() AND psl.student_id = grade_book.student_id
    )
  );
DROP POLICY IF EXISTS "grade_book_insert" ON grade_book;
CREATE POLICY "grade_book_insert" ON grade_book FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "grade_book_update" ON grade_book;
CREATE POLICY "grade_book_update" ON grade_book FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "grade_book_delete" ON grade_book;
CREATE POLICY "grade_book_delete" ON grade_book FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- parent_notifications
DROP POLICY IF EXISTS "parent_notifications_select" ON parent_notifications;
CREATE POLICY "parent_notifications_select" ON parent_notifications FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (institution_id = public.current_user_institution_id() AND public.current_user_role() = 'school_admin')
    OR EXISTS (SELECT 1 FROM parent_profiles pp WHERE pp.id = parent_notifications.parent_id AND pp.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "parent_notifications_insert" ON parent_notifications;
CREATE POLICY "parent_notifications_insert" ON parent_notifications FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );
DROP POLICY IF EXISTS "parent_notifications_update" ON parent_notifications;
CREATE POLICY "parent_notifications_update" ON parent_notifications FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM parent_profiles pp WHERE pp.id = parent_notifications.parent_id AND pp.user_id = auth.uid())
    OR (public.current_user_role() IN ('super_admin', 'school_admin') AND institution_id = public.current_user_institution_id())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM parent_profiles pp WHERE pp.id = parent_notifications.parent_id AND pp.user_id = auth.uid())
    OR (public.current_user_role() IN ('super_admin', 'school_admin') AND institution_id = public.current_user_institution_id())
  );
DROP POLICY IF EXISTS "parent_notifications_delete" ON parent_notifications;
CREATE POLICY "parent_notifications_delete" ON parent_notifications FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

CREATE INDEX IF NOT EXISTS idx_lessons_subject ON lessons(subject_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_student ON lesson_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_grade_book_student ON grade_book(student_id);
CREATE INDEX IF NOT EXISTS idx_grade_book_subject ON grade_book(subject_id);
CREATE INDEX IF NOT EXISTS idx_parent_notifications_parent ON parent_notifications(parent_id);

-- Trigger for updated_at on lessons
DROP TRIGGER IF EXISTS trg_lessons_updated ON lessons;
CREATE TRIGGER trg_lessons_updated BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();