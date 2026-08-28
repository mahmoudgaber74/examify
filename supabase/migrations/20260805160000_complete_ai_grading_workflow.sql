-- Complete the AI grading workflow for short_answer and essay review.
-- This keeps electronic exam submission and OMR flows unchanged.

ALTER TABLE public.ai_grading_results
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'ai-grading-v1',
  ADD COLUMN IF NOT EXISTS structured_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS requires_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS final_score numeric(8,2),
  ADD COLUMN IF NOT EXISTS final_feedback text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(10,6),
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.ai_grading_results
  ALTER COLUMN status SET DEFAULT 'queued';

CREATE UNIQUE INDEX IF NOT EXISTS ai_grading_one_active_job_per_answer
  ON public.ai_grading_results(answer_id)
  WHERE status NOT IN ('failed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_ai_grading_status
  ON public.ai_grading_results(institution_id, status);

CREATE OR REPLACE FUNCTION public.ai_normalize_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(input, '')), '[[:punct:]]', ' ', 'g'),
      '[ًٌٍَُِّْـ]', '', 'g'
    ),
    '\s+', ' ', 'g'
  ));
$$;

CREATE OR REPLACE FUNCTION public.ai_text_words(input text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public.ai_normalize_text(input) = '' THEN ARRAY[]::text[]
    ELSE regexp_split_to_array(public.ai_normalize_text(input), '\s+')
  END;
$$;

CREATE OR REPLACE FUNCTION public.ai_grade_answer_internal(
  p_question_type text,
  p_question_prompt text,
  p_student_answer text,
  p_model_answer text,
  p_max_points numeric,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_student text := public.ai_normalize_text(p_student_answer);
  normalized_model text := public.ai_normalize_text(p_model_answer);
  student_words text[] := public.ai_text_words(p_student_answer);
  model_words text[] := public.ai_text_words(p_model_answer);
  overlap integer := 0;
  ratio numeric := 0;
  score numeric := 0;
  confidence numeric := 0.7;
  requires_review boolean := true;
  flags jsonb := '[]'::jsonb;
  criteria jsonb := '[]'::jsonb;
  rubric jsonb;
  item jsonb;
  criterion_score numeric;
  word_count integer := cardinality(student_words);
  criterion_max numeric;
  criterion_id text;
  criterion_label text;
  criterion_desc text;
  criterion_keywords text[];
  found_count integer;
  summary text := '';
BEGIN
  IF p_max_points IS NULL OR p_max_points <= 0 THEN
    RAISE EXCEPTION 'invalid_ai_max_points';
  END IF;

  IF p_question_type NOT IN ('short_answer', 'essay') THEN
    RAISE EXCEPTION 'ai_grading_question_type_not_supported';
  END IF;

  IF normalized_student ~ '(ignore previous|give me full marks|full marks|ØªØ¬Ø§Ù‡Ù„ Ø§Ù„ØªØ¹Ù„ÙŠÙ…Ø§Øª|Ø£Ø¹Ø·Ù†ÙŠ Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„ÙƒØ§Ù…Ù„Ø©|Ø§Ø¹Ø·Ù†ÙŠ Ø§Ù„Ø¯Ø±Ø¬Ø© Ø§Ù„ÙƒØ§Ù…Ù„Ø©)' THEN
    flags := flags || jsonb_build_array('prompt_injection');
  END IF;

  IF normalized_student = '' THEN
    RETURN jsonb_build_object(
      'awarded_points', 0,
      'max_points', p_max_points,
      'confidence', 0.95,
      'requires_review', false,
      'summary', 'Ø¥Ø¬Ø§Ø¨Ø© ÙØ§Ø±ØºØ©ØŒ Ù„Ù… ØªÙ…Ù†Ø­ Ø¯Ø±Ø¬Ø©.',
      'criteria', '[]'::jsonb,
      'flags', flags || jsonb_build_array('empty_answer')
    );
  END IF;

  IF p_question_type = 'short_answer' THEN
    IF normalized_model = '' THEN
      RETURN jsonb_build_object(
        'awarded_points', 0,
        'max_points', p_max_points,
        'confidence', 0.45,
        'requires_review', true,
        'summary', 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¥Ø¬Ø§Ø¨Ø© Ù†Ù…ÙˆØ°Ø¬ÙŠØ© ÙƒØ§ÙÙŠØ© Ù„Ù„ØªØµØ­ÙŠØ­ Ø§Ù„Ø¢Ù„ÙŠ.',
        'criteria', '[]'::jsonb,
        'flags', flags || jsonb_build_array('missing_model_answer')
      );
    END IF;

    IF normalized_student = normalized_model THEN
      score := p_max_points;
      confidence := 0.94;
      summary := 'Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© ØªØ·Ø§Ø¨Ù‚ Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ÙŠØ© Ø¨Ø¹Ø¯ Ø§Ù„ØªØ·Ø¨ÙŠØ¹.';
    ELSIF position(normalized_model in normalized_student) > 0 OR position(normalized_student in normalized_model) > 0 THEN
      score := p_max_points;
      confidence := 0.86;
      summary := 'Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© ØªØ­ØªÙˆÙŠ Ø§Ù„Ù…Ø¹Ù†Ù‰ Ø§Ù„Ù…Ø·Ù„ÙˆØ¨ Ø¨ØµÙŠØ§ØºØ© Ù…Ø®ØªØµØ±Ø© Ø£Ùˆ Ù…ÙˆØ³Ø¹Ø©.';
    ELSE
      SELECT count(*)
      INTO overlap
      FROM unnest(model_words) AS w
      WHERE w = ANY(student_words);
      ratio := CASE WHEN cardinality(model_words) > 0 THEN overlap::numeric / cardinality(model_words)::numeric ELSE 0 END;
      IF ratio >= 0.8 THEN
        score := p_max_points;
        confidence := 0.78;
        summary := 'Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© ØªØºØ·ÙŠ Ù…Ø¹Ø¸Ù… Ø§Ù„Ù…ÙØ§ØªÙŠØ­ Ø§Ù„Ù…Ø·Ù„ÙˆØ¨Ø©.';
      ELSIF ratio >= 0.5 THEN
        score := round((p_max_points * 0.5)::numeric, 2);
        confidence := 0.6;
        summary := 'Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© Ø¬Ø²Ø¦ÙŠØ© ÙˆØªØ­ØªØ§Ø¬ Ù…Ø±Ø§Ø¬Ø¹Ø© Ø¨Ø´Ø±ÙŠØ©.';
      ELSE
        score := 0;
        confidence := 0.7;
        summary := 'Ù„Ù… ØªØ¸Ù‡Ø± Ø¯Ù„Ø§Ø¦Ù„ ÙƒØ§ÙÙŠØ© Ø¹Ù„Ù‰ ØµØ­Ø© Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø©.';
      END IF;
    END IF;

    IF jsonb_array_length(flags) > 0 THEN
      confidence := least(confidence, 0.55);
    END IF;
    requires_review := confidence < 0.85 OR jsonb_array_length(flags) > 0;
    criteria := jsonb_build_array(jsonb_build_object(
      'criterion_id', 'semantic_match',
      'awarded_points', score,
      'reason', summary
    ));
  ELSE
    rubric := COALESCE(p_metadata->'rubric'->'criteria', p_metadata->'rubric', '[]'::jsonb);
    IF jsonb_typeof(rubric) <> 'array' OR jsonb_array_length(rubric) = 0 THEN
      rubric := jsonb_build_array(
        jsonb_build_object('id', 'accuracy', 'label', 'Ø§Ù„Ø¯Ù‚Ø©', 'max_points', round((p_max_points * 0.5)::numeric, 2), 'description', 'ØµØ­Ø© Ø§Ù„Ù…ÙØ§Ù‡ÙŠÙ…', 'keywords', '[]'::jsonb),
        jsonb_build_object('id', 'completeness', 'label', 'Ø§Ù„Ø§ÙƒØªÙ…Ø§Ù„', 'max_points', round((p_max_points * 0.3)::numeric, 2), 'description', 'ØªØºØ·ÙŠØ© Ø§Ù„Ø¹Ù†Ø§ØµØ±', 'keywords', '[]'::jsonb),
        jsonb_build_object('id', 'clarity', 'label', 'Ø§Ù„ÙˆØ¶ÙˆØ­', 'max_points', p_max_points - round((p_max_points * 0.8)::numeric, 2), 'description', 'ØªÙ†Ø¸ÙŠÙ… Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø©', 'keywords', '[]'::jsonb)
      );
      flags := flags || jsonb_build_array('default_rubric');
    END IF;

    FOR item IN SELECT value FROM jsonb_array_elements(rubric)
    LOOP
      criterion_id := COALESCE(item->>'id', item->>'criterion', 'criterion');
      criterion_label := COALESCE(item->>'label', item->>'criterion', criterion_id);
      criterion_desc := COALESCE(item->>'description', '');
      criterion_max := COALESCE(NULLIF(item->>'max_points', '')::numeric, NULLIF(item->>'maxScore', '')::numeric, 0);
      IF criterion_max < 0 THEN
        RAISE EXCEPTION 'invalid_ai_rubric_points';
      END IF;

      SELECT COALESCE(array_agg(value), ARRAY[]::text[])
      INTO criterion_keywords
      FROM jsonb_array_elements_text(COALESCE(item->'keywords', '[]'::jsonb));

      IF cardinality(criterion_keywords) > 0 THEN
        SELECT count(*) INTO found_count
        FROM unnest(criterion_keywords) AS kw
        WHERE public.ai_normalize_text(p_student_answer) LIKE '%' || public.ai_normalize_text(kw) || '%';
        criterion_score := round((criterion_max * found_count::numeric / cardinality(criterion_keywords)::numeric)::numeric, 2);
      ELSE
        criterion_score := CASE
          WHEN word_count >= 80 THEN round((criterion_max * 0.85)::numeric, 2)
          WHEN word_count >= 40 THEN round((criterion_max * 0.65)::numeric, 2)
          WHEN word_count >= 15 THEN round((criterion_max * 0.4)::numeric, 2)
          ELSE round((criterion_max * 0.15)::numeric, 2)
        END;
      END IF;
      score := score + criterion_score;
      criteria := criteria || jsonb_build_array(jsonb_build_object(
        'criterion_id', criterion_id,
        'label', criterion_label,
        'awarded_points', criterion_score,
        'max_points', criterion_max,
        'reason', CASE
          WHEN cardinality(criterion_keywords) > 0 THEN 'ØªÙ… Ø§Ø­ØªØ³Ø§Ø¨ Ø§Ù„Ø¯Ø±Ø¬Ø© Ø¨Ù†Ø§Ø¡Ù‹ Ø¹Ù„Ù‰ ØªØºØ·ÙŠØ© Ø§Ù„Ù…ÙØ§ØªÙŠØ­ Ø§Ù„Ù…Ø­Ø¯Ø¯Ø©.'
          WHEN word_count < 15 THEN 'Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© Ù‚ØµÙŠØ±Ø© Ø¬Ø¯Ø§Ù‹ Ù„Ù‡Ø°Ø§ Ø§Ù„Ù…Ø¹ÙŠØ§Ø±.'
          ELSE COALESCE(NULLIF(criterion_desc, ''), 'ØªÙ… ØªÙ‚Ø¯ÙŠØ± Ø§Ù„Ù…Ø¹ÙŠØ§Ø± Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø·ÙˆÙ„ Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© ÙˆØ§Ù„ØªØºØ·ÙŠØ©.')
        END
      ));
    END LOOP;

    score := least(round(score::numeric, 2), p_max_points);
    confidence := CASE
      WHEN word_count < 10 THEN 0.45
      WHEN jsonb_array_length(flags) > 0 THEN 0.58
      WHEN jsonb_array_length(criteria) >= 3 AND word_count >= 60 THEN 0.82
      ELSE 0.68
    END;
    requires_review := true;
    summary := CASE
      WHEN score / p_max_points >= 0.8 THEN 'Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© Ø¬ÙŠØ¯Ø© ÙˆØªØºØ·ÙŠ Ù…Ø¹Ø¸Ù… Ø§Ù„Ù…Ø¹Ø§ÙŠÙŠØ±.'
      WHEN score / p_max_points >= 0.5 THEN 'Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© Ù…ØªÙˆØ³Ø·Ø© ÙˆØªØ­ØªØ§Ø¬ Ù…Ø±Ø§Ø¬Ø¹Ø© Ø§Ù„Ù†ÙˆØ§Ù‚Øµ.'
      ELSE 'Ø§Ù„Ø¥Ø¬Ø§Ø¨Ø© Ø¶Ø¹ÙŠÙØ© Ø£Ùˆ ØºÙŠØ± ÙƒØ§ÙÙŠØ©.'
    END;
  END IF;

  RETURN jsonb_build_object(
    'awarded_points', score,
    'max_points', p_max_points,
    'confidence', confidence,
    'requires_review', requires_review,
    'summary', summary,
    'criteria', criteria,
    'flags', flags
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_ai_grading_structured_result(
  p_result jsonb,
  p_max_points numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  awarded numeric;
  max_points numeric;
  confidence numeric;
BEGIN
  IF jsonb_typeof(p_result) <> 'object' THEN
    RAISE EXCEPTION 'ai_result_must_be_object';
  END IF;
  awarded := NULLIF(p_result->>'awarded_points', '')::numeric;
  max_points := NULLIF(p_result->>'max_points', '')::numeric;
  confidence := NULLIF(p_result->>'confidence', '')::numeric;

  IF awarded IS NULL OR awarded < 0 OR awarded > p_max_points THEN
    RAISE EXCEPTION 'invalid_ai_awarded_points';
  END IF;
  IF max_points IS NULL OR max_points <> p_max_points THEN
    RAISE EXCEPTION 'invalid_ai_max_points';
  END IF;
  IF confidence IS NULL OR confidence < 0 OR confidence > 1 THEN
    RAISE EXCEPTION 'invalid_ai_confidence';
  END IF;
  IF NOT (p_result ? 'summary') OR NOT (p_result ? 'criteria') OR NOT (p_result ? 'flags') THEN
    RAISE EXCEPTION 'invalid_ai_structured_result';
  END IF;
  RETURN p_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_ai_grading_job(p_answer_id uuid)
RETURNS TABLE (
  job_id uuid,
  status text,
  awarded_points numeric,
  max_points numeric,
  confidence numeric,
  requires_review boolean,
  structured_result jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  answer_row public.answers%ROWTYPE;
  question_row public.questions%ROWTYPE;
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  exam_points numeric;
  max_points numeric;
  model_answer text;
  result_json jsonb;
  result_status text;
  created_job_id uuid;
  start_clock timestamptz := clock_timestamp();
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'ai_grading_not_allowed';
  END IF;

  SELECT * INTO answer_row FROM public.answers WHERE id = p_answer_id;
  IF answer_row.id IS NULL THEN
    RAISE EXCEPTION 'answer_not_found';
  END IF;

  SELECT * INTO attempt_row FROM public.exam_attempts WHERE id = answer_row.attempt_id;
  SELECT * INTO question_row FROM public.questions WHERE id = answer_row.question_id;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id;

  IF exam_row.id IS NULL OR question_row.id IS NULL THEN
    RAISE EXCEPTION 'ai_grading_context_missing';
  END IF;
  IF actor_role <> 'super_admin' AND exam_row.institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'ai_grading_institution_denied';
  END IF;
  IF question_row.type NOT IN ('short_answer', 'essay') THEN
    RAISE EXCEPTION 'ai_grading_question_type_not_supported';
  END IF;
  IF COALESCE(answer_row.text_answer, '') = '' THEN
    -- Empty answers are still processed into a structured zero result.
    NULL;
  END IF;

  SELECT eq.points INTO exam_points
  FROM public.exam_questions eq
  WHERE eq.exam_id = attempt_row.exam_id
    AND eq.question_id = question_row.id
  LIMIT 1;
  max_points := COALESCE(exam_points, question_row.points, 1);

  SELECT COALESCE(question_row.metadata->>'correct_answer', question_row.metadata->>'model_answer', '')
  INTO model_answer;

  INSERT INTO public.ai_grading_results (
    institution_id,
    attempt_id,
    answer_id,
    question_id,
    student_text,
    ai_max_score,
    status,
    provider,
    model_used,
    prompt_version
  )
  VALUES (
    exam_row.institution_id,
    attempt_row.id,
    answer_row.id,
    question_row.id,
    answer_row.text_answer,
    max_points,
    'processing',
    'internal',
    'rule-based-v1',
    'ai-grading-v1'
  )
  RETURNING id INTO created_job_id;

  BEGIN
    result_json := public.validate_ai_grading_structured_result(
      public.ai_grade_answer_internal(question_row.type, question_row.prompt, COALESCE(answer_row.text_answer, ''), model_answer, max_points, question_row.metadata),
      max_points
    );
    result_status := CASE WHEN (result_json->>'requires_review')::boolean THEN 'needs_review' ELSE 'completed' END;

    UPDATE public.ai_grading_results
    SET
      status = result_status,
      ai_score = (result_json->>'awarded_points')::numeric,
      ai_feedback = result_json->>'summary',
      ai_confidence = (result_json->>'confidence')::numeric,
      rubric_scores = result_json->'criteria',
      structured_result = result_json,
      flags = result_json->'flags',
      requires_review = (result_json->>'requires_review')::boolean,
      input_tokens = ceil(length(coalesce(question_row.prompt, '') || ' ' || coalesce(answer_row.text_answer, '')) / 4.0),
      output_tokens = ceil(length(result_json::text) / 4.0),
      estimated_cost = 0,
      duration_ms = greatest(1, floor(extract(epoch from (clock_timestamp() - start_clock)) * 1000)::integer),
      updated_at = now()
    WHERE id = created_job_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.ai_grading_results
    SET status = 'failed', error_message = SQLERRM, updated_at = now()
    WHERE id = created_job_id;
    RAISE;
  END;

  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details)
  VALUES (
    exam_row.institution_id,
    auth.uid(),
    actor_role,
    'ai_grading_job_created',
    'ai_grading_result',
    created_job_id,
    jsonb_build_object('answer_id', answer_row.id, 'provider', 'internal', 'model', 'rule-based-v1')
  );

  RETURN QUERY
  SELECT
    r.id,
    r.status,
    r.ai_score,
    r.ai_max_score,
    r.ai_confidence,
    r.requires_review,
    r.structured_result
  FROM public.ai_grading_results r
  WHERE r.id = created_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_ai_grading_result(
  p_result_id uuid,
  p_final_score numeric,
  p_review_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_role text := public.current_user_role();
  result_row public.ai_grading_results%ROWTYPE;
  attempt_row public.exam_attempts%ROWTYPE;
  exam_row public.examify_exams%ROWTYPE;
  total_score numeric := 0;
  total_points numeric := 0;
  percentage numeric := 0;
BEGIN
  IF actor_role NOT IN ('super_admin', 'school_admin', 'teacher', 'grader') THEN
    RAISE EXCEPTION 'ai_grading_approval_not_allowed';
  END IF;
  IF p_review_reason IS NULL OR length(trim(p_review_reason)) < 3 THEN
    RAISE EXCEPTION 'ai_review_reason_required';
  END IF;

  SELECT * INTO result_row
  FROM public.ai_grading_results
  WHERE id = p_result_id
  FOR UPDATE;
  IF result_row.id IS NULL THEN
    RAISE EXCEPTION 'ai_grading_result_not_found';
  END IF;
  IF result_row.status NOT IN ('completed', 'needs_review') THEN
    RAISE EXCEPTION 'ai_grading_result_not_approvable';
  END IF;
  IF p_final_score < 0 OR p_final_score > result_row.ai_max_score THEN
    RAISE EXCEPTION 'invalid_ai_final_score';
  END IF;
  IF actor_role <> 'super_admin' AND result_row.institution_id <> public.current_user_institution_id() THEN
    RAISE EXCEPTION 'ai_grading_institution_denied';
  END IF;

  UPDATE public.answers
  SET
    awarded_points = p_final_score,
    is_correct = p_final_score >= (result_row.ai_max_score * 0.5),
    grader_notes = concat('AI: ', COALESCE(result_row.ai_feedback, ''), E'\n', 'مراجعة بشرية: ', p_review_reason),
    graded_by = auth.uid(),
    graded_at = now(),
    updated_at = now()
  WHERE id = result_row.answer_id;

  SELECT * INTO attempt_row FROM public.exam_attempts WHERE id = result_row.attempt_id;
  SELECT * INTO exam_row FROM public.examify_exams WHERE id = attempt_row.exam_id;

  SELECT
    COALESCE(sum(COALESCE(a.awarded_points, 0)), 0),
    COALESCE(sum(eq.points), exam_row.total_points)
  INTO total_score, total_points
  FROM public.exam_questions eq
  LEFT JOIN public.answers a
    ON a.question_id = eq.question_id
   AND a.attempt_id = attempt_row.id
  WHERE eq.exam_id = attempt_row.exam_id;

  IF total_points > 0 THEN
    percentage := round((total_score / total_points) * 100, 2);
  END IF;

  UPDATE public.exam_attempts
  SET
    status = 'graded',
    score = total_score,
    score_percentage = percentage,
    is_passed = percentage >= exam_row.passing_score,
    graded_by = auth.uid(),
    graded_at = now(),
    is_result_published = false,
    approved_by = NULL,
    approved_at = NULL
  WHERE id = attempt_row.id;

  UPDATE public.ai_grading_results
  SET
    status = 'approved',
    final_score = p_final_score,
    final_feedback = p_review_reason,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_reason = p_review_reason,
    updated_at = now()
  WHERE id = result_row.id;

  INSERT INTO public.audit_log (institution_id, actor_id, actor_role, action, entity_type, entity_id, details)
  VALUES (
    result_row.institution_id,
    auth.uid(),
    actor_role,
    'ai_grading_human_approved',
    'ai_grading_result',
    result_row.id,
    jsonb_build_object(
      'answer_id', result_row.answer_id,
      'ai_score', result_row.ai_score,
      'final_score', p_final_score,
      'reason', p_review_reason
    )
  );

  RETURN jsonb_build_object(
    'status', 'approved',
    'attempt_id', attempt_row.id,
    'score', total_score,
    'score_percentage', percentage,
    'is_result_published', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_ai_grading_job(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_ai_grading_result(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_ai_grading_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_ai_grading_result(uuid, numeric, text) TO authenticated;

DROP POLICY IF EXISTS "ai_grading_select" ON public.ai_grading_results;
CREATE POLICY "ai_grading_select" ON public.ai_grading_results FOR SELECT
  TO authenticated USING (
    public.current_user_role() = 'super_admin'
    OR (
      institution_id = public.current_user_institution_id()
      AND public.current_user_role() IN ('school_admin', 'teacher', 'grader')
    )
  );
