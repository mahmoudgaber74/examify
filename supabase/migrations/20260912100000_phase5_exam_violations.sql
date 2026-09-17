-- Phase 5: client-side proctoring records only event metadata, never video.

CREATE TABLE IF NOT EXISTS public.exam_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  violation_type varchar(40) NOT NULL CHECK (violation_type IN ('TAB_SWITCH', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'COPY_ATTEMPT', 'PASTE_ATTEMPT', 'CONTEXT_MENU', 'MULTIPLE_FACES', 'NO_FACE', 'CAMERA_UNAVAILABLE')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_violations_attempt_created
  ON public.exam_violations(attempt_id, created_at DESC);

ALTER TABLE public.exam_violations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exam_violations FROM anon;
GRANT SELECT ON public.exam_violations TO authenticated;

DROP POLICY IF EXISTS exam_violations_select ON public.exam_violations;
CREATE POLICY exam_violations_select ON public.exam_violations
FOR SELECT TO authenticated USING (
  public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
  AND EXISTS (
    SELECT 1 FROM public.exam_attempts ea
    JOIN public.student_profiles sp ON sp.id = ea.student_id
    WHERE ea.id = exam_violations.attempt_id
      AND (public.current_user_role() = 'super_admin' OR sp.institution_id = public.current_user_institution_id())
  )
  OR EXISTS (
    SELECT 1 FROM public.exam_attempts ea
    JOIN public.student_profiles sp ON sp.id = ea.student_id
    WHERE ea.id = exam_violations.attempt_id AND sp.user_id = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION public.log_exam_violation(
  p_attempt_id uuid,
  p_violation_type varchar,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE violation_id uuid;
BEGIN
  IF public.current_user_role() <> 'student' THEN
    RAISE EXCEPTION 'exam_violation_student_only';
  END IF;
  IF p_violation_type NOT IN ('TAB_SWITCH', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'COPY_ATTEMPT', 'PASTE_ATTEMPT', 'CONTEXT_MENU', 'MULTIPLE_FACES', 'NO_FACE', 'CAMERA_UNAVAILABLE') THEN
    RAISE EXCEPTION 'exam_violation_type_invalid';
  END IF;
  IF p_description IS NULL OR char_length(p_description) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'exam_violation_description_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.exam_attempts ea
    JOIN public.student_profiles sp ON sp.id = ea.student_id
    WHERE ea.id = p_attempt_id AND ea.status = 'in_progress'
      AND sp.user_id = auth.uid() AND sp.is_active = true
  ) THEN
    RAISE EXCEPTION 'exam_violation_attempt_denied';
  END IF;
  INSERT INTO public.exam_violations(attempt_id, violation_type, description)
  VALUES (p_attempt_id, p_violation_type, p_description)
  RETURNING id INTO violation_id;
  RETURN violation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_exam_violation(uuid, varchar, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_exam_violation(uuid, varchar, text) TO authenticated;

