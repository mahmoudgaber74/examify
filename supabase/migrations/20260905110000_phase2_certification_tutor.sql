/* Phase 2: authoritative certificate issuance and tenant-owned Tutor sessions. */
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES public.student_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS achievement_exam_id uuid REFERENCES public.examify_exams(id) ON DELETE SET NULL;
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked'));
ALTER TABLE public.certificates ADD COLUMN IF NOT EXISTS issued_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS certificates_student_exam_unique ON public.certificates(student_id, achievement_exam_id) WHERE student_id IS NOT NULL AND achievement_exam_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_certificate_for_exam(p_student_id uuid, p_exam_id uuid, p_issuer text)
RETURNS public.certificates LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.certificates%ROWTYPE; student public.student_profiles%ROWTYPE; exam public.examify_exams%ROWTYPE; attempt public.exam_attempts%ROWTYPE; credential text;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin','school_admin','teacher') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO student FROM public.student_profiles WHERE id = p_student_id AND institution_id = public.current_user_institution_id() AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'student_not_found'; END IF;
  SELECT * INTO exam FROM public.examify_exams WHERE id = p_exam_id AND institution_id = student.institution_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_not_found'; END IF;
  SELECT * INTO attempt FROM public.exam_attempts WHERE student_id = student.id AND exam_id = exam.id AND status IN ('graded','approved') AND is_passed = true AND is_result_published = true ORDER BY score_percentage DESC NULLS LAST, submitted_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'achievement_not_verified'; END IF;
  SELECT * INTO result FROM public.certificates WHERE student_id = student.id AND achievement_exam_id = exam.id LIMIT 1;
  IF FOUND THEN RETURN result; END IF;
  credential := 'EXM-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 20));
  INSERT INTO public.certificates (recipient, program, issuer, issued_date, issued_at, credential_id, verified_method, score, institution_id, issued_to_user_id, issued_by, student_id, achievement_exam_id, status)
    VALUES (student.full_name, exam.title, COALESCE(NULLIF(trim(p_issuer), ''), 'Examify'), CURRENT_DATE, now(), credential, 'Verified Certificate Record', round(attempt.score_percentage), student.institution_id, student.user_id, auth.uid(), student.id, exam.id, 'active') RETURNING * INTO result;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.issue_certificate_for_exam(uuid, uuid, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.tutor_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE, title text NOT NULL DEFAULT 'Tutor session', status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.tutor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.tutor_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL CHECK (role IN ('student','tutor')), content text NOT NULL CHECK (length(content) BETWEEN 1 AND 20000), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tutor_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tutor_conversations_owner ON public.tutor_conversations FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY tutor_messages_owner ON public.tutor_messages FOR ALL TO authenticated USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.tutor_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())) WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.tutor_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.get_or_create_tutor_conversation()
RETURNS public.tutor_conversations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.tutor_conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO result FROM public.tutor_conversations WHERE user_id = auth.uid() AND status = 'active' ORDER BY created_at LIMIT 1;
  IF FOUND THEN RETURN result; END IF;
  INSERT INTO public.tutor_conversations (user_id, institution_id) VALUES (auth.uid(), public.current_user_institution_id()) RETURNING * INTO result;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_or_create_tutor_conversation() TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_certificate(p_certificate_id uuid)
RETURNS public.certificates LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.certificates%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() NOT IN ('super_admin','school_admin','teacher') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.certificates
  SET status = 'revoked'
  WHERE id = p_certificate_id
    AND institution_id = public.current_user_institution_id()
    AND status = 'active'
  RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'certificate_not_found_or_already_revoked'; END IF;
  RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION public.revoke_certificate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_certificate_reactivation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN RAISE EXCEPTION 'revoked_certificate_cannot_be_reactivated'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS certificates_prevent_reactivation ON public.certificates;
CREATE TRIGGER certificates_prevent_reactivation BEFORE UPDATE ON public.certificates FOR EACH ROW EXECUTE FUNCTION public.prevent_certificate_reactivation();
