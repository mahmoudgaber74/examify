/*
# جداول إضافية لإكزاميفاي AI

## الجداول الجديدة
1. `courses` — جدول الدورات (نظام إدارة التعلّم)
   - id, title, instructor, category, lessons_count, duration, progress, enrolled, rating, cover_url, tags
2. `submissions` — جدول تسليمات التصحيح
   - id, student_name, exam_title, type, ai_grade, confidence, status, language, feedback
3. `chat_messages` — جدول رسائل المعلّم الذكي
   - id, role, content, attachments
4. `cart_items` — جدول عناصر سلة التسوق في السوق
   - id, item_id, title, price, cover_url, type

## الأمان
- تفعيل RLS على جميع الجداول
- سياسات anon + authenticated للقراءة والكتابة (تطبيق بدون تسجيل دخول)
*/

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  instructor text NOT NULL,
  category text NOT NULL,
  lessons_count integer NOT NULL DEFAULT 0,
  duration text NOT NULL DEFAULT '0س',
  progress integer NOT NULL DEFAULT 0,
  enrolled integer NOT NULL DEFAULT 0,
  rating numeric(2,1) NOT NULL DEFAULT 0,
  cover_url text,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_name text NOT NULL,
  exam_title text NOT NULL,
  type text NOT NULL DEFAULT 'مقال',
  ai_grade integer NOT NULL DEFAULT 0,
  confidence integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'يحتاج مراجعة',
  language text DEFAULT 'AR',
  feedback text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL DEFAULT 'student',
  content text NOT NULL,
  attachments jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL,
  title text NOT NULL,
  price numeric(10,2) NOT NULL DEFAULT 0,
  cover_url text,
  type text NOT NULL DEFAULT 'دورة',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;

-- courses policies
DROP POLICY IF EXISTS "anon_select_courses" ON courses;
CREATE POLICY "anon_select_courses" ON courses FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_courses" ON courses;
CREATE POLICY "anon_insert_courses" ON courses FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_courses" ON courses;
CREATE POLICY "anon_update_courses" ON courses FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_courses" ON courses;
CREATE POLICY "anon_delete_courses" ON courses FOR DELETE TO anon, authenticated USING (true);

-- submissions policies
DROP POLICY IF EXISTS "anon_select_submissions" ON submissions;
CREATE POLICY "anon_select_submissions" ON submissions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_submissions" ON submissions;
CREATE POLICY "anon_insert_submissions" ON submissions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_submissions" ON submissions;
CREATE POLICY "anon_update_submissions" ON submissions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_submissions" ON submissions;
CREATE POLICY "anon_delete_submissions" ON submissions FOR DELETE TO anon, authenticated USING (true);

-- chat_messages policies
DROP POLICY IF EXISTS "anon_select_chat" ON chat_messages;
CREATE POLICY "anon_select_chat" ON chat_messages FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_chat" ON chat_messages;
CREATE POLICY "anon_insert_chat" ON chat_messages FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_chat" ON chat_messages;
CREATE POLICY "anon_delete_chat" ON chat_messages FOR DELETE TO anon, authenticated USING (true);

-- cart_items policies
DROP POLICY IF EXISTS "anon_select_cart" ON cart_items;
CREATE POLICY "anon_select_cart" ON cart_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_cart" ON cart_items;
CREATE POLICY "anon_insert_cart" ON cart_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_cart" ON cart_items;
CREATE POLICY "anon_delete_cart" ON cart_items FOR DELETE TO anon, authenticated USING (true);
