-- Phase 1B: deterministic, AI-free exam blueprints.
-- Buckets are JSON objects: { type, difficulty, count, learning_outcome_id, unit, lesson }.

CREATE TABLE IF NOT EXISTS public.exam_blueprint_requests (
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_fingerprint text NOT NULL,
  exam_id uuid REFERENCES public.examify_exams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, request_id)
);

ALTER TABLE public.exam_blueprint_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exam_blueprint_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_exam_blueprint(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_institution uuid := public.current_user_institution_id();
  v_subject uuid := NULLIF(p_request->>'subject_id', '')::uuid;
  v_buckets jsonb := p_request->'buckets';
  v_total integer := (p_request->>'total_questions')::integer;
  v_allow_reuse boolean := COALESCE((p_request->>'allow_previous_reuse')::boolean, false);
  v_seed text := COALESCE(NULLIF(p_request->>'seed', ''), 'examify');
  v_bucket jsonb;
  v_type text;
  v_difficulty text;
  v_unit text;
  v_lesson text;
  v_outcome uuid;
  v_count integer;
  v_bucket_index integer := 0;
  v_requested integer := 0;
  v_available integer;
  v_selected uuid[] := ARRAY[]::uuid[];
  v_questions jsonb := '[]'::jsonb;
  v_shortages jsonb := '[]'::jsonb;
  v_question record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'exam_blueprint_authentication_required'; END IF;
  IF v_role NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'exam_blueprint_role_not_allowed';
  END IF;
  IF v_institution IS NULL OR v_subject IS NULL THEN
    RAISE EXCEPTION 'exam_blueprint_scope_required';
  END IF;
  IF v_total IS NULL OR v_total < 1 OR v_total > 200 THEN
    RAISE EXCEPTION 'exam_blueprint_total_invalid';
  END IF;
  IF jsonb_typeof(v_buckets) <> 'array' OR jsonb_array_length(v_buckets) < 1 THEN
    RAISE EXCEPTION 'exam_blueprint_buckets_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.id = v_subject AND s.institution_id = v_institution AND s.is_active = true
  ) THEN RAISE EXCEPTION 'exam_blueprint_subject_not_available'; END IF;
  IF v_role = 'teacher' AND NOT public.teacher_has_subject_scope(v_subject) THEN
    RAISE EXCEPTION 'exam_blueprint_teacher_scope_denied';
  END IF;

  FOR v_bucket IN SELECT value FROM jsonb_array_elements(v_buckets)
  LOOP
    v_count := (v_bucket->>'count')::integer;
    IF v_count IS NULL OR v_count < 1 OR v_count > 200 THEN
      RAISE EXCEPTION 'exam_blueprint_bucket_count_invalid';
    END IF;
    v_type := NULLIF(btrim(v_bucket->>'type'), '');
    v_difficulty := NULLIF(btrim(v_bucket->>'difficulty'), '');
    v_unit := NULLIF(btrim(v_bucket->>'unit'), '');
    v_lesson := NULLIF(btrim(v_bucket->>'lesson'), '');
    v_outcome := NULLIF(v_bucket->>'learning_outcome_id', '')::uuid;
    IF v_type IS NOT NULL AND v_type NOT IN ('multiple_choice', 'true_false', 'short_answer', 'essay', 'matching', 'ordering', 'fill_blank', 'numeric') THEN
      RAISE EXCEPTION 'exam_blueprint_question_type_invalid';
    END IF;
    IF v_difficulty IS NOT NULL AND v_difficulty NOT IN ('easy', 'medium', 'hard') THEN
      RAISE EXCEPTION 'exam_blueprint_difficulty_invalid';
    END IF;
    IF v_outcome IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.learning_outcomes lo
      WHERE lo.id = v_outcome AND lo.institution_id = v_institution
        AND lo.subject_id = v_subject AND lo.status = 'active'
    ) THEN RAISE EXCEPTION 'exam_blueprint_learning_outcome_not_available'; END IF;
    v_requested := v_requested + v_count;
  END LOOP;
  IF v_requested <> v_total THEN
    RAISE EXCEPTION 'exam_blueprint_distribution_total_mismatch';
  END IF;

  FOR v_bucket IN SELECT value FROM jsonb_array_elements(v_buckets)
  LOOP
    v_bucket_index := v_bucket_index + 1;
    v_count := (v_bucket->>'count')::integer;
    v_type := NULLIF(btrim(v_bucket->>'type'), '');
    v_difficulty := NULLIF(btrim(v_bucket->>'difficulty'), '');
    v_unit := NULLIF(btrim(v_bucket->>'unit'), '');
    v_lesson := NULLIF(btrim(v_bucket->>'lesson'), '');
    v_outcome := NULLIF(v_bucket->>'learning_outcome_id', '')::uuid;

    SELECT count(*)::integer INTO v_available
    FROM public.questions q
    WHERE q.institution_id = v_institution
      AND q.subject_id = v_subject
      AND (v_type IS NULL OR q.type = v_type)
      AND (v_difficulty IS NULL OR q.difficulty = v_difficulty)
      AND (v_unit IS NULL OR q.unit = v_unit)
      AND (v_lesson IS NULL OR q.lesson = v_lesson)
      AND (v_outcome IS NULL OR EXISTS (
        SELECT 1 FROM public.question_learning_outcomes qlo
        WHERE qlo.question_id = q.id AND qlo.learning_outcome_id = v_outcome
      ))
      AND (v_role <> 'teacher' OR public.teacher_can_manage_question(q.id))
      AND q.id <> ALL(v_selected)
      AND (v_allow_reuse OR NOT EXISTS (
        SELECT 1
        FROM public.exam_questions eq
        JOIN public.examify_exams e ON e.id = eq.exam_id
        WHERE eq.question_id = q.id AND e.institution_id = v_institution
      ));

    FOR v_question IN
      SELECT q.*
      FROM public.questions q
      WHERE q.institution_id = v_institution
        AND q.subject_id = v_subject
        AND (v_type IS NULL OR q.type = v_type)
        AND (v_difficulty IS NULL OR q.difficulty = v_difficulty)
        AND (v_unit IS NULL OR q.unit = v_unit)
        AND (v_lesson IS NULL OR q.lesson = v_lesson)
        AND (v_outcome IS NULL OR EXISTS (
          SELECT 1 FROM public.question_learning_outcomes qlo
          WHERE qlo.question_id = q.id AND qlo.learning_outcome_id = v_outcome
        ))
        AND (v_role <> 'teacher' OR public.teacher_can_manage_question(q.id))
        AND q.id <> ALL(v_selected)
        AND (v_allow_reuse OR NOT EXISTS (
          SELECT 1 FROM public.exam_questions eq
          JOIN public.examify_exams e ON e.id = eq.exam_id
          WHERE eq.question_id = q.id AND e.institution_id = v_institution
        ))
      ORDER BY md5(q.id::text || ':' || v_seed || ':' || v_bucket_index::text)
      LIMIT v_count
    LOOP
      v_selected := array_append(v_selected, v_question.id);
      v_questions := v_questions || jsonb_build_array(jsonb_build_object(
        'id', v_question.id, 'prompt', v_question.prompt, 'type', v_question.type,
        'difficulty', v_question.difficulty, 'points', v_question.points,
        'unit', v_question.unit, 'lesson', v_question.lesson,
        'bucket_index', v_bucket_index
      ));
    END LOOP;
    IF v_available < v_count THEN
      v_shortages := v_shortages || jsonb_build_array(jsonb_build_object(
        'bucket_index', v_bucket_index, 'requested', v_count,
        'available', v_available, 'missing', v_count - v_available,
        'type', v_type, 'difficulty', v_difficulty, 'unit', v_unit,
        'lesson', v_lesson, 'learning_outcome_id', v_outcome
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'subject_id', v_subject, 'total_questions', v_total,
    'selected_count', cardinality(v_selected), 'complete', jsonb_array_length(v_shortages) = 0,
    'seed', v_seed, 'allow_previous_reuse', v_allow_reuse,
    'questions', v_questions, 'shortages', v_shortages
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_exam_from_blueprint(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_institution uuid := public.current_user_institution_id();
  v_request_id uuid := NULLIF(p_request->>'request_id', '')::uuid;
  v_subject uuid := NULLIF(p_request->>'subject_id', '')::uuid;
  v_class uuid := NULLIF(p_request->>'class_id', '')::uuid;
  v_title text := NULLIF(btrim(p_request->>'title'), '');
  v_total_questions integer := (p_request->>'total_questions')::integer;
  v_total_points numeric := COALESCE((p_request->>'total_points')::numeric, 100);
  v_passing_score numeric := COALESCE((p_request->>'passing_score')::numeric, 50);
  v_duration integer := COALESCE((p_request->>'duration_minutes')::integer, 60);
  v_max_attempts integer := COALESCE((p_request->>'max_attempts')::integer, 1);
  v_buckets jsonb := p_request->'buckets';
  v_allow_reuse boolean := COALESCE((p_request->>'allow_previous_reuse')::boolean, false);
  v_seed text := COALESCE(NULLIF(p_request->>'seed', ''), 'examify');
  v_fingerprint text;
  v_existing public.exam_blueprint_requests%ROWTYPE;
  v_preview jsonb;
  v_exam_id uuid;
  v_question jsonb;
  v_sort integer := 0;
  v_points numeric;
  v_request jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'exam_blueprint_authentication_required'; END IF;
  IF v_role NOT IN ('super_admin', 'school_admin', 'teacher') THEN RAISE EXCEPTION 'exam_blueprint_role_not_allowed'; END IF;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'exam_blueprint_request_id_required'; END IF;
  IF v_title IS NULL OR char_length(v_title) > 240 THEN RAISE EXCEPTION 'exam_blueprint_title_invalid'; END IF;
  IF v_total_questions IS NULL OR v_total_questions < 1 OR v_total_questions > 200 THEN
    RAISE EXCEPTION 'exam_blueprint_total_invalid';
  END IF;
  IF v_total_points <= 0 OR v_passing_score < 0 OR v_passing_score > 100 OR v_duration <= 0 OR v_max_attempts < 1 THEN
    RAISE EXCEPTION 'exam_blueprint_exam_settings_invalid';
  END IF;
  IF v_class IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = v_class AND c.institution_id = v_institution AND c.is_active = true
  ) THEN RAISE EXCEPTION 'exam_blueprint_class_not_available'; END IF;
  IF v_role = 'teacher' AND (NOT public.teacher_has_subject_scope(v_subject)
    OR (v_class IS NOT NULL AND NOT public.teacher_has_class_scope(v_class, NULL))) THEN
    RAISE EXCEPTION 'exam_blueprint_teacher_scope_denied';
  END IF;
  IF v_class IS NOT NULL AND v_role = 'teacher' AND NOT public.teacher_has_class_scope(v_class, NULL) THEN
    RAISE EXCEPTION 'exam_blueprint_teacher_class_denied';
  END IF;

  v_request := jsonb_build_object(
    'institution_id', v_institution, 'subject_id', v_subject, 'class_id', v_class,
    'title', v_title, 'total_questions', v_total_questions, 'total_points', v_total_points, 'passing_score', v_passing_score,
    'duration_minutes', v_duration, 'max_attempts', v_max_attempts,
    'buckets', v_buckets, 'allow_previous_reuse', v_allow_reuse, 'seed', v_seed
  );
  v_fingerprint := md5(v_request::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_institution::text || ':' || v_request_id::text, 0));
  SELECT * INTO v_existing FROM public.exam_blueprint_requests r
  WHERE r.institution_id = v_institution AND r.request_id = v_request_id;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'exam_blueprint_idempotency_conflict'; END IF;
    RETURN jsonb_build_object('exam_id', v_existing.exam_id, 'replayed', true);
  END IF;

  v_preview := public.preview_exam_blueprint(jsonb_build_object(
    'subject_id', v_subject, 'total_questions', v_total_questions,
    'buckets', v_buckets, 'allow_previous_reuse', v_allow_reuse, 'seed', v_seed
  ));
  IF COALESCE((v_preview->>'complete')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'exam_blueprint_insufficient_questions:%', v_preview->'shortages';
  END IF;

  INSERT INTO public.examify_exams (
    institution_id, subject_id, class_id, title, description, total_points,
    passing_score, duration_minutes, max_attempts, shuffle_questions,
    shuffle_options, status
  ) VALUES (
    v_institution, v_subject, v_class, v_title, 'تم إنشاؤه من مخطط امتحان حتمي',
    v_total_points, v_passing_score, v_duration, v_max_attempts, false, false, 'draft'
  ) RETURNING id INTO v_exam_id;

  FOR v_question IN SELECT value FROM jsonb_array_elements(v_preview->'questions')
  LOOP
    v_sort := v_sort + 1;
    v_points := v_total_points / NULLIF(v_total_questions, 0);
    INSERT INTO public.exam_questions (exam_id, question_id, points, sort_order)
    VALUES (v_exam_id, (v_question->>'id')::uuid, v_points, v_sort - 1);
  END LOOP;
  IF v_class IS NOT NULL THEN
    INSERT INTO public.exam_assignments (exam_id, class_id) VALUES (v_exam_id, v_class);
  END IF;
  INSERT INTO public.exam_blueprint_requests (institution_id, request_id, request_fingerprint, exam_id)
  VALUES (v_institution, v_request_id, v_fingerprint, v_exam_id);
  RETURN jsonb_build_object('exam_id', v_exam_id, 'questions_count', v_sort, 'replayed', false, 'blueprint', v_preview);
END;
$$;

REVOKE ALL ON FUNCTION public.preview_exam_blueprint(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_exam_blueprint(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_exam_from_blueprint(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exam_from_blueprint(jsonb) TO authenticated;
