/*
  Prevent student answer-key leakage through direct question_options reads.
  Students load exam options through get_exam_question_options, which returns
  only display fields after validating ownership, assignment, status, and time.
*/

DROP POLICY IF EXISTS "question_options_select" ON public.question_options;
CREATE POLICY "question_options_select" ON public.question_options FOR SELECT
  TO authenticated USING (
    public.current_user_role() IN ('super_admin', 'school_admin', 'teacher', 'grader')
    AND EXISTS (
      SELECT 1
      FROM public.questions q
      WHERE q.id = question_options.question_id
        AND (q.institution_id = public.current_user_institution_id() OR q.is_public = true)
    )
  );

CREATE OR REPLACE FUNCTION public.get_exam_question_options(p_exam_id uuid)
RETURNS TABLE (
  question_id uuid,
  id uuid,
  label text,
  sort_order integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role text := public.current_user_role();
  user_institution uuid := public.current_user_institution_id();
  exam_row public.examify_exams%ROWTYPE;
  student_profile_id uuid;
BEGIN
  SELECT *
  INTO exam_row
  FROM public.examify_exams
  WHERE examify_exams.id = p_exam_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF user_role IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    IF exam_row.institution_id IS DISTINCT FROM user_institution THEN
      RETURN;
    END IF;
  ELSIF user_role = 'student' THEN
    SELECT sp.id
    INTO student_profile_id
    FROM public.student_profiles sp
    WHERE sp.user_id = auth.uid()
      AND sp.institution_id = exam_row.institution_id
      AND sp.is_active = true
    LIMIT 1;

    IF student_profile_id IS NULL THEN
      RETURN;
    END IF;

    IF exam_row.status <> 'published' THEN
      RETURN;
    END IF;

    IF exam_row.start_at IS NOT NULL AND now() < exam_row.start_at THEN
      RETURN;
    END IF;

    IF exam_row.end_at IS NOT NULL AND now() > exam_row.end_at THEN
      RETURN;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.exam_assignments ea
      WHERE ea.exam_id = p_exam_id
        AND (
          ea.student_id = student_profile_id
          OR (
            ea.class_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.class_students cs
              WHERE cs.student_id = student_profile_id
                AND cs.class_id = ea.class_id
                AND (ea.section_id IS NULL OR cs.section_id = ea.section_id)
                AND COALESCE(cs.status, 'active') = 'active'
            )
          )
        )
    ) THEN
      RETURN;
    END IF;
  ELSE
    RETURN;
  END IF;

  RETURN QUERY
  SELECT qo.question_id, qo.id, qo.label, qo.sort_order
  FROM public.question_options qo
  JOIN public.exam_questions eq ON eq.question_id = qo.question_id
  WHERE eq.exam_id = p_exam_id
  ORDER BY eq.sort_order, qo.sort_order;
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_question_options(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_exam_question_options(uuid) TO authenticated;
