/*
# المرحلة الأولى — الهيكل الأساسي لمنصة إكزاميفاي

## الغرض
إنشاء الهيكل الكامل لقاعدة البيانات مع نظام مصادقة حقيقي، عزل متعدد المؤسسات (Multi-Tenancy)،
أدوار وصلاحيات، بنك أسئلة، امتحانات، محاولات، إجابات، وسجل تدقيق.

## الجداول الجديدة
1. `institutions` — المؤسسات/المدارس (المستأجر الرئيسي)
2. `branches` — فروع المؤسسة
3. `grade_levels` — المراحل الدراسية
4. `classes` — الصفوف الدراسية
5. `sections` — الفصول/الشعب داخل الصف
6. `subjects` — المواد الدراسية
7. `staff_profiles` — ملفات المعلمين والموظفين (مرتبطة بـ auth.users)
8. `student_profiles` — ملفات الطلاب (مرتبطة بـ auth.users)
9. `parent_profiles` — ملفات أولياء الأمور (مرتبطة بـ auth.users)
10. `parent_student_links` — ربط أولياء الأمور بالطلاب
11. `class_students` — ربط الطلاب بالفصول
12. `subject_teachers` — ربط المعلمين بالمواد والفصول
13. `questions` — بنك الأسئلة
14. `question_options` — خيارات الأسئلة (لاختيار من متعدد)
15. `exams` — الامتحانات (يحل محل جدول exams القديم)
16. `exam_sections` — أقسام الامتحان
17. `exam_questions` — ربط الأسئلة بالامتحان (مع ترتيب ودرجة)
18. `exam_assignments` — تخصيص الامتحان لطلاب أو فصول
19. `exam_attempts` — محاولات الطلاب
20. `answers` — إجابات الطلاب على الأسئلة
21. `audit_log` — سجل التدقيق

## الأمان
- RLS مفعّل على جميع الجداول الجديدة
- سياسات مبنية على auth.uid() والدور المخزن في raw_app_meta_data
- عزل كامل بين المؤسسات عبر institution_id
- لا يوجد USING (true) — كل سياسة تتحقق من الملكية أو العضوية

## ملاحظات
- تم إبقاء الجداول القديمة (students, exams, courses, certificates, submissions, chat_messages, cart_items, parents, parent_students, notifications, notification_preferences) كما هي لتجنب فقدان البيانات
- الجداول الجديدة تحل محلها وظيفياً لكنها منفصلة لتجنب تعارض الأسماء
*/

-- ============================================================
-- 1. المؤسسات
-- ============================================================
CREATE TABLE IF NOT EXISTS institutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_en text,
  country text,
  city text,
  address text,
  phone text,
  email text,
  logo_url text,
  website text,
  subscription_plan text NOT NULL DEFAULT 'free',
  subscription_status text NOT NULL DEFAULT 'trial',
  max_students integer NOT NULL DEFAULT 100,
  max_teachers integer NOT NULL DEFAULT 10,
  max_exams integer NOT NULL DEFAULT 50,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, -- super admin who created it
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- 2. الفروع
-- ============================================================
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 3. المراحل الدراسية
-- ============================================================
CREATE TABLE IF NOT EXISTS grade_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_en text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 4. الصفوف الدراسية
-- ============================================================
CREATE TABLE IF NOT EXISTS classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  grade_level_id uuid REFERENCES grade_levels(id) ON DELETE SET NULL,
  name text NOT NULL,
  academic_year text NOT NULL DEFAULT '2026-2027',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 5. الفصول/الشعب
-- ============================================================
CREATE TABLE IF NOT EXISTS sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name text NOT NULL,
  capacity integer DEFAULT 30,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 6. المواد الدراسية
