-- Phase 1A: institution-scoped learning outcomes.
-- This migration deliberately uses the existing subjects/questions tables and
-- keeps the question link optional for backwards compatibility.

CREATE TABLE IF NOT EXISTS public.learning_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  academic_year text,
  grade_level_id uuid REFERENCES public.grade_levels(id) ON DELETE SET NULL,
  unit text,
  lesson text,
  code text NOT NULL,
  name_ar text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_outcomes_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT learning_outcomes_name_not_blank CHECK (btrim(name_ar) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS learning_outcomes_unique_code
  ON public.learning_outcomes (institution_id, subject_id, lower(btrim(code)));

CREATE INDEX IF NOT EXISTS learning_outcomes_scope_idx
  ON public.learning_outcomes (institution_id, subject_id, status, display_order, code);

CREATE TABLE IF NOT EXISTS public.question_learning_outcomes (
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  learning_outcome_id uuid NOT NULL REFERENCES public.learning_outcomes(id) ON DELETE RESTRICT,
  weight numeric(6,5) NOT NULL DEFAULT 1 CHECK (weight > 0 AND weight <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, learning_outcome_id)
);

CREATE INDEX IF NOT EXISTS question_learning_outcomes_outcome_idx
  ON public.question_learning_outcomes (learning_outcome_id, question_id);

GRANT SELECT, INSERT, UPDATE ON public.learning_outcomes TO authenticated;
GRANT SELECT ON public.question_learning_outcomes TO authenticated;

CREATE OR REPLACE FUNCTION public.set_learning_outcome_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_learning_outcomes_updated_at ON public.learning_outcomes;
CREATE TRIGGER trg_learning_outcomes_updated_at
BEFORE UPDATE ON public.learning_outcomes
FOR EACH ROW EXECUTE FUNCTION public.set_learning_outcome_updated_at();

CREATE OR REPLACE FUNCTION public.validate_question_learning_outcome_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  question_institution uuid;
  question_subject uuid;
  outcome_institution uuid;
  outcome_subject uuid;
BEGIN
  SELECT q.institution_id, q.subject_id
  INTO question_institution, question_subject
  FROM public.questions q
  WHERE q.id = NEW.question_id;

  SELECT lo.institution_id, lo.subject_id
  INTO outcome_institution, outcome_subject
  FROM public.learning_outcomes lo
  WHERE lo.id = NEW.learning_outcome_id;

  IF question_institution IS NULL OR outcome_institution IS NULL THEN
    RAISE EXCEPTION 'learning_outcome_link_target_not_found';
  END IF;
  IF question_institution <> outcome_institution
     OR question_institution <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'learning_outcome_link_institution_denied';
  END IF;
  IF question_subject IS NULL OR question_subject <> outcome_subject THEN
    RAISE EXCEPTION 'learning_outcome_link_subject_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve the existing teacher ownership model for questions created through
-- the established SECURITY DEFINER question RPCs.
CREATE OR REPLACE FUNCTION public.assign_question_teacher_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.teacher_id IS NULL AND public.current_user_role() = 'teacher' THEN
    NEW.teacher_id := public.current_staff_profile_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_question_teacher_on_insert ON public.questions;
CREATE TRIGGER trg_assign_question_teacher_on_insert
BEFORE INSERT ON public.questions
FOR EACH ROW EXECUTE FUNCTION public.assign_question_teacher_on_insert();

DROP TRIGGER IF EXISTS trg_validate_question_learning_outcome_link ON public.question_learning_outcomes;
CREATE TRIGGER trg_validate_question_learning_outcome_link
BEFORE INSERT OR UPDATE ON public.question_learning_outcomes
FOR EACH ROW EXECUTE FUNCTION public.validate_question_learning_outcome_link();

ALTER TABLE public.learning_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_learning_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learning_outcomes_select ON public.learning_outcomes;
CREATE POLICY learning_outcomes_select ON public.learning_outcomes
FOR SELECT TO authenticated
USING (
  public.current_user_role() = 'super_admin'
  OR (
    institution_id = public.current_user_institution_id()
    AND public.current_user_role() IN ('school_admin', 'teacher', 'grader', 'data_entry')
  )
);

DROP POLICY IF EXISTS learning_outcomes_insert ON public.learning_outcomes;
CREATE POLICY learning_outcomes_insert ON public.learning_outcomes
FOR INSERT TO authenticated
WITH CHECK (
  institution_id = public.current_user_institution_id()
  AND public.current_user_role() IN ('super_admin', 'school_admin')
  AND EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.id = subject_id AND s.institution_id = institution_id
  )
);

