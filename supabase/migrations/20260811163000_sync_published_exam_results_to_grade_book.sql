/*
  Keep parent-visible grade_book in sync with published electronic exam results.
  Parent portal already reads grade_book, so exam results must only appear there
  after publication and disappear when publication is revoked.
*/

CREATE OR REPLACE FUNCTION public.sync_published_exam_result_to_grade_book()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  exam_row public.examify_exams%ROWTYPE;
  linked_parent record;
BEGIN
  SELECT *
  INTO exam_row
  FROM public.examify_exams
  WHERE id = NEW.exam_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.is_result_published IS NOT TRUE OR NEW.score IS NULL THEN
    DELETE FROM public.grade_book WHERE attempt_id = NEW.id;
    DELETE FROM public.parent_notifications
    WHERE type = 'grade_posted'
      AND data->>'attempt_id' = NEW.id::text;
    RETURN NEW;
  END IF;

  DELETE FROM public.grade_book WHERE attempt_id = NEW.id;

  INSERT INTO public.grade_book (
    institution_id,
    student_id,
    subject_id,
    exam_id,
    attempt_id,
    assessment_title,
    score,
    max_score,
    recorded_at
  )
  VALUES (
    exam_row.institution_id,
    NEW.student_id,
    exam_row.subject_id,
    NEW.exam_id,
    NEW.id,
    exam_row.title,
    NEW.score,
    exam_row.total_points,
    COALESCE(NEW.approved_at, NEW.graded_at, NEW.submitted_at, now())
  );

  DELETE FROM public.parent_notifications
  WHERE type = 'grade_posted'
    AND data->>'attempt_id' = NEW.id::text;

  FOR linked_parent IN
    SELECT psl.parent_id
    FROM public.parent_student_links psl
    JOIN public.parent_profiles pp ON pp.id = psl.parent_id
    WHERE psl.student_id = NEW.student_id
      AND psl.can_view_grades = true
      AND pp.institution_id = exam_row.institution_id
      AND pp.is_active = true
  LOOP
    INSERT INTO public.parent_notifications (
      institution_id,
      parent_id,
      student_id,
      type,
      title,
      body,
      data
    )
    VALUES (
      exam_row.institution_id,
      linked_parent.parent_id,
      NEW.student_id,
      'grade_posted',
      'Exam result published',
      exam_row.title,
      jsonb_build_object('attempt_id', NEW.id, 'exam_id', NEW.exam_id, 'score', NEW.score, 'max_score', exam_row.total_points)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_published_exam_result_to_grade_book ON public.exam_attempts;
CREATE TRIGGER trg_sync_published_exam_result_to_grade_book
AFTER INSERT OR UPDATE OF is_result_published, score, status, approved_at, graded_at ON public.exam_attempts
FOR EACH ROW
EXECUTE FUNCTION public.sync_published_exam_result_to_grade_book();
