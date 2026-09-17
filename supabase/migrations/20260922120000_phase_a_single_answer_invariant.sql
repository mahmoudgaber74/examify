-- Phase A.2: MCQ and true/false are single-answer question types.
-- The deferred trigger validates the final state of atomic option writes.

CREATE OR REPLACE FUNCTION public.validate_single_answer_question_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  question_id_to_check uuid;
  question_type text;
  correct_count integer;
BEGIN
  question_id_to_check := COALESCE(NEW.question_id, OLD.question_id);
  SELECT q.type INTO question_type FROM public.questions q WHERE q.id = question_id_to_check;
  IF question_type IN ('multiple_choice', 'true_false') THEN
    SELECT count(*) FILTER (WHERE qo.is_correct = true)::integer
    INTO correct_count
    FROM public.question_options qo
    WHERE qo.question_id = question_id_to_check;
    IF correct_count <> 1 THEN
      RAISE EXCEPTION 'MCQ_REQUIRES_EXACTLY_ONE_CORRECT_OPTION';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_single_answer_question_options ON public.question_options;
CREATE CONSTRAINT TRIGGER trg_validate_single_answer_question_options
AFTER INSERT OR UPDATE ON public.question_options
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_single_answer_question_options();

CREATE OR REPLACE FUNCTION public.validate_single_answer_question_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  correct_count integer;
BEGIN
  IF NEW.type IN ('multiple_choice', 'true_false') THEN
    SELECT count(*) FILTER (WHERE qo.is_correct = true)::integer
    INTO correct_count
    FROM public.question_options qo
    WHERE qo.question_id = NEW.id;
    IF correct_count <> 1 THEN
      RAISE EXCEPTION 'MCQ_REQUIRES_EXACTLY_ONE_CORRECT_OPTION';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_single_answer_question_type ON public.questions;
CREATE CONSTRAINT TRIGGER trg_validate_single_answer_question_type
AFTER UPDATE OF type ON public.questions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.validate_single_answer_question_type();

REVOKE ALL ON FUNCTION public.validate_single_answer_question_options() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_single_answer_question_type() FROM PUBLIC, anon, authenticated;
