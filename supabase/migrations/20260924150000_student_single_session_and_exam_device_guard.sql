/*
  Student account/session protection.

  A Supabase auth token is still the authentication credential, but a student
  account is allowed only one active browser session at a time. The database
  owns the decision so a copied token cannot bypass the UI. During an active
  attempt, a second device is also detected and blocked while the first device
  has a recent heartbeat.

  This migration is additive and does not remove or rewrite existing data.
*/
BEGIN;

CREATE TABLE IF NOT EXISTS public.student_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  auth_session_id text NOT NULL CHECK (char_length(auth_session_id) BETWEEN 10 AND 200),
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 8 AND 200),
  device_label text CHECK (device_label IS NULL OR char_length(device_label) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS student_sessions_user_auth_session_key
  ON public.student_sessions(user_id, auth_session_id);
CREATE INDEX IF NOT EXISTS student_sessions_student_active_idx
  ON public.student_sessions(student_id, revoked_at, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.student_exam_device_locks (
  attempt_id uuid PRIMARY KEY REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  auth_session_id text NOT NULL,
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 8 AND 200),
  device_label text CHECK (device_label IS NULL OR char_length(device_label) <= 500),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.student_exam_device_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  active_auth_session_id text NOT NULL,
  active_device_id text NOT NULL,
  rejected_auth_session_id text NOT NULL,
  rejected_device_id text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_exam_device_conflicts_attempt_idx
  ON public.student_exam_device_conflicts(attempt_id, detected_at DESC);

ALTER TABLE public.student_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_exam_device_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_exam_device_conflicts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_sessions FROM anon, authenticated;
REVOKE ALL ON public.student_exam_device_locks FROM anon, authenticated;
REVOKE ALL ON public.student_exam_device_conflicts FROM anon, authenticated;
GRANT SELECT ON public.student_sessions TO authenticated;
GRANT SELECT ON public.student_exam_device_conflicts TO authenticated;

DROP POLICY IF EXISTS student_sessions_select_own ON public.student_sessions;
CREATE POLICY student_sessions_select_own ON public.student_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS student_sessions_staff_select ON public.student_sessions;
CREATE POLICY student_sessions_staff_select ON public.student_sessions
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND (
      public.current_user_role() = 'super_admin'
      OR institution_id = public.current_user_institution_id()
    )
  );

DROP POLICY IF EXISTS student_exam_device_conflicts_select ON public.student_exam_device_conflicts;
CREATE POLICY student_exam_device_conflicts_select ON public.student_exam_device_conflicts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_profiles sp
      WHERE sp.id = student_exam_device_conflicts.student_id
        AND sp.user_id = auth.uid()
    )
    OR public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND EXISTS (
      SELECT 1 FROM public.student_profiles staff_scope
      WHERE staff_scope.id = student_exam_device_conflicts.student_id
        AND (
          public.current_user_role() = 'super_admin'
          OR staff_scope.institution_id = public.current_user_institution_id()
        )
    )
  );

CREATE OR REPLACE FUNCTION public.current_auth_session_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(auth.jwt() ->> 'session_id', '');
$$;