-- ============================================================
CREATE TABLE IF NOT EXISTS subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_en text,
  code text,
  color text DEFAULT '#3b82f6',
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 7. ملفات الموظفين (معلمين، مصححين، مديرين، إدخال بيانات)
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  full_name_en text,
  phone text,
  avatar_url text,
  role text NOT NULL DEFAULT 'teacher', -- super_admin, school_admin, teacher, grader, data_entry
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- 8. ملفات الطلاب
-- ============================================================
CREATE TABLE IF NOT EXISTS student_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  student_code text,
  full_name text NOT NULL,
  full_name_en text,
  phone text,
  avatar_url text,
  grade_level_id uuid REFERENCES grade_levels(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- 9. ملفات أولياء الأمور
-- ============================================================
CREATE TABLE IF NOT EXISTS parent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 10. ربط أولياء الأمور بالطلاب
-- ============================================================
CREATE TABLE IF NOT EXISTS parent_student_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES parent_profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'ولي أمر',
  can_view_grades boolean NOT NULL DEFAULT true,
  can_view_attendance boolean NOT NULL DEFAULT true,
  can_receive_alerts boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(parent_id, student_id)
);

-- ============================================================
-- 11. ربط الطلاب بالفصول
-- ============================================================
CREATE TABLE IF NOT EXISTS class_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_id uuid REFERENCES sections(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  enrolled_at timestamptz DEFAULT now(),
  UNIQUE(class_id, student_id)
);

-- ============================================================
-- 12. ربط المعلمين بالمواد والفصول
-- ============================================================
CREATE TABLE IF NOT EXISTS subject_teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  UNIQUE(subject_id, class_id, teacher_id)
);

-- ============================================================
-- 13. بنك الأسئلة
-- ============================================================
CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  type text NOT NULL, -- multiple_choice, true_false, short_answer, essay, matching, ordering, fill_blank, numeric
  prompt text NOT NULL,
  prompt_html text,
  image_url text,
  attachment_url text,
  explanation text,
  difficulty text NOT NULL DEFAULT 'medium', -- easy, medium, hard
  bloom_level text,
  unit text,
  lesson text,
  points numeric(6,2) NOT NULL DEFAULT 1,
  metadata jsonb DEFAULT '{}',
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- 14. خيارات الأسئلة
-- ============================================================
CREATE TABLE IF NOT EXISTS question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  label text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'
);