DROP POLICY IF EXISTS learning_outcomes_update ON public.learning_outcomes;
CREATE POLICY learning_outcomes_update ON public.learning_outcomes
FOR UPDATE TO authenticated
USING (
  institution_id = public.current_user_institution_id()
  AND public.current_user_role() IN ('super_admin', 'school_admin')
)
WITH CHECK (
  institution_id = public.current_user_institution_id()
  AND public.current_user_role() IN ('super_admin', 'school_admin')
  AND EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.id = subject_id AND s.institution_id = institution_id
  )
);

-- Hard deletion is intentionally unavailable to the client. Archive instead.
DROP POLICY IF EXISTS learning_outcomes_delete ON public.learning_outcomes;
CREATE POLICY learning_outcomes_delete ON public.learning_outcomes
FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS question_learning_outcomes_select ON public.question_learning_outcomes;
CREATE POLICY question_learning_outcomes_select ON public.question_learning_outcomes
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = question_id
      AND (q.institution_id = public.current_user_institution_id() OR public.current_user_role() = 'super_admin')
  )
);

DROP POLICY IF EXISTS question_learning_outcomes_write ON public.question_learning_outcomes;
CREATE POLICY question_learning_outcomes_write ON public.question_learning_outcomes
FOR ALL TO authenticated
USING (
  public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
  AND EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = question_id AND q.institution_id = public.current_user_institution_id()
  )
)
WITH CHECK (
  public.current_user_role() IN ('super_admin', 'school_admin', 'teacher')
  AND EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = question_id AND q.institution_id = public.current_user_institution_id()
  )
);

CREATE OR REPLACE FUNCTION public.get_learning_outcomes(
  p_subject_id uuid DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS TABLE (
  id uuid,
  institution_id uuid,
  subject_id uuid,
  subject_name text,
  academic_year text,
  grade_level_id uuid,
  unit text,
  lesson text,
  code text,
  name_ar text,
  description text,
  status text,
  display_order integer,
  question_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE actor_role text := public.current_user_role();
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader', 'data_entry') THEN
    RAISE EXCEPTION 'learning_outcomes_read_not_allowed';
  END IF;

  RETURN QUERY
  SELECT lo.id, lo.institution_id, lo.subject_id, s.name, lo.academic_year,
    lo.grade_level_id, lo.unit, lo.lesson, lo.code, lo.name_ar, lo.description,
    lo.status, lo.display_order,
    count(qlo.question_id)::integer, lo.created_at, lo.updated_at
  FROM public.learning_outcomes lo
  JOIN public.subjects s ON s.id = lo.subject_id
  LEFT JOIN public.question_learning_outcomes qlo ON qlo.learning_outcome_id = lo.id
  WHERE (actor_role = 'super_admin' OR lo.institution_id = public.current_user_institution_id())
    AND (p_subject_id IS NULL OR lo.subject_id = p_subject_id)
    AND (p_status IS NULL OR p_status = 'all' OR lo.status = p_status)
  GROUP BY lo.id, s.name
  ORDER BY lo.display_order, lo.code, lo.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_question_learning_outcomes(
  p_question_id uuid,
  p_learning_outcome_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  question_institution uuid;
  question_subject uuid;
  requested_count integer := COALESCE(array_length(p_learning_outcome_ids, 1), 0);
  valid_count integer;
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'question_learning_outcomes_write_not_allowed';
  END IF;

  SELECT q.institution_id, q.subject_id INTO question_institution, question_subject
  FROM public.questions q WHERE q.id = p_question_id;
  IF question_institution IS NULL THEN RAISE EXCEPTION 'question_not_found'; END IF;
  IF question_institution <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'question_institution_denied';
  END IF;
  IF actor_role = 'teacher' AND NOT public.teacher_can_manage_question(p_question_id) THEN
    RAISE EXCEPTION 'question_scope_denied';
  END IF;

  SELECT count(*)::integer INTO valid_count
  FROM (
    SELECT DISTINCT value AS outcome_id FROM unnest(COALESCE(p_learning_outcome_ids, ARRAY[]::uuid[])) value
  ) requested
  JOIN public.learning_outcomes lo ON lo.id = requested.outcome_id
  WHERE lo.institution_id = question_institution AND lo.subject_id = question_subject;
  IF valid_count <> requested_count THEN
    RAISE EXCEPTION 'learning_outcome_scope_or_subject_denied';
  END IF;

  DELETE FROM public.question_learning_outcomes WHERE question_id = p_question_id;
  INSERT INTO public.question_learning_outcomes (question_id, learning_outcome_id, weight)
  SELECT p_question_id, value, 1.0 / NULLIF(requested_count, 0)
  FROM unnest(COALESCE(p_learning_outcome_ids, ARRAY[]::uuid[])) value;
  RETURN requested_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_learning_outcome_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_question_learning_outcome_link() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_question_teacher_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_learning_outcomes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_learning_outcomes(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.set_question_learning_outcomes(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_question_learning_outcomes(uuid, uuid[]) TO authenticated;
