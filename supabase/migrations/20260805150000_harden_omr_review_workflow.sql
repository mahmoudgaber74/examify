-- Harden the existing Bubble Sheet / OMR workflow without changing the electronic exam flow.

ALTER TABLE public.bubble_sheets
  ADD COLUMN IF NOT EXISTS template_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS page_size text NOT NULL DEFAULT 'A4',
  ADD COLUMN IF NOT EXISTS generated_by uuid REFERENCES auth.users(id);

ALTER TABLE public.omr_results
  ADD COLUMN IF NOT EXISTS file_sha256 text,
  ADD COLUMN IF NOT EXISTS template_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS processing_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS omr_results_exam_file_sha256_unique
  ON public.omr_results(institution_id, exam_id, file_sha256)
  WHERE file_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_omr_results_file_sha256
  ON public.omr_results(file_sha256)
  WHERE file_sha256 IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_omr_result_scan_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.file_sha256 IS NOT NULL AND NEW.file_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid_omr_file_sha256';
  END IF;

  IF NEW.template_version IS NULL OR NEW.template_version < 1 THEN
    RAISE EXCEPTION 'invalid_omr_template_version';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.exam_attempt_id IS DISTINCT FROM OLD.exam_attempt_id
      OR NEW.student_profile_id IS DISTINCT FROM OLD.student_profile_id
      OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
      OR NEW.original_storage_path IS DISTINCT FROM OLD.original_storage_path THEN
      RAISE EXCEPTION 'approved_omr_result_immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_omr_result_scan_metadata ON public.omr_results;
CREATE TRIGGER trg_enforce_omr_result_scan_metadata
BEFORE INSERT OR UPDATE ON public.omr_results
FOR EACH ROW
EXECUTE FUNCTION public.enforce_omr_result_scan_metadata();

CREATE OR REPLACE FUNCTION public.audit_omr_answer_manual_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  parent_result public.omr_results%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      NEW.manual_override IS DISTINCT FROM OLD.manual_override
      OR NEW.needs_manual_review IS DISTINCT FROM OLD.needs_manual_review
      OR NEW.is_correct IS DISTINCT FROM OLD.is_correct
    ) THEN
    IF OLD.omr_result_id IS DISTINCT FROM NEW.omr_result_id
      OR OLD.question_number IS DISTINCT FROM NEW.question_number THEN
      RAISE EXCEPTION 'omr_answer_identity_immutable';
    END IF;

    SELECT * INTO parent_result
    FROM public.omr_results
    WHERE id = NEW.omr_result_id;

    IF parent_result.status = 'approved' THEN
      RAISE EXCEPTION 'approved_omr_answers_immutable';
    END IF;

    NEW.manually_reviewed_by := COALESCE(NEW.manually_reviewed_by, auth.uid());
    NEW.manually_reviewed_at := COALESCE(NEW.manually_reviewed_at, now());

    INSERT INTO public.audit_log (
      institution_id,
      actor_id,
      actor_role,
      action,
      entity_type,
      entity_id,
      details
    )
    VALUES (
      parent_result.institution_id,
      auth.uid(),
      public.current_user_role(),
      'omr_answer_manual_review',
      'omr_answer',
      NEW.id,
      jsonb_build_object(
        'omr_result_id', NEW.omr_result_id,
        'question_number', NEW.question_number,
        'old_manual_override', OLD.manual_override,
        'new_manual_override', NEW.manual_override,
        'old_needs_manual_review', OLD.needs_manual_review,
        'new_needs_manual_review', NEW.needs_manual_review,
        'old_is_correct', OLD.is_correct,
        'new_is_correct', NEW.is_correct
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_omr_answer_manual_review ON public.omr_answers;
CREATE TRIGGER trg_audit_omr_answer_manual_review
BEFORE UPDATE ON public.omr_answers
FOR EACH ROW
EXECUTE FUNCTION public.audit_omr_answer_manual_review();