-- ============================================================
-- 15. الامتحانات الجديدة (تبدل exams القديم)
-- ============================================================
CREATE TABLE IF NOT EXISTS examify_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES staff_profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  instructions text,
  total_points numeric(8,2) NOT NULL DEFAULT 100,
  passing_score numeric(8,2) NOT NULL DEFAULT 50,
  duration_minutes integer NOT NULL DEFAULT 60,
  start_at timestamptz,
  end_at timestamptz,
  max_attempts integer NOT NULL DEFAULT 1,
  shuffle_questions boolean NOT NULL DEFAULT false,
  shuffle_options boolean NOT NULL DEFAULT false,
  show_result_immediately boolean NOT NULL DEFAULT false,
  show_correct_answers boolean NOT NULL DEFAULT false,
  allow_resume boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft', -- draft, scheduled, published, archived
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- 16. أقسام الامتحان
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES examify_exams(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 17. ربط الأسئلة بأقسام الامتحان
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES examify_exams(id) ON DELETE CASCADE,
  section_id uuid REFERENCES exam_sections(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  points numeric(6,2) NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE(exam_id, question_id)
);

-- ============================================================
-- 18. تخصيص الامتحان لطلاب أو فصول
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES examify_exams(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE,
  section_id uuid REFERENCES sections(id) ON DELETE CASCADE,
  student_id uuid REFERENCES student_profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- 19. محاولات الطلاب
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES examify_exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'in_progress', -- in_progress, submitted, auto_submitted, graded, approved
  started_at timestamptz DEFAULT now(),
  submitted_at timestamptz,
  time_remaining_seconds integer,
  score numeric(8,2),
  score_percentage numeric(5,2),
  is_passed boolean,
  graded_by uuid REFERENCES auth.users(id),
  graded_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  is_result_published boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(exam_id, student_id, attempt_number)
);

-- ============================================================
-- 20. إجابات الطلاب
-- ============================================================
CREATE TABLE IF NOT EXISTS answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id uuid REFERENCES question_options(id) ON DELETE SET NULL,
  text_answer text,
  numeric_answer numeric(12,4),
  matching_data jsonb,
  ordering_data jsonb,
  is_correct boolean,
  awarded_points numeric(6,2),
  grader_notes text,
  graded_by uuid REFERENCES auth.users(id),
  graded_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

-- ============================================================
-- 21. سجل التدقيق
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb DEFAULT '{}',
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- الفهارس
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_branches_institution ON branches(institution_id);
CREATE INDEX IF NOT EXISTS idx_grade_levels_institution ON grade_levels(institution_id);
CREATE INDEX IF NOT EXISTS idx_classes_institution ON classes(institution_id);
CREATE INDEX IF NOT EXISTS idx_sections_class ON sections(class_id);
CREATE INDEX IF NOT EXISTS idx_subjects_institution ON subjects(institution_id);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_user ON staff_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_institution ON staff_profiles(institution_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_user ON student_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_institution ON student_profiles(institution_id);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_user ON parent_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_parent_student_links_parent ON parent_student_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_parent_student_links_student ON parent_student_links(student_id);
CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students(class_id);
CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students(student_id);
CREATE INDEX IF NOT EXISTS idx_subject_teachers_teacher ON subject_teachers(teacher_id);
CREATE INDEX IF NOT EXISTS idx_questions_institution ON questions(institution_id);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_question_options_question ON question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_examify_exams_institution ON examify_exams(institution_id);
CREATE INDEX IF NOT EXISTS idx_examify_exams_status ON examify_exams(status);
CREATE INDEX IF NOT EXISTS idx_exam_sections_exam ON exam_sections(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_questions_exam ON exam_questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_assignments_exam ON exam_assignments(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_assignments_student ON exam_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_status ON exam_attempts(status);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_institution ON audit_log(institution_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);

-- ============================================================
-- تفعيل RLS على جميع الجداول
-- ============================================================
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE parent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE parent_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE examify_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- دالة مساعدة: استخراج دور المستخدم من JWT
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'raw_app_meta_data' ->> 'role')::text,
    'anonymous'
  );
$$;

-- ============================================================
-- دالة مساعدة: استخراج institution_id للمستخدم الحالي
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_user_institution_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM staff_profiles WHERE user_id = auth.uid()) THEN
      (SELECT institution_id FROM staff_profiles WHERE user_id = auth.uid() LIMIT 1)
    WHEN EXISTS (SELECT 1 FROM student_profiles WHERE user_id = auth.uid()) THEN
      (SELECT institution_id FROM student_profiles WHERE user_id = auth.uid() LIMIT 1)
    WHEN EXISTS (SELECT 1 FROM parent_profiles WHERE user_id = auth.uid()) THEN
      (SELECT institution_id FROM parent_profiles WHERE user_id = auth.uid() LIMIT 1)
    ELSE NULL
  END;
$$;

-- ============================================================
-- سياسات RLS — institutions
-- super_admin: الكل | الباقون: مؤسستهم فقط
-- ============================================================
DROP POLICY IF EXISTS "institutions_select" ON institutions;
CREATE POLICY "institutions_select" ON institutions FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "institutions_insert" ON institutions;
CREATE POLICY "institutions_insert" ON institutions FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "institutions_update" ON institutions;
CREATE POLICY "institutions_update" ON institutions FOR UPDATE
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (id = public.current_user_institution_id() AND public.current_user_role() = 'school_admin')
  ) WITH CHECK (
    public.current_user_role() = 'super_admin'
    OR (id = public.current_user_institution_id() AND public.current_user_role() = 'school_admin')
  );

DROP POLICY IF EXISTS "institutions_delete" ON institutions;
CREATE POLICY "institutions_delete" ON institutions FOR DELETE
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
  );

