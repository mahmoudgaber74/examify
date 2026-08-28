-- Complete OMR review/approval into the modern exam flow.
-- No legacy exams/submissions writes are performed here.

ALTER TABLE public.omr_results
  ADD COLUMN IF NOT EXISTS exam_attempt_id uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS processing_error text;

ALTER TABLE public.omr_results
  ALTER COLUMN score TYPE numeric(8,2) USING score::numeric;

ALTER TABLE public.omr_answers
  ADD COLUMN IF NOT EXISTS question_id uuid REFERENCES public.questions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS option_id uuid REFERENCES public.question_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS fill_ratios jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS manually_reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS manually_reviewed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS omr_results_exam_attempt_unique
  ON public.omr_results(exam_attempt_id)
  WHERE exam_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_omr_results_student_profile
  ON public.omr_results(student_profile_id)
  WHERE student_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_omr_answers_question
  ON public.omr_answers(question_id)
  WHERE question_id IS NOT NULL;

DROP POLICY IF EXISTS "question_options_omr_result_answers_select" ON public.question_options;
CREATE POLICY "question_options_omr_result_answers_select" ON public.question_options FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1
      FROM public.answers a
      JOIN public.exam_attempts ea ON ea.id = a.attempt_id
      JOIN public.examify_exams e ON e.id = ea.exam_id
      WHERE a.option_id = question_options.id
        AND e.institution_id = public.current_user_institution_id()
        AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
    OR EXISTS (
      SELECT 1
      FROM public.answers a
      JOIN public.exam_attempts ea ON ea.id = a.attempt_id
      JOIN public.student_profiles sp ON sp.id = ea.student_id
      WHERE a.option_id = question_options.id
        AND sp.user_id = auth.uid()
        AND ea.is_result_published = true
    )
  );

