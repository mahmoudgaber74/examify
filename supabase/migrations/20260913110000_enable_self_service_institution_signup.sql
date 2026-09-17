/*
  Self-service institution onboarding.

  A school_admin signup with an institution name and no institution_id creates
  a new tenant and makes the new user its active owner. Joining an existing
  institution keeps the existing pending-approval behavior.
*/

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
  v_institution_name text;
  v_is_first_user boolean;
BEGIN
  v_role := NEW.raw_user_meta_data ->> 'role';
  v_institution_id := NULLIF(NEW.raw_user_meta_data ->> 'institution_id', '')::uuid;
  v_full_name := NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), '');
  v_phone := NULLIF(btrim(NEW.raw_user_meta_data ->> 'phone'), '');
  v_institution_name := NULLIF(btrim(NEW.raw_user_meta_data ->> 'institution_name'), '');

  SELECT NOT EXISTS(SELECT 1 FROM staff_profiles WHERE role = 'super_admin') INTO v_is_first_user;

  IF v_role = 'super_admin' AND v_is_first_user THEN
    INSERT INTO institutions (id, name, subscription_plan, subscription_status, created_by)
    VALUES (
      COALESCE(v_institution_id, gen_random_uuid()),
      COALESCE(v_institution_name, 'منصة إكزاميفاي الرئيسية'),
      'enterprise',
      'active',
      NEW.id
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT id INTO v_institution_id FROM institutions WHERE created_by = NEW.id LIMIT 1;

    INSERT INTO staff_profiles (user_id, institution_id, full_name, phone, role, is_active)
    VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'مدير النظام'), v_phone, 'super_admin', true);

  ELSIF v_role = 'school_admin' THEN
    IF v_institution_id IS NULL AND v_institution_name IS NOT NULL THEN
      IF char_length(v_institution_name) < 2 OR char_length(v_institution_name) > 160 THEN
        RAISE EXCEPTION 'institution_name_invalid';
      END IF;

      INSERT INTO institutions (name, subscription_plan, subscription_status, created_by)
      VALUES (v_institution_name, 'free', 'trial', NEW.id)
      RETURNING id INTO v_institution_id;

      INSERT INTO staff_profiles (user_id, institution_id, full_name, phone, role, is_active)
      VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'مدير المؤسسة'), v_phone, 'school_admin', true);
    ELSIF v_institution_id IS NOT NULL THEN
      INSERT INTO staff_profiles (user_id, institution_id, full_name, phone, role, is_active)
      VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'مدير المدرسة'), v_phone, 'school_admin', false);
    ELSE
      RAISE EXCEPTION 'school_admin_requires_institution';
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

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO anon, authenticated;
