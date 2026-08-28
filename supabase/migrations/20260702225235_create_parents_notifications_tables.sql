/*
# نظام أولياء الأمور والإشعارات

## الجداول:
1. `parents` — بيانات أولياء الأمور
2. `parent_students` — ربط أولياء الأمور بالطلاب
3. `notifications` — الإشعارات
4. `notification_preferences` — تفضيلات الإشعارات

## الأمان:
- RLS مفعل على جميع الجداول
- سياسات anon + authenticated للوصول العام
*/

-- جدول أولياء الأمور
CREATE TABLE IF NOT EXISTS parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL UNIQUE,
  email text,
  whatsapp_opt_in boolean NOT NULL DEFAULT true,
  language text NOT NULL DEFAULT 'ar',
  created_at timestamptz DEFAULT now(),
  last_active timestamptz
);

-- جدول ربط أولياء الأمور بالطلاب
CREATE TABLE IF NOT EXISTS parent_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'ولي أمر',
  is_primary boolean NOT NULL DEFAULT false,
  can_view_grades boolean NOT NULL DEFAULT true,
  can_view_attendance boolean NOT NULL DEFAULT true,
  can_receive_alerts boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(parent_id, student_id)
);

-- جدول الإشعارات
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES parents(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  channel text NOT NULL DEFAULT 'app',
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- جدول تفضيلات الإشعارات
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid UNIQUE REFERENCES parents(id) ON DELETE CASCADE,
  exam_results boolean NOT NULL DEFAULT true,
  attendance_alerts boolean NOT NULL DEFAULT true,
  grade_updates boolean NOT NULL DEFAULT true,
  behavior_notes boolean NOT NULL DEFAULT true,
  schedule_changes boolean NOT NULL DEFAULT true,
  payment_reminders boolean NOT NULL DEFAULT true,
  weekly_reports boolean NOT NULL DEFAULT true,
  ai_insights boolean NOT NULL DEFAULT false,
  quiet_hours_start time DEFAULT '22:00',
  quiet_hours_end time DEFAULT '07:00',
  created_at timestamptz DEFAULT now()
);

-- تفعيل RLS
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- سياسات parents
DROP POLICY IF EXISTS "anon_select_parents" ON parents;
CREATE POLICY "anon_select_parents" ON parents FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_parents" ON parents;
CREATE POLICY "anon_insert_parents" ON parents FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_parents" ON parents;
CREATE POLICY "anon_update_parents" ON parents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_parents" ON parents;
CREATE POLICY "anon_delete_parents" ON parents FOR DELETE TO anon, authenticated USING (true);

-- سياسات parent_students
DROP POLICY IF EXISTS "anon_select_parent_students" ON parent_students;
CREATE POLICY "anon_select_parent_students" ON parent_students FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_parent_students" ON parent_students;
CREATE POLICY "anon_insert_parent_students" ON parent_students FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_parent_students" ON parent_students;
CREATE POLICY "anon_update_parent_students" ON parent_students FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_parent_students" ON parent_students;
CREATE POLICY "anon_delete_parent_students" ON parent_students FOR DELETE TO anon, authenticated USING (true);

-- سياسات notifications
DROP POLICY IF EXISTS "anon_select_notifications" ON notifications;
CREATE POLICY "anon_select_notifications" ON notifications FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_notifications" ON notifications;
CREATE POLICY "anon_insert_notifications" ON notifications FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_notifications" ON notifications;
CREATE POLICY "anon_update_notifications" ON notifications FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_notifications" ON notifications;
CREATE POLICY "anon_delete_notifications" ON notifications FOR DELETE TO anon, authenticated USING (true);

-- سياسات notification_preferences
DROP POLICY IF EXISTS "anon_select_notification_preferences" ON notification_preferences;
CREATE POLICY "anon_select_notification_preferences" ON notification_preferences FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_notification_preferences" ON notification_preferences;
CREATE POLICY "anon_insert_notification_preferences" ON notification_preferences FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_notification_preferences" ON notification_preferences;
CREATE POLICY "anon_update_notification_preferences" ON notification_preferences FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_notification_preferences" ON notification_preferences;
CREATE POLICY "anon_delete_notification_preferences" ON notification_preferences FOR DELETE TO anon, authenticated USING (true);

-- إدخال بيانات تجريبية لأولياء الأمور
INSERT INTO parents (id, name, phone, email, whatsapp_opt_in, language) VALUES
  ('11111111-1111-1111-1111-111111111111', 'أحمد محمد العلي', '+966501234567', 'ahmed.ali@email.com', true, 'ar'),
  ('22222222-2222-2222-2222-222222222222', 'فاطمة خالد السالم', '+966509876543', 'fatima.salem@email.com', true, 'ar'),
  ('33333333-3333-3333-3333-333333333333', 'محمد عبدالله الغامدي', '+201001234567', 'm.gamdi@email.com', true, 'ar')
ON CONFLICT (phone) DO NOTHING;

-- إدخال بيانات تجريبية للربط
INSERT INTO parent_students (parent_id, student_id, relationship, is_primary) 
SELECT '11111111-1111-1111-1111-111111111111', id, 'أب', true FROM students LIMIT 1
ON CONFLICT (parent_id, student_id) DO NOTHING;

INSERT INTO parent_students (parent_id, student_id, relationship, is_primary) 
SELECT '22222222-2222-2222-2222-222222222222', id, 'أم', true FROM students OFFSET 1 LIMIT 1
ON CONFLICT (parent_id, student_id) DO NOTHING;

-- إدخال إشعارات تجريبية
INSERT INTO notifications (parent_id, type, title, message, priority, channel, status, sent_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'exam_result', 'نتيجة امتحان جديد', 'حصل عبدالله على 92% في امتحان الرياضيات', 'high', 'whatsapp', 'sent', now() - interval '2 hours'),
  ('11111111-1111-1111-1111-111111111111', 'attendance', 'تنبيه حضور', 'تم تسجيل غياب عبدالله اليوم', 'urgent', 'whatsapp', 'sent', now() - interval '30 minutes'),
  ('22222222-2222-2222-2222-222222222222', 'grade_update', 'تحديث درجة', 'تم رفع درجة واجب العلوم', 'normal', 'app', 'pending', null),
  ('33333333-3333-3333-3333-333333333333', 'weekly_report', 'التقرير الأسبوعي', 'التقرير الأسبوعي لابنكم جاهز للمراجعة', 'normal', 'email', 'pending', null);

-- إدخال تفضيلات تجريبية
INSERT INTO notification_preferences (parent_id) VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333')
ON CONFLICT (parent_id) DO NOTHING;