CREATE OR REPLACE FUNCTION public.omr_student_is_assigned(target_exam_id uuid, target_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.examify_exams e
    JOIN public.student_profiles sp ON sp.id = target_student_id
    WHERE e.id = target_exam_id
      AND e.institution_id = sp.institution_id
      AND e.status = 'published'
      AND sp.is_active = true
      AND (
        EXISTS (
          SELECT 1
          FROM public.exam_assignments ea
          WHERE ea.exam_id = e.id
            AND ea.student_id = sp.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.exam_assignments ea
          JOIN public.class_students cs ON cs.student_id = sp.id
          WHERE ea.exam_id = e.id
            AND ea.class_id = cs.class_id
            AND (ea.section_id IS NULL OR ea.section_id = cs.section_id)
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.omr_student_is_assigned(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.omr_approval_allowed(target_result_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.omr_results r
    WHERE r.id = target_result_id
      AND (
        public.current_user_role() = 'super_admin'
        OR (
          r.institution_id = public.current_user_institution_id()
          AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.omr_approval_allowed(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.approve_omr_result(
  p_omr_result_id uuid,
  p_student_profile_id uuid DEFAULT NULL
)
RETURNS TABLE (
  omr_result_id uuid,
  exam_attempt_id uuid,
  score numeric,
  total_points numeric,
  score_percentage numeric,
  is_passed boolean,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  result_row public.omr_results%ROWTYPE;
  student_id_to_use uuid;
  attempt_id_to_use uuid;
  next_attempt_number integer;
  objective_total numeric := 0;
  awarded_total numeric := 0;
  exam_total numeric := 0;
  passing numeric := 0;
  manual_questions integer := 0;
  unresolved_answers integer := 0;
  expected_questions integer := 0;
  detected_questions integer := 0;
  percentage numeric := 0;
  passed boolean := false;
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'omr_review_not_allowed';
  END IF;

  SELECT *
  INTO result_row
  FROM public.omr_results
  WHERE id = p_omr_result_id
  FOR UPDATE;

  IF result_row.id IS NULL THEN
    RAISE EXCEPTION 'omr_result_not_found';
  END IF;

  IF actor_role <> 'super_admin' AND result_row.institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'omr_result_institution_denied';
  END IF;

  student_id_to_use := COALESCE(p_student_profile_id, result_row.student_profile_id);
  IF student_id_to_use IS NULL THEN
    RAISE EXCEPTION 'omr_student_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.student_profiles sp
    WHERE sp.id = student_id_to_use
      AND sp.institution_id = result_row.institution_id
      AND sp.is_active = true
  ) THEN
    RAISE EXCEPTION 'omr_student_invalid';
  END IF;

  IF NOT public.omr_student_is_assigned(result_row.exam_id, student_id_to_use) THEN
    RAISE EXCEPTION 'omr_student_not_assigned';
  END IF;

  SELECT count(*)
  INTO unresolved_answers
  FROM public.omr_answers oa
  WHERE oa.omr_result_id = result_row.id
    AND oa.needs_manual_review = true;

  IF unresolved_answers > 0 THEN
    RAISE EXCEPTION 'omr_unresolved_review_items';
  END IF;

  SELECT count(*)
  INTO expected_questions
  FROM public.exam_questions eq
  WHERE eq.exam_id = result_row.exam_id;

  SELECT count(*)
  INTO detected_questions
  FROM public.omr_answers oa
  WHERE oa.omr_result_id = result_row.id;

  IF expected_questions = 0 OR detected_questions <> expected_questions THEN
    RAISE EXCEPTION 'omr_question_count_mismatch';
  END IF;

  SELECT count(*)
  INTO manual_questions
  FROM public.exam_questions eq
  JOIN public.questions q ON q.id = eq.question_id
  WHERE eq.exam_id = result_row.exam_id
    AND q.type NOT IN ('multiple_choice', 'true_false');

  SELECT COALESCE(sum(eq.points), 0)
  INTO objective_total
  FROM public.exam_questions eq
  JOIN public.questions q ON q.id = eq.question_id
  WHERE eq.exam_id = result_row.exam_id
    AND q.type IN ('multiple_choice', 'true_false');

  SELECT e.total_points, e.passing_score
  INTO exam_total, passing
  FROM public.examify_exams e
  WHERE e.id = result_row.exam_id
    AND e.institution_id = result_row.institution_id
    AND e.status = 'published';

  IF exam_total IS NULL THEN
    RAISE EXCEPTION 'omr_exam_invalid';
  END IF;

  IF result_row.exam_attempt_id IS NOT NULL THEN
    attempt_id_to_use := result_row.exam_attempt_id;
  ELSE
    SELECT ea.id
    INTO attempt_id_to_use
    FROM public.exam_attempts ea
    WHERE ea.exam_id = result_row.exam_id
      AND ea.student_id = student_id_to_use
      AND ea.is_result_published = false
    ORDER BY ea.created_at DESC
    LIMIT 1;
  END IF;

  IF attempt_id_to_use IS NULL THEN
    SELECT COALESCE(max(ea.attempt_number), 0) + 1
    INTO next_attempt_number
    FROM public.exam_attempts ea
    WHERE ea.exam_id = result_row.exam_id
      AND ea.student_id = student_id_to_use;

    INSERT INTO public.exam_attempts (
      exam_id,
      student_id,
      attempt_number,
      status,
      started_at,
      submitted_at,
      is_result_published
    )
    VALUES (
      result_row.exam_id,
      student_id_to_use,
      next_attempt_number,
      'submitted',
      now(),
      now(),
      false
    )
    RETURNING id INTO attempt_id_to_use;
  END IF;

  WITH exam_order AS (
    SELECT
      eq.question_id,
      eq.points,
      q.type,
      row_number() OVER (ORDER BY eq.sort_order, eq.id) AS question_number
    FROM public.exam_questions eq
    JOIN public.questions q ON q.id = eq.question_id
    WHERE eq.exam_id = result_row.exam_id
  ),
  answer_source AS (
    SELECT
      eo.question_id,
      qo.id AS option_id,
      eo.points,
      eo.type,
      COALESCE(oa.manual_override, oa.detected_answer) AS final_label
    FROM exam_order eo
    LEFT JOIN public.omr_answers oa
      ON oa.omr_result_id = result_row.id
      AND oa.question_number = eo.question_number
    LEFT JOIN public.question_options qo
      ON qo.question_id = eo.question_id
      AND qo.label = COALESCE(oa.manual_override, oa.detected_answer)
  ),
  upserted AS (
    INSERT INTO public.answers (
      attempt_id,
      question_id,
      option_id,
      is_correct,
      awarded_points,
      grader_notes,
      graded_by,
      graded_at
    )
    SELECT
      attempt_id_to_use,
      src.question_id,
      src.option_id,
      CASE
        WHEN src.type NOT IN ('multiple_choice', 'true_false') THEN NULL
        WHEN src.option_id IS NULL THEN false
        ELSE EXISTS (
          SELECT 1 FROM public.question_options ok
          WHERE ok.id = src.option_id AND ok.is_correct = true
        )
      END,
      CASE
        WHEN src.type NOT IN ('multiple_choice', 'true_false') THEN NULL
        WHEN src.option_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.question_options ok
          WHERE ok.id = src.option_id AND ok.is_correct = true
        ) THEN src.points
        ELSE 0
      END,
      CASE
        WHEN src.type NOT IN ('multiple_choice', 'true_false') THEN 'OMR skipped: requires manual grading'
        ELSE 'OMR approved'
      END,
      auth.uid(),
      now()
    FROM answer_source src
    ON CONFLICT (attempt_id, question_id) DO UPDATE SET
      option_id = EXCLUDED.option_id,
      is_correct = EXCLUDED.is_correct,
      awarded_points = EXCLUDED.awarded_points,
      grader_notes = EXCLUDED.grader_notes,
      graded_by = EXCLUDED.graded_by,
      graded_at = EXCLUDED.graded_at,
      updated_at = now()
    RETURNING awarded_points
  )
  SELECT COALESCE(sum(awarded_points), 0)
  INTO awarded_total
  FROM upserted;

  IF exam_total > 0 THEN
    percentage := round((awarded_total / exam_total) * 100, 2);
  ELSE
    percentage := 0;
  END IF;
  passed := percentage >= passing;

  UPDATE public.exam_attempts
  SET
    status = CASE WHEN manual_questions > 0 THEN 'submitted' ELSE 'graded' END,
    submitted_at = COALESCE(submitted_at, now()),
    score = awarded_total,
    score_percentage = percentage,
    is_passed = passed,
    graded_by = CASE WHEN manual_questions > 0 THEN graded_by ELSE auth.uid() END,
    graded_at = CASE WHEN manual_questions > 0 THEN graded_at ELSE now() END,
    is_result_published = false,
    approved_by = NULL,
    approved_at = NULL
  WHERE id = attempt_id_to_use;

  UPDATE public.omr_results
  SET
    student_profile_id = student_id_to_use,
    exam_attempt_id = attempt_id_to_use,
    score = awarded_total,
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    reviewed_by = auth.uid(),
    reviewed_at = now()
  WHERE id = result_row.id;

  RETURN QUERY
  SELECT
    result_row.id,
    attempt_id_to_use,
    awarded_total,
    exam_total,
    percentage,
    passed,
    'approved'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_omr_result(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_omr_result(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_omr_result_storage_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.uploaded_by IS NULL THEN
    NEW.uploaded_by := auth.uid();
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.institution_id IS DISTINCT FROM OLD.institution_id
      OR NEW.exam_id IS DISTINCT FROM OLD.exam_id THEN
      RAISE EXCEPTION 'omr_result_identity_immutable';
    END IF;
  END IF;

  IF NEW.student_profile_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.student_profiles sp
      WHERE sp.id = NEW.student_profile_id
        AND sp.institution_id = NEW.institution_id
    ) THEN
    RAISE EXCEPTION 'omr_student_institution_mismatch';
  END IF;

  IF NEW.exam_attempt_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.exam_attempts ea
      JOIN public.student_profiles sp ON sp.id = ea.student_id
      WHERE ea.id = NEW.exam_attempt_id
        AND ea.exam_id = NEW.exam_id
        AND sp.institution_id = NEW.institution_id
        AND (NEW.student_profile_id IS NULL OR ea.student_id = NEW.student_profile_id)
    ) THEN
    RAISE EXCEPTION 'omr_attempt_mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.examify_exams e
    WHERE e.id = NEW.exam_id
      AND e.institution_id = NEW.institution_id
  ) THEN
    RAISE EXCEPTION 'omr_result_exam_institution_mismatch';
  END IF;

  IF NEW.original_storage_path IS NOT NULL
    AND NOT public.omr_storage_path_matches_exam(NEW.institution_id, NEW.exam_id, NEW.uploaded_by, NEW.original_storage_path, 'omr-original') THEN
    RAISE EXCEPTION 'invalid_omr_original_storage_path';
  END IF;

  IF NEW.processed_storage_path IS NOT NULL
    AND NOT public.omr_storage_path_matches_exam(NEW.institution_id, NEW.exam_id, NEW.uploaded_by, NEW.processed_storage_path, 'omr-processed') THEN
    RAISE EXCEPTION 'invalid_omr_processed_storage_path';
  END IF;

  IF NEW.image_url IS NOT NULL AND NEW.image_url LIKE 'blob:%' THEN
    RAISE EXCEPTION 'blob_urls_are_not_persistent_omr_storage';
  END IF;

  IF NEW.image_mime_type IS NOT NULL
    AND NEW.image_mime_type NOT IN ('image/png', 'image/jpeg', 'image/webp') THEN
    RAISE EXCEPTION 'invalid_omr_image_mime_type';
  END IF;

  IF NEW.image_size_bytes IS NOT NULL
    AND (NEW.image_size_bytes <= 0 OR NEW.image_size_bytes > 20971520) THEN
    RAISE EXCEPTION 'invalid_omr_image_size';
  END IF;

  RETURN NEW;
END;
$$;