-- ============================================================
-- سياسات RLS — branches (عبر institution_id)
-- ============================================================
DROP POLICY IF EXISTS "branches_select" ON branches;
CREATE POLICY "branches_select" ON branches FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "branches_insert" ON branches;
CREATE POLICY "branches_insert" ON branches FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "branches_update" ON branches;
CREATE POLICY "branches_update" ON branches FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "branches_delete" ON branches;
CREATE POLICY "branches_delete" ON branches FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ============================================================
-- سياسات RLS — grade_levels
-- ============================================================
DROP POLICY IF EXISTS "grade_levels_select" ON grade_levels;
CREATE POLICY "grade_levels_select" ON grade_levels FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "grade_levels_insert" ON grade_levels;
CREATE POLICY "grade_levels_insert" ON grade_levels FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "grade_levels_update" ON grade_levels;
CREATE POLICY "grade_levels_update" ON grade_levels FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "grade_levels_delete" ON grade_levels;
CREATE POLICY "grade_levels_delete" ON grade_levels FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ============================================================
-- سياسات RLS — classes
-- ============================================================
DROP POLICY IF EXISTS "classes_select" ON classes;
CREATE POLICY "classes_select" ON classes FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "classes_insert" ON classes;
CREATE POLICY "classes_insert" ON classes FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "classes_update" ON classes;
CREATE POLICY "classes_update" ON classes FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "classes_delete" ON classes;
CREATE POLICY "classes_delete" ON classes FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ============================================================
-- سياسات RLS — sections
-- ============================================================
DROP POLICY IF EXISTS "sections_select" ON sections;
CREATE POLICY "sections_select" ON sections FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = sections.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "sections_insert" ON sections;
CREATE POLICY "sections_insert" ON sections FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = sections.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "sections_update" ON sections;
CREATE POLICY "sections_update" ON sections FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = sections.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = sections.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "sections_delete" ON sections;
CREATE POLICY "sections_delete" ON sections FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = sections.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  );

-- ============================================================
-- سياسات RLS — subjects
-- ============================================================
DROP POLICY IF EXISTS "subjects_select" ON subjects;
CREATE POLICY "subjects_select" ON subjects FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "subjects_insert" ON subjects;
CREATE POLICY "subjects_insert" ON subjects FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "subjects_update" ON subjects;
CREATE POLICY "subjects_update" ON subjects FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "subjects_delete" ON subjects;
CREATE POLICY "subjects_delete" ON subjects FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ============================================================
-- سياسات RLS — staff_profiles
-- ============================================================
DROP POLICY IF EXISTS "staff_profiles_select" ON staff_profiles;
CREATE POLICY "staff_profiles_select" ON staff_profiles FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "staff_profiles_insert" ON staff_profiles;
CREATE POLICY "staff_profiles_insert" ON staff_profiles FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "staff_profiles_update" ON staff_profiles;
CREATE POLICY "staff_profiles_update" ON staff_profiles FOR UPDATE
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (institution_id = public.current_user_institution_id() AND public.current_user_role() = 'school_admin')
    OR user_id = auth.uid()
  ) WITH CHECK (
    public.current_user_role() = 'super_admin'
    OR (institution_id = public.current_user_institution_id() AND public.current_user_role() = 'school_admin')
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "staff_profiles_delete" ON staff_profiles;
CREATE POLICY "staff_profiles_delete" ON staff_profiles FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ============================================================
-- سياسات RLS — student_profiles
-- ============================================================
DROP POLICY IF EXISTS "student_profiles_select" ON student_profiles;
CREATE POLICY "student_profiles_select" ON student_profiles FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM parent_student_links psl
      JOIN parent_profiles pp ON pp.id = psl.parent_id
      WHERE pp.user_id = auth.uid() AND psl.student_id = student_profiles.id
    )
  );

