/*
  Production repair: public signup can create/join a tenant, but can never
  self-assign the system super-admin role. The trigger is the authority for
  the first institution owner and ignores privileged client metadata.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_requested_role text := NEW.raw_user_meta_data ->> 'role';
  v_role text;
  v_institution_id uuid := NULLIF(NEW.raw_user_meta_data ->> 'institution_id', '')::uuid;
  v_full_name text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), '');
  v_phone text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'phone'), '');
  v_institution_name text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'institution_name'), '');
BEGIN
  IF v_institution_id IS NULL AND v_institution_name IS NOT NULL THEN
    v_role := 'school_admin';
  ELSIF v_requested_role IN ('school_admin', 'teacher', 'student', 'parent') THEN
    v_role := v_requested_role;
  ELSE
    RETURN NEW;
  END IF;

  IF v_role = 'school_admin' THEN
    IF v_institution_id IS NULL AND v_institution_name IS NOT NULL THEN
      IF char_length(v_institution_name) < 2 OR char_length(v_institution_name) > 160 THEN
        RAISE EXCEPTION 'institution_name_invalid';
      END IF;
      INSERT INTO public.institutions (name, subscription_plan, subscription_status, created_by)
      VALUES (v_institution_name, 'free', 'trial', NEW.id)
      RETURNING id INTO v_institution_id;
      INSERT INTO public.staff_profiles (user_id, institution_id, full_name, phone, role, is_active)
      VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'مدير المؤسسة'), v_phone, 'school_admin', true);
    ELSIF v_institution_id IS NOT NULL THEN
      INSERT INTO public.staff_profiles (user_id, institution_id, full_name, phone, role, is_active)
      VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'مدير المدرسة'), v_phone, 'school_admin', false);
    ELSE
      RAISE EXCEPTION 'school_admin_requires_institution';
    END IF;
  ELSIF v_role = 'teacher' AND v_institution_id IS NOT NULL THEN
    INSERT INTO public.staff_profiles (user_id, institution_id, full_name, phone, role, is_active)
    VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'معلم'), v_phone, 'teacher', false);
  ELSIF v_role = 'student' AND v_institution_id IS NOT NULL THEN
    INSERT INTO public.student_profiles (user_id, institution_id, full_name, phone, is_active)
    VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'طالب'), v_phone, true);
  ELSIF v_role = 'parent' AND v_institution_id IS NOT NULL THEN
    INSERT INTO public.parent_profiles (user_id, institution_id, full_name, phone, is_active)
    VALUES (NEW.id, v_institution_id, COALESCE(v_full_name, 'ولي أمر'), v_phone, true);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
