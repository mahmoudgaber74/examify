CREATE OR REPLACE FUNCTION public.save_multiple_choice_question(
  p_question_id uuid,
  p_institution_id uuid,
  p_subject_id uuid,
  p_prompt text,
  p_difficulty text,
  p_points numeric,
  p_unit text,
  p_lesson text,
  p_explanation text,
  p_metadata jsonb,
  p_options jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_question_id uuid;
  v_saved_options jsonb;
BEGIN
  IF public.current_user_role() NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'You do not have permission to save questions.';
  END IF;

  IF p_institution_id IS NULL OR p_institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'Question institution does not match the current user.';
  END IF;

  IF p_prompt IS NULL OR btrim(p_prompt) = '' THEN
    RAISE EXCEPTION 'Question text is required.';
  END IF;

  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'Subject is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.subjects s
    WHERE s.id = p_subject_id
      AND s.institution_id = p_institution_id
  ) THEN
    RAISE EXCEPTION 'Subject is not available for this institution.';
  END IF;

  IF jsonb_typeof(p_options) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Options must be an array.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_options) AS option_row(value)
    WHERE btrim(coalesce(option_row.value->>'label', '')) = ''
  ) THEN
    RAISE EXCEPTION 'Options cannot be empty.';
  END IF;

  IF (
    SELECT count(*)
    FROM jsonb_array_elements(p_options) AS option_row(value)
    WHERE btrim(coalesce(option_row.value->>'label', '')) <> ''
  ) < 2 THEN
    RAISE EXCEPTION 'Add at least two options.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_options) AS option_row(value)
    WHERE coalesce((option_row.value->>'is_correct')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'Mark at least one correct option.';
  END IF;

  IF p_question_id IS NULL THEN
    INSERT INTO public.questions (
      institution_id,
      subject_id,
      type,
      prompt,
      difficulty,
      points,
      unit,
      lesson,
      explanation,
      metadata
    )
    VALUES (
      p_institution_id,
      p_subject_id,
      'multiple_choice',
      btrim(p_prompt),
      p_difficulty,
      p_points,
      nullif(btrim(coalesce(p_unit, '')), ''),
      nullif(btrim(coalesce(p_lesson, '')), ''),
      nullif(btrim(coalesce(p_explanation, '')), ''),
      coalesce(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_question_id;
  ELSE
    UPDATE public.questions
    SET
      subject_id = p_subject_id,
      type = 'multiple_choice',
      prompt = btrim(p_prompt),
      difficulty = p_difficulty,
      points = p_points,
      unit = nullif(btrim(coalesce(p_unit, '')), ''),
      lesson = nullif(btrim(coalesce(p_lesson, '')), ''),
      explanation = nullif(btrim(coalesce(p_explanation, '')), ''),
      metadata = coalesce(p_metadata, '{}'::jsonb)
    WHERE id = p_question_id
      AND institution_id = p_institution_id
    RETURNING id INTO v_question_id;

    IF v_question_id IS NULL THEN
      RAISE EXCEPTION 'Question was not found or cannot be edited.';
    END IF;
  END IF;

  DELETE FROM public.question_options
  WHERE question_id = v_question_id;

  INSERT INTO public.question_options (question_id, label, is_correct, sort_order)
  SELECT
    v_question_id,
    btrim(option_row.value->>'label'),
    coalesce((option_row.value->>'is_correct')::boolean, false),
    option_row.ordinality::integer - 1
  FROM jsonb_array_elements(p_options) WITH ORDINALITY AS option_row(value, ordinality);

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'question_id', v_question_id,
        'label', btrim(option_row.value->>'label'),
        'is_correct', coalesce((option_row.value->>'is_correct')::boolean, false),
        'sort_order', option_row.ordinality::integer - 1
      )
      ORDER BY option_row.ordinality
    ),
    '[]'::jsonb
  )
  INTO v_saved_options
  FROM jsonb_array_elements(p_options) WITH ORDINALITY AS option_row(value, ordinality);

  RETURN (
    SELECT jsonb_build_object(
      'question', to_jsonb(saved_question),
      'options', v_saved_options
    )
    FROM public.questions saved_question
    WHERE saved_question.id = v_question_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_multiple_choice_question(
  uuid,
  uuid,
  uuid,
  text,
  text,
  numeric,
  text,
  text,
  text,
  jsonb,
  jsonb
) TO authenticated;
