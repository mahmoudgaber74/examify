/*
# تحديث نظام الأدوار والتسجيل الذاتي

## التغييرات
1. تحديث `current_user_role()` لقراءة الدور من جداول الملفات بدلاً من JWT
2. إضافة سياسات التسجيل الذاتي للطلاب وأولياء الأمور
3. إنشاء Trigger على auth.users لإنشاء الملف الشخصي تلقائياً عند التسجيل
4. دالة لإنشاء ملف الموظف عند الحاجة (عبر edge function لاحقاً)

## الأمان
- الطلاب وأولياء الأمور يمكنهم تسجيل حسابهم بأنفسهم مع تحديد المؤسسة
- المعلمون والموظفون لا يمكنهم التسجيل الذاتي — يجب إنشاؤهم من مدير المؤسسة
- أول مستخدم يسجل ويختار "مدير النظام" يصبح super_admin تلقائياً (bootstrap)
*/

-- ============================================================
-- تحديث current_user_role() لقراءة الدور من جداول الملفات
-- هذا أكثر أماناً لأن الدور يحدده قاعدة البيانات وليس المستخدم
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM staff_profiles WHERE user_id = auth.uid() AND is_active = true) THEN
      (SELECT role FROM staff_profiles WHERE user_id = auth.uid() AND is_active = true LIMIT 1)
    WHEN EXISTS (SELECT 1 FROM student_profiles WHERE user_id = auth.uid() AND is_active = true) THEN
      'student'
    WHEN EXISTS (SELECT 1 FROM parent_profiles WHERE user_id = auth.uid() AND is_active = true) THEN
      'parent'
    ELSE 'anonymous'
  END;
$$;

-- ============================================================
-- دالة لإنشاء الملف الشخصي تلقائياً عند التسجيل
-- تقرأ البيانات من raw_user_meta_data التي يرسلها المستخدم عند التسجيل
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_institution_id uuid;
  v_full_name text;
  v_phone text;
  v_is_first_user boolean;
BEGIN
  v_role := NEW.raw_user_meta_data ->> 'role';
  v_institution_id := (NEW.raw_user_meta_data ->> 'institution_id')::uuid;
  v_full_name := NEW.raw_user_meta_data ->> 'full_name';
  v_phone := NEW.raw_user_meta_data ->> 'phone';

  -- التحقق هل هذا أول مستخدم (bootstrap super_admin)
  SELECT NOT EXISTS(SELECT 1 FROM staff_profiles WHERE role = 'super_admin') INTO v_is_first_user;

  IF v_role = 'super_admin' AND v_is_first_user THEN
    -- إنشاء مؤسسة افتراضية للمدير الأول
    INSERT INTO institutions (id, name, subscription_plan, subscription_status, created_by)
    VALUES (
      COALESCE(v_institution_id, gen_random_uuid()),
      COALESCE(NEW.raw_user_meta_data ->> 'institution_name', 'منصة إكزاميفاي الرئيسية'),
      'enterprise',
      'active',
      NEW.id
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT id INTO v_institution_id FROM institutions WHERE created_by = NEW.id LIMIT 1;

    INSERT INTO staff_profiles (user_id, institution_id, full_name, phone, role, is_active)
    VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'مدير النظام'), v_phone, 'super_admin', true);

  ELSIF v_role = 'school_admin' THEN
    -- مدير مدرسة: يحتاج مؤسسة موجودة، يتم تفعيله لاحقاً
    IF v_institution_id IS NOT NULL THEN
      INSERT INTO staff_profiles (user_id, institution_id, full_name, phone, role, is_active)
      VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'مدير مدرسة'), v_phone, 'school_admin', false);
    END IF;

  ELSIF v_role = 'teacher' THEN
    IF v_institution_id IS NOT NULL THEN
      INSERT INTO staff_profiles (user_id, institution_id, full_name, phone, role, is_active)
      VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'معلم'), v_phone, 'teacher', false);
    END IF;

  ELSIF v_role = 'student' THEN
    IF v_institution_id IS NOT NULL THEN
      INSERT INTO student_profiles (user_id, institution_id, full_name, phone, is_active)
      VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'طالب'), v_phone, true);
    END IF;

  ELSIF v_role = 'parent' THEN
    IF v_institution_id IS NOT NULL THEN
      INSERT INTO parent_profiles (user_id, institution_id, full_name, phone, is_active)
      VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'ولي أمر'), v_phone, true);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- إنشاء الـ trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- سياسات التسجيل الذاتي للطلاب وأولياء الأمور
-- تسمح للمستخدم بإدراج ملفه الشخصي فقط (وليس ملفات الآخرين)
-- ============================================================

-- الطلاب: يمكنهم إدراج ملفهم الشخصي فقط
DROP POLICY IF EXISTS "student_profiles_self_insert" ON student_profiles;
CREATE POLICY "student_profiles_self_insert" ON student_profiles FOR INSERT
  TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND public.current_user_role() = 'anonymous'
  );

-- أولياء الأمور: يمكنهم إدراج ملفهم الشخصي فقط
DROP POLICY IF EXISTS "parent_profiles_self_insert" ON parent_profiles;
CREATE POLICY "parent_profiles_self_insert" ON parent_profiles FOR INSERT
  TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND public.current_user_role() = 'anonymous'
  );