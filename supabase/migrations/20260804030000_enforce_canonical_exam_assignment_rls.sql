/*
  Enforce the canonical exam path at the RLS boundary.

  The primary exam flow uses:
  examify_exams -> exam_questions -> exam_assignments -> exam_attempts -> answers.

  This migration does not remove legacy tables. It prevents students from reading
  or starting attempts for modern exams unless the exam is assigned to them.
*/

CREATE OR REPLACE FUNCTION public.is_exam_assigned_to_current_student(target_exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_profiles sp
    JOIN public.examify_exams e
      ON e.id = target_exam_id
      AND e.institution_id = sp.institution_id
    WHERE sp.user_id = auth.uid()
      AND sp.is_active = true
      AND EXISTS (
        SELECT 1
        FROM public.exam_assignments ea
        LEFT JOIN public.class_students cs
          ON cs.student_id = sp.id
          AND (
            cs.class_id = ea.class_id
            OR (ea.section_id IS NOT NULL AND cs.section_id = ea.section_id)
          )
        WHERE ea.exam_id = target_exam_id
          AND (
            ea.student_id = sp.id
            OR cs.id IS NOT NULL
          )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_exam_assigned_to_current_student(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_exam_assigned_to_current_student(uuid) TO authenticated;

DROP POLICY IF EXISTS "examify_exams_select" ON public.examify_exams;
CREATE POLICY "examify_exams_select" ON public.examify_exams FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (
      institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR (
      public.current_user_role() = 'student'
      AND institution_id = public.current_user_institution_id()
      AND status = 'published'
      AND public.is_exam_assigned_to_current_student(id)
    )
  );

DROP POLICY IF EXISTS "exam_attempts_insert" ON public.exam_attempts;
CREATE POLICY "exam_attempts_insert" ON public.exam_attempts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.student_profiles sp
      JOIN public.examify_exams e ON e.id = exam_attempts.exam_id
      WHERE sp.id = exam_attempts.student_id
        AND sp.user_id = auth.uid()
        AND sp.is_active = true
        AND e.institution_id = sp.institution_id
        AND e.status = 'published'
        AND (e.start_at IS NULL OR e.start_at <= now())
        AND (e.end_at IS NULL OR e.end_at >= now())
        AND public.is_exam_assigned_to_current_student(e.id)
    )
  );

DROP POLICY IF EXISTS "exam_attempts_update" ON public.exam_attempts;
CREATE POLICY "exam_attempts_update" ON public.exam_attempts FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.examify_exams e
      WHERE e.id = exam_attempts.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1 FROM public.student_profiles sp
      WHERE sp.id = exam_attempts.student_id
        AND sp.user_id = auth.uid()
        AND public.is_exam_assigned_to_current_student(exam_attempts.exam_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.examify_exams e
      WHERE e.id = exam_attempts.exam_id
      AND e.institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1 FROM public.student_profiles sp
      WHERE sp.id = exam_attempts.student_id
        AND sp.user_id = auth.uid()
        AND public.is_exam_assigned_to_current_student(exam_attempts.exam_id)
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_exam_attempt_canonical_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  max_allowed_attempts integer;
  existing_attempts integer;
BEGIN
  IF actor_role = 'student' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT e.max_attempts
      INTO max_allowed_attempts
      FROM public.examify_exams e
      JOIN public.student_profiles sp ON sp.id = NEW.student_id
      WHERE e.id = NEW.exam_id
        AND e.institution_id = sp.institution_id
        AND sp.user_id = auth.uid()
        AND sp.is_active = true
        AND e.status = 'published'
        AND (e.start_at IS NULL OR e.start_at <= now())
        AND (e.end_at IS NULL OR e.end_at >= now())
        AND public.is_exam_assigned_to_current_student(e.id);

      IF max_allowed_attempts IS NULL THEN
        RAISE EXCEPTION 'exam attempt is not allowed for this student';
      END IF;

      SELECT count(*)
      INTO existing_attempts
      FROM public.exam_attempts ea
      WHERE ea.exam_id = NEW.exam_id
        AND ea.student_id = NEW.student_id;

      IF existing_attempts >= max_allowed_attempts THEN
        RAISE EXCEPTION 'maximum attempts exceeded';
      END IF;

      IF NEW.status <> 'in_progress'
        OR NEW.score IS NOT NULL
        OR NEW.score_percentage IS NOT NULL
        OR NEW.is_passed IS NOT NULL
        OR NEW.graded_by IS NOT NULL
        OR NEW.graded_at IS NOT NULL
        OR NEW.approved_by IS NOT NULL
        OR NEW.approved_at IS NOT NULL
        OR NEW.is_result_published <> false THEN
        RAISE EXCEPTION 'students can only create clean in-progress attempts';
      END IF;

      RETURN NEW;
    END IF;

    IF OLD.status <> 'in_progress' THEN
      RAISE EXCEPTION 'submitted attempts are locked for students';
    END IF;

    IF NEW.exam_id IS DISTINCT FROM OLD.exam_id
      OR NEW.student_id IS DISTINCT FROM OLD.student_id
      OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
      OR NEW.score IS DISTINCT FROM OLD.score
      OR NEW.score_percentage IS DISTINCT FROM OLD.score_percentage
      OR NEW.is_passed IS DISTINCT FROM OLD.is_passed
      OR NEW.graded_by IS DISTINCT FROM OLD.graded_by
      OR NEW.graded_at IS DISTINCT FROM OLD.graded_at
      OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.is_result_published IS DISTINCT FROM OLD.is_result_published THEN
      RAISE EXCEPTION 'students cannot change administrative attempt fields';
    END IF;

    IF NEW.status NOT IN ('in_progress', 'submitted', 'auto_submitted') THEN
      RAISE EXCEPTION 'students cannot set grading or approval statuses';
    END IF;

    IF NEW.status IN ('submitted', 'auto_submitted') AND NEW.submitted_at IS NULL THEN
      NEW.submitted_at := now();
    END IF;

    RETURN NEW;
  END IF;

  IF actor_role IN ('school_admin', 'teacher', 'grader') THEN
    IF TG_OP = 'UPDATE'
      AND (
        NEW.exam_id IS DISTINCT FROM OLD.exam_id
        OR NEW.student_id IS DISTINCT FROM OLD.student_id
        OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
      ) THEN
      RAISE EXCEPTION 'attempt identity fields are immutable';
    END IF;

    RETURN NEW;
  END IF;

  IF actor_role = 'super_admin' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'role cannot write exam attempts';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_exam_attempt_canonical_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_exam_attempt_canonical_write ON public.exam_attempts;
CREATE TRIGGER trg_enforce_exam_attempt_canonical_write
  BEFORE INSERT OR UPDATE ON public.exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_exam_attempt_canonical_write();

CREATE OR REPLACE FUNCTION public.enforce_answer_canonical_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  attempt_status text;
BEGIN
  IF actor_role = 'student' THEN
    SELECT ea.status
    INTO attempt_status
    FROM public.exam_attempts ea
    JOIN public.student_profiles sp ON sp.id = ea.student_id
    WHERE ea.id = NEW.attempt_id
      AND sp.user_id = auth.uid();

    IF attempt_status IS NULL THEN
      RAISE EXCEPTION 'answer attempt is not owned by the current student';
    END IF;

    IF attempt_status <> 'in_progress' THEN
      RAISE EXCEPTION 'answers can only be changed while the attempt is in progress';
    END IF;

    IF TG_OP = 'UPDATE'
      AND (
        NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
        OR NEW.question_id IS DISTINCT FROM OLD.question_id
      ) THEN
      RAISE EXCEPTION 'answer identity fields are immutable';
    END IF;

    IF NEW.is_correct IS NOT NULL
      OR NEW.awarded_points IS NOT NULL
      OR NEW.grader_notes IS NOT NULL
      OR NEW.graded_by IS NOT NULL
      OR NEW.graded_at IS NOT NULL THEN
      RAISE EXCEPTION 'students cannot write grading fields';
    END IF;

    RETURN NEW;
  END IF;

  IF actor_role IN ('school_admin', 'teacher', 'grader') THEN
    IF TG_OP = 'UPDATE'
      AND (
        NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
        OR NEW.question_id IS DISTINCT FROM OLD.question_id
      ) THEN
      RAISE EXCEPTION 'answer identity fields are immutable';
    END IF;

    RETURN NEW;
  END IF;

  IF actor_role = 'super_admin' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'role cannot write answers';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_answer_canonical_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforce_answer_canonical_write ON public.answers;
CREATE TRIGGER trg_enforce_answer_canonical_write
  BEFORE INSERT OR UPDATE ON public.answers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_answer_canonical_write();