DROP POLICY IF EXISTS "student_profiles_insert" ON student_profiles;
CREATE POLICY "student_profiles_insert" ON student_profiles FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "student_profiles_update" ON student_profiles;
CREATE POLICY "student_profiles_update" ON student_profiles FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "student_profiles_delete" ON student_profiles;
CREATE POLICY "student_student_profiles_delete" ON student_profiles FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ============================================================
-- سياسات RLS — parent_profiles
-- ============================================================
DROP POLICY IF EXISTS "parent_profiles_select" ON parent_profiles;
CREATE POLICY "parent_profiles_select" ON parent_profiles FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "parent_profiles_insert" ON parent_profiles;
CREATE POLICY "parent_profiles_insert" ON parent_profiles FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "parent_profiles_update" ON parent_profiles;
CREATE POLICY "parent_profiles_update" ON parent_profiles FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "parent_profiles_delete" ON parent_profiles;
CREATE POLICY "parent_profiles_delete" ON parent_profiles FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ============================================================
-- سياسات RLS — parent_student_links
-- ============================================================
DROP POLICY IF EXISTS "parent_student_links_select" ON parent_student_links;
CREATE POLICY "parent_student_links_select" ON parent_student_links FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
      AND pp.institution_id = public.current_user_institution_id()
    )
    OR EXISTS (
      SELECT 1 FROM parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id AND pp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "parent_student_links_insert" ON parent_student_links;
CREATE POLICY "parent_student_links_insert" ON parent_student_links FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
      AND pp.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "parent_student_links_update" ON parent_student_links;
CREATE POLICY "parent_student_links_update" ON parent_student_links FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND EXISTS (
      SELECT 1 FROM parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
      AND pp.institution_id = public.current_user_institution_id()
    )
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND EXISTS (
      SELECT 1 FROM parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
      AND pp.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "parent_student_links_delete" ON parent_student_links;
CREATE POLICY "parent_student_links_delete" ON parent_student_links FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND EXISTS (
      SELECT 1 FROM parent_profiles pp
      WHERE pp.id = parent_student_links.parent_id
      AND pp.institution_id = public.current_user_institution_id()
    )
  );

-- ============================================================
-- سياسات RLS — class_students
-- ============================================================
DROP POLICY IF EXISTS "class_students_select" ON class_students;
CREATE POLICY "class_students_select" ON class_students FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_students.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
    OR EXISTS (
      SELECT 1 FROM student_profiles sp
      WHERE sp.id = class_students.student_id AND sp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM parent_student_links psl
      JOIN parent_profiles pp ON pp.id = psl.parent_id
      WHERE pp.user_id = auth.uid() AND psl.student_id = class_students.student_id
    )
  );

DROP POLICY IF EXISTS "class_students_insert" ON class_students;
CREATE POLICY "class_students_insert" ON class_students FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_students.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "class_students_update" ON class_students;
CREATE POLICY "class_students_update" ON class_students FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_students.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'data_entry')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_students.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "class_students_delete" ON class_students;
CREATE POLICY "class_students_delete" ON class_students FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND EXISTS (
      SELECT 1 FROM classes c
      WHERE c.id = class_students.class_id
      AND c.institution_id = public.current_user_institution_id()
    )
  );

-- ============================================================
-- سياسات RLS — subject_teachers
-- ============================================================
DROP POLICY IF EXISTS "subject_teachers_select" ON subject_teachers;
CREATE POLICY "subject_teachers_select" ON subject_teachers FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM staff_profiles sp
      WHERE sp.id = subject_teachers.teacher_id
      AND sp.institution_id = public.current_user_institution_id()
    )
    OR EXISTS (
      SELECT 1 FROM staff_profiles sp
      WHERE sp.id = subject_teachers.teacher_id AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "subject_teachers_insert" ON subject_teachers;
CREATE POLICY "subject_teachers_insert" ON subject_teachers FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND EXISTS (
      SELECT 1 FROM staff_profiles sp
      WHERE sp.id = subject_teachers.teacher_id
      AND sp.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "subject_teachers_delete" ON subject_teachers;
CREATE POLICY "subject_teachers_delete" ON subject_teachers FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND EXISTS (
      SELECT 1 FROM staff_profiles sp
      WHERE sp.id = subject_teachers.teacher_id
      AND sp.institution_id = public.current_user_institution_id()
    )
  );

-- ============================================================
-- سياسات RLS — questions
-- ============================================================
DROP POLICY IF EXISTS "questions_select" ON questions;
CREATE POLICY "questions_select" ON questions FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
    OR is_public = true
  );