CREATE OR REPLACE FUNCTION public.student_session_is_current()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.current_user_role() <> 'student'
    OR EXISTS (
      SELECT 1
      FROM public.student_sessions ss
      WHERE ss.user_id = auth.uid()
        AND ss.auth_session_id = public.current_auth_session_id()
        AND ss.revoked_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.current_auth_session_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_session_is_current() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_auth_session_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_session_is_current() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_student_session(
  p_device_id text,
  p_device_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  student_row public.student_profiles%ROWTYPE;
  current_session_id text := public.current_auth_session_id();
  revoked_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'student' THEN
    RAISE EXCEPTION 'student_required';
  END IF;
  IF current_session_id IS NULL THEN
    RAISE EXCEPTION 'auth_session_id_missing';
  END IF;
  IF p_device_id IS NULL OR char_length(p_device_id) < 8 OR char_length(p_device_id) > 200 THEN
    RAISE EXCEPTION 'invalid_device_id';
  END IF;

  SELECT * INTO student_row
  FROM public.student_profiles
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'student_profile_not_found'; END IF;

  UPDATE public.student_sessions
  SET revoked_at = now(), revoke_reason = 'new_login'
  WHERE user_id = auth.uid()
    AND revoked_at IS NULL
    AND auth_session_id <> current_session_id;
  GET DIAGNOSTICS revoked_count = ROW_COUNT;

  INSERT INTO public.student_sessions (
    user_id, student_id, institution_id, auth_session_id, device_id, device_label,
    last_seen_at, revoked_at, revoke_reason
  ) VALUES (
    auth.uid(), student_row.id, student_row.institution_id, current_session_id,
    p_device_id, NULLIF(left(coalesce(p_device_label, ''), 500), ''),
    now(), NULL, NULL
  )
  ON CONFLICT (user_id, auth_session_id) DO UPDATE
  SET student_id = EXCLUDED.student_id,
      institution_id = EXCLUDED.institution_id,
      device_id = EXCLUDED.device_id,
      device_label = EXCLUDED.device_label,
      last_seen_at = now(),
      revoked_at = NULL,
      revoke_reason = NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', current_session_id,
    'revoked_sessions', revoked_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_student_session(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'student' THEN RETURN false; END IF;
  UPDATE public.student_sessions
  SET last_seen_at = now()
  WHERE user_id = auth.uid()
    AND auth_session_id = public.current_auth_session_id()
    AND device_id = p_device_id
    AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_student_session(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_student_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_student_session(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_student_session(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_student_exam_device(
  p_attempt_id uuid,
  p_device_id text,
  p_device_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  attempt_row public.exam_attempts%ROWTYPE;
  device_row public.student_exam_device_locks%ROWTYPE;
  current_session_id text := public.current_auth_session_id();
  recent_window interval := interval '45 seconds';
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'student' OR NOT public.student_session_is_current() THEN
    RAISE EXCEPTION 'student_session_not_current';
  END IF;
  IF p_device_id IS NULL OR char_length(p_device_id) < 8 OR char_length(p_device_id) > 200 THEN
    RAISE EXCEPTION 'invalid_device_id';
  END IF;

  SELECT ea.* INTO attempt_row
  FROM public.exam_attempts ea
  JOIN public.student_profiles sp ON sp.id = ea.student_id
  WHERE ea.id = p_attempt_id
    AND ea.status = 'in_progress'
    AND sp.user_id = auth.uid()
    AND sp.is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found_or_forbidden'; END IF;

  SELECT * INTO device_row
  FROM public.student_exam_device_locks
  WHERE attempt_id = p_attempt_id
  FOR UPDATE;

  IF FOUND
    AND device_row.auth_session_id = current_session_id
    AND device_row.device_id = p_device_id THEN
    UPDATE public.student_exam_device_locks
    SET last_seen_at = now(), device_label = NULLIF(left(coalesce(p_device_label, ''), 500), '')
    WHERE attempt_id = p_attempt_id;
    RETURN jsonb_build_object('allowed', true, 'reason', 'same_device');
  END IF;

  IF FOUND AND device_row.last_seen_at > now() - recent_window THEN
    INSERT INTO public.student_exam_device_conflicts (
      attempt_id, student_id, active_auth_session_id, active_device_id,
      rejected_auth_session_id, rejected_device_id
    ) VALUES (
      p_attempt_id, attempt_row.student_id, device_row.auth_session_id, device_row.device_id,
      current_session_id, p_device_id
    );
    UPDATE public.student_exam_device_locks
    SET conflict_count = conflict_count + 1
    WHERE attempt_id = p_attempt_id;
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'another_device_active',
      'retry_after_seconds', greatest(1, 45 - floor(extract(epoch FROM (now() - device_row.last_seen_at)))::integer)
    );
  END IF;

  IF FOUND THEN
    UPDATE public.student_exam_device_locks
    SET student_id = attempt_row.student_id,
        auth_session_id = current_session_id,
        device_id = p_device_id,
        device_label = NULLIF(left(coalesce(p_device_label, ''), 500), ''),
        first_seen_at = now(),
        last_seen_at = now()
    WHERE attempt_id = p_attempt_id;
  ELSE
    INSERT INTO public.student_exam_device_locks (
      attempt_id, student_id, auth_session_id, device_id, device_label
    ) VALUES (
      p_attempt_id, attempt_row.student_id, current_session_id, p_device_id,
      NULLIF(left(coalesce(p_device_label, ''), 500), '')
    );
  END IF;
  RETURN jsonb_build_object('allowed', true, 'reason', 'claimed');
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_student_exam_device(
  p_attempt_id uuid,
  p_device_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'student' OR NOT public.student_session_is_current() THEN RETURN false; END IF;
  UPDATE public.student_exam_device_locks dl
  SET last_seen_at = now()
  FROM public.exam_attempts ea
  JOIN public.student_profiles sp ON sp.id = ea.student_id
  WHERE dl.attempt_id = p_attempt_id
    AND dl.attempt_id = ea.id
    AND ea.status = 'in_progress'
    AND sp.user_id = auth.uid()
    AND dl.auth_session_id = public.current_auth_session_id()
    AND dl.device_id = p_device_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_student_exam_device(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_student_exam_device(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_student_exam_device(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_student_exam_device(uuid, text) TO authenticated;

/* Add the guard as a restrictive policy so existing tenant/ownership policies
   remain intact while every student read/write requires the current session. */
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'examify_exams', 'exam_sections', 'exam_questions', 'exam_assignments',
    'exam_attempts', 'answers', 'questions', 'question_options', 'exam_violations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS student_current_session_guard ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY student_current_session_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_user_role() <> ''student'' OR public.student_session_is_current()) WITH CHECK (public.current_user_role() <> ''student'' OR public.student_session_is_current())',
      table_name
    );
  END LOOP;
END;
$$;

/* SECURITY DEFINER lifecycle RPCs must also reject a revoked session because
   SECURITY DEFINER functions do not rely on caller-side RLS policies. */
CREATE OR REPLACE FUNCTION public.is_exam_assigned_to_current_student(target_exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.student_session_is_current()
    AND EXISTS (
      SELECT 1
      FROM public.student_profiles sp
      JOIN public.examify_exams e
        ON e.id = target_exam_id
        AND e.institution_id = sp.institution_id
      JOIN public.exam_assignments ea ON ea.exam_id = e.id
      LEFT JOIN public.class_students cs
        ON cs.student_id = sp.id
       AND cs.status = 'active'
       AND cs.institution_id = sp.institution_id
       AND (
         (ea.section_id IS NULL AND ea.class_id IS NOT NULL AND cs.class_id = ea.class_id)
         OR (ea.section_id IS NOT NULL AND cs.section_id = ea.section_id)
       )
      WHERE sp.user_id = auth.uid()
        AND sp.is_active = true
        AND (ea.student_id = sp.id OR cs.id IS NOT NULL)
    );
$$;

REVOKE ALL ON FUNCTION public.is_exam_assigned_to_current_student(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_exam_assigned_to_current_student(uuid) TO authenticated;

COMMIT;
