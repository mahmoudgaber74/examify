CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON public.user_notifications(user_id, created_at DESC);
DROP POLICY IF EXISTS user_notifications_select ON public.user_notifications;
CREATE POLICY user_notifications_select ON public.user_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS user_notifications_update ON public.user_notifications;
CREATE POLICY user_notifications_update ON public.user_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.user_notifications FROM anon;
GRANT SELECT, UPDATE ON public.user_notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_staff_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active IS TRUE AND OLD.is_active IS FALSE THEN
    INSERT INTO public.user_notifications (user_id, institution_id, type, title, message)
    VALUES (NEW.user_id, NEW.institution_id, 'account', 'تم تفعيل حسابك', 'يمكنك الآن تسجيل الدخول واستخدام النظام.');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_staff_activation ON public.staff_profiles;
CREATE TRIGGER trg_notify_staff_activation AFTER UPDATE OF is_active ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION public.notify_staff_activation();

CREATE OR REPLACE FUNCTION public.notify_published_exam_result()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid; v_institution_id uuid; v_exam_title text;
BEGIN
  IF NEW.is_result_published IS TRUE AND OLD.is_result_published IS FALSE THEN
    SELECT sp.user_id, sp.institution_id, e.title INTO v_user_id, v_institution_id, v_exam_title
      FROM public.exam_assignments ea JOIN public.student_profiles sp ON sp.id = ea.student_id JOIN public.examify_exams e ON e.id = NEW.exam_id
      WHERE ea.student_id = NEW.student_id AND ea.exam_id = NEW.exam_id LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, institution_id, type, title, message)
      VALUES (v_user_id, v_institution_id, 'result', 'تم نشر نتيجة الامتحان', 'تم نشر نتيجتك في امتحان: ' || COALESCE(v_exam_title, 'الامتحان') || '.');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notify_published_exam_result ON public.exam_attempts;
CREATE TRIGGER trg_notify_published_exam_result AFTER UPDATE OF is_result_published ON public.exam_attempts FOR EACH ROW EXECUTE FUNCTION public.notify_published_exam_result();