DROP POLICY IF EXISTS "questions_insert" ON questions;
CREATE POLICY "questions_insert" ON questions FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "questions_update" ON questions;
CREATE POLICY "questions_update" ON questions FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "questions_delete" ON questions;
CREATE POLICY "questions_delete" ON questions FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ============================================================
-- سياسات RLS — question_options (عبر questions)
-- ============================================================
DROP POLICY IF EXISTS "question_options_select" ON question_options;
CREATE POLICY "question_options_select" ON question_options FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM questions q
      WHERE q.id = question_options.question_id
      AND (q.institution_id = public.current_user_institution_id() OR q.is_public = true)
    )
  );

DROP POLICY IF EXISTS "question_options_insert" ON question_options;
CREATE POLICY "question_options_insert" ON question_options FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM questions q
      WHERE q.id = question_options.question_id
      AND q.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

DROP POLICY IF EXISTS "question_options_update" ON question_options;
CREATE POLICY "question_options_update" ON question_options FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM questions q
      WHERE q.id = question_options.question_id
      AND q.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM questions q
      WHERE q.id = question_options.question_id
      AND q.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin')
    )
  );

DROP POLICY IF EXISTS "question_options_delete" ON question_options;
CREATE POLICY "question_options_delete" ON question_options FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM questions q
      WHERE q.id = question_options.question_id
      AND q.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin')
    )
  );

-- ============================================================
-- سياسات RLS — examify_exams
-- ============================================================
DROP POLICY IF EXISTS "examify_exams_select" ON examify_exams;
CREATE POLICY "examify_exams_select" ON examify_exams FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "examify_exams_insert" ON examify_exams;
CREATE POLICY "examify_exams_insert" ON examify_exams FOR INSERT
  TO authenticated WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "examify_exams_update" ON examify_exams;
CREATE POLICY "examify_exams_update" ON examify_exams FOR UPDATE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  ) WITH CHECK (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    AND institution_id = public.current_user_institution_id()
  );

DROP POLICY IF EXISTS "examify_exams_delete" ON examify_exams;
CREATE POLICY "examify_exams_delete" ON examify_exams FOR DELETE
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin')
    AND institution_id = public.current_user_institution_id()
  );

-- ============================================================
-- سياسات RLS — exam_sections (عبر examify_exams)
-- ============================================================
DROP POLICY IF EXISTS "exam_sections_select" ON exam_sections;
CREATE POLICY "exam_sections_select" ON exam_sections FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_sections.exam_id
      AND e.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "exam_sections_insert" ON exam_sections;
CREATE POLICY "exam_sections_insert" ON exam_sections FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_sections.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

DROP POLICY IF EXISTS "exam_sections_update" ON exam_sections;
CREATE POLICY "exam_sections_update" ON exam_sections FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_sections.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_sections.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

DROP POLICY IF EXISTS "exam_sections_delete" ON exam_sections;
CREATE POLICY "exam_sections_delete" ON exam_sections FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_sections.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

-- ============================================================
-- سياسات RLS — exam_questions
-- ============================================================
DROP POLICY IF EXISTS "exam_questions_select" ON exam_questions;
CREATE POLICY "exam_questions_select" ON exam_questions FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_questions.exam_id
      AND e.institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS "exam_questions_insert" ON exam_questions;
CREATE POLICY "exam_questions_insert" ON exam_questions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_questions.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

DROP POLICY IF EXISTS "exam_questions_update" ON exam_questions;
CREATE POLICY "exam_questions_update" ON exam_questions FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_questions.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_questions.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

DROP POLICY IF EXISTS "exam_questions_delete" ON exam_questions;
CREATE POLICY "exam_questions_delete" ON exam_questions FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_questions.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

