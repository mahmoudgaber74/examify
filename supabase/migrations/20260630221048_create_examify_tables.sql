/*
# إنشاء جداول إكزاميفاي AI

## الجداول الجديدة
1. `students` — جدول الطلاب مع نظام التنبؤ بالمخاطر
   - id, name, grade, institution, gpa, attendance, risk_score, status, avatar_url
2. `exams` — جدول الامتحانات
   - id, title, subject, questions_count, duration, difficulty, status, enrolled, avg_score, ai_generated, bloom_levels, updated_at
3. `courses` — جدول الدورات
   - id, title, instructor, category, lessons_count, duration, progress, enrolled, rating, cover_url, tags
4. `certificates` — جدول الشهادات
   - id, recipient, program, issuer, issued_date, credential_id, verified_method, score

## الأمان
- تفعيل RLS على جميع الجداول
- سياسات anon + authenticated للقراءة والكتابة (تطبيق بدون تسجيل دخول)
*/

CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  grade text NOT NULL,
  institution text NOT NULL,
  gpa numeric(3,2) NOT NULL DEFAULT 0,
  attendance integer NOT NULL DEFAULT 0,
  risk_score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'On Track',
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subject text NOT NULL,
  questions_count integer NOT NULL DEFAULT 0,
  duration integer NOT NULL DEFAULT 0,
  difficulty text NOT NULL DEFAULT 'Intermediate',
  status text NOT NULL DEFAULT 'Draft',
  enrolled integer NOT NULL DEFAULT 0,
  avg_score numeric(5,2),
  ai_generated boolean NOT NULL DEFAULT false,
  bloom_levels text[] DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  instructor text NOT NULL,
  category text NOT NULL,
  lessons_count integer NOT NULL DEFAULT 0,
  duration text NOT NULL DEFAULT '0h',
  progress integer NOT NULL DEFAULT 0,
  enrolled integer NOT NULL DEFAULT 0,
  rating numeric(2,1) NOT NULL DEFAULT 0,
  cover_url text,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient text NOT NULL,
  program text NOT NULL,
  issuer text NOT NULL,
  issued_date date,
  credential_id text UNIQUE NOT NULL,
  verified_method text NOT NULL DEFAULT 'Pending',
  score integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_students" ON students;
CREATE POLICY "anon_select_students" ON students FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_students" ON students;
CREATE POLICY "anon_insert_students" ON students FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_students" ON students;
CREATE POLICY "anon_update_students" ON students FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_students" ON students;
CREATE POLICY "anon_delete_students" ON students FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_exams" ON exams;
CREATE POLICY "anon_select_exams" ON exams FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_exams" ON exams;
CREATE POLICY "anon_insert_exams" ON exams FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_exams" ON exams;
CREATE POLICY "anon_update_exams" ON exams FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_exams" ON exams;
CREATE POLICY "anon_delete_exams" ON exams FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_courses" ON courses;
CREATE POLICY "anon_select_courses" ON courses FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_courses" ON courses;
CREATE POLICY "anon_insert_courses" ON courses FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_courses" ON courses;
CREATE POLICY "anon_update_courses" ON courses FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_courses" ON courses;
CREATE POLICY "anon_delete_courses" ON courses FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_certificates" ON certificates;
CREATE POLICY "anon_select_certificates" ON certificates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_certificates" ON certificates;
CREATE POLICY "anon_insert_certificates" ON certificates FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_certificates" ON certificates;
CREATE POLICY "anon_update_certificates" ON certificates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_certificates" ON certificates;
CREATE POLICY "anon_delete_certificates" ON certificates FOR DELETE TO anon, authenticated USING (true);