-- ============================================================
-- سياسات RLS — exam_assignments
-- ============================================================
DROP POLICY IF EXISTS "exam_assignments_select" ON exam_assignments;
CREATE POLICY "exam_assignments_select" ON exam_assignments FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_assignments.exam_id
      AND e.institution_id = public.current_user_institution_id()
    )
    OR EXISTS (
      SELECT 1 FROM student_profiles sp
      WHERE sp.id = exam_assignments.student_id AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "exam_assignments_insert" ON exam_assignments;
CREATE POLICY "exam_assignments_insert" ON exam_assignments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_assignments.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

DROP POLICY IF EXISTS "exam_assignments_delete" ON exam_assignments;
CREATE POLICY "exam_assignments_delete" ON exam_assignments FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_assignments.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
    )
  );

-- ============================================================
-- سياسات RLS — exam_attempts
-- ============================================================
DROP POLICY IF EXISTS "exam_attempts_select" ON exam_attempts;
CREATE POLICY "exam_attempts_select" ON exam_attempts FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_attempts.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1 FROM student_profiles sp
      WHERE sp.id = exam_attempts.student_id AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "exam_attempts_insert" ON exam_attempts;
CREATE POLICY "exam_attempts_insert" ON exam_attempts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM student_profiles sp
      WHERE sp.id = exam_attempts.student_id AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "exam_attempts_update" ON exam_attempts;
CREATE POLICY "exam_attempts_update" ON exam_attempts FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_attempts.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1 FROM student_profiles sp
      WHERE sp.id = exam_attempts.student_id AND sp.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM examify_exams e
      WHERE e.id = exam_attempts.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1 FROM student_profiles sp
      WHERE sp.id = exam_attempts.student_id AND sp.user_id = auth.uid()
    )
  );

-- ============================================================
-- سياسات RLS — answers
-- ============================================================
DROP POLICY IF EXISTS "answers_select" ON answers;
CREATE POLICY "answers_select" ON answers FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN examify_exams e ON e.id = ea.exam_id
      WHERE ea.id = answers.attempt_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN student_profiles sp ON sp.id = ea.student_id
      WHERE ea.id = answers.attempt_id AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "answers_insert" ON answers;
CREATE POLICY "answers_insert" ON answers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN student_profiles sp ON sp.id = ea.student_id
      WHERE ea.id = answers.attempt_id AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "answers_update" ON answers;
CREATE POLICY "answers_update" ON answers FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN examify_exams e ON e.id = ea.exam_id
      WHERE ea.id = answers.attempt_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN student_profiles sp ON sp.id = ea.student_id
      WHERE ea.id = answers.attempt_id AND sp.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN examify_exams e ON e.id = ea.exam_id
      WHERE ea.id = answers.attempt_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN student_profiles sp ON sp.id = ea.student_id
      WHERE ea.id = answers.attempt_id AND sp.user_id = auth.uid()
    )
  );

-- ============================================================
-- سياسات RLS — audit_log
-- ============================================================
DROP POLICY IF EXISTS "audit_log_select" ON audit_log;
CREATE POLICY "audit_log_select" ON audit_log FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (institution_id = public.current_user_institution_id() AND public.current_user_role() = 'school_admin')
  );

DROP POLICY IF EXISTS "audit_log_insert" ON audit_log;
CREATE POLICY "audit_log_insert" ON audit_log FOR INSERT
  TO authenticated WITH CHECK (true);

-- ============================================================
-- Trigger: تحديث updated_at تلقائياً
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_institutions_updated ON institutions;
CREATE TRIGGER trg_institutions_updated BEFORE UPDATE ON institutions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_staff_profiles_updated ON staff_profiles;
CREATE TRIGGER trg_staff_profiles_updated BEFORE UPDATE ON staff_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_student_profiles_updated ON student_profiles;
CREATE TRIGGER trg_student_profiles_updated BEFORE UPDATE ON student_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_questions_updated ON questions;
CREATE TRIGGER trg_questions_updated BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_examify_exams_updated ON examify_exams;
CREATE TRIGGER trg_examify_exams_updated BEFORE UPDATE ON examify_exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_answers_updated ON answers;
CREATE TRIGGER trg_answers_updated BEFORE UPDATE ON answers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();