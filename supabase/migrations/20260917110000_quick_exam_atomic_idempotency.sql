/*
  Production repair: quick exam creation is one durable, idempotent transaction.

  The browser must never orchestrate the exam/question/sheet graph with several
  independent writes. A request id is scoped to the institution and can only be
  replayed with the same request fingerprint.
*/

CREATE TABLE IF NOT EXISTS public.quick_exam_requests (
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_fingerprint text NOT NULL,
  exam_id uuid NOT NULL REFERENCES public.examify_exams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, request_id),
  UNIQUE (exam_id)
);

ALTER TABLE public.quick_exam_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quick_exam_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_quick_exam_atomic(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := public.current_user_role();
  v_actor_institution uuid := public.current_user_institution_id();
  v_institution uuid := NULLIF(p_request->>'institution_id', '')::uuid;
  v_request_id uuid := NULLIF(p_request->>'request_id', '')::uuid;
  v_subject uuid := NULLIF(p_request->>'subject_id', '')::uuid;
  v_class uuid := NULLIF(p_request->>'class_id', '')::uuid;
  v_section uuid := NULLIF(p_request->>'section_id', '')::uuid;
  v_title text := NULLIF(btrim(p_request->>'title'), '');
  v_prompt_prefix text := COALESCE(NULLIF(btrim(p_request->>'prompt_prefix'), ''), 'سؤال الاختبار');
  v_questions integer := (p_request->>'question_count')::integer;
  v_choices integer := (p_request->>'choices_count')::integer;
  v_answers jsonb := p_request->'answers';
  v_fingerprint text;
  v_existing public.quick_exam_requests%ROWTYPE;
  v_exam_id uuid;
  v_sheet_id uuid;
  v_question_id uuid;
  v_label text;
  v_index integer;
  v_option_index integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'quick_exam_authentication_required'; END IF;
  IF v_role NOT IN ('super_admin', 'school_admin', 'teacher') THEN
    RAISE EXCEPTION 'quick_exam_role_not_allowed';
  END IF;
  IF v_institution IS NULL OR v_actor_institution IS NULL OR v_institution <> v_actor_institution THEN
    RAISE EXCEPTION 'quick_exam_institution_denied';
  END IF;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'quick_exam_request_id_required'; END IF;
  IF v_title IS NULL OR char_length(v_title) > 240 THEN RAISE EXCEPTION 'quick_exam_title_invalid'; END IF;
  IF v_subject IS NULL THEN RAISE EXCEPTION 'quick_exam_subject_required'; END IF;
  IF v_questions IS NULL OR v_questions < 1 OR v_questions > 200 THEN
    RAISE EXCEPTION 'quick_exam_question_count_invalid';
  END IF;
  IF v_choices IS NULL OR v_choices < 2 OR v_choices > 8 THEN
    RAISE EXCEPTION 'quick_exam_choice_count_invalid';
  END IF;
  IF jsonb_typeof(v_answers) <> 'array' OR jsonb_array_length(v_answers) <> v_questions THEN
    RAISE EXCEPTION 'quick_exam_answer_key_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.id = v_subject AND s.institution_id = v_institution AND s.is_active = true
  ) THEN RAISE EXCEPTION 'quick_exam_subject_not_available'; END IF;

  IF v_class IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = v_class AND c.institution_id = v_institution AND c.is_active = true
  ) THEN RAISE EXCEPTION 'quick_exam_class_not_available'; END IF;

  IF v_section IS NOT NULL AND (
    v_class IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.sections s
      WHERE s.id = v_section AND s.class_id = v_class AND s.is_active = true
    )
  ) THEN RAISE EXCEPTION 'quick_exam_section_not_available'; END IF;

  IF v_role = 'teacher' THEN
    IF v_class IS NULL OR NOT public.teacher_has_class_scope(v_class, v_section)
       OR NOT public.teacher_has_subject_scope(v_subject) THEN
      RAISE EXCEPTION 'quick_exam_teacher_scope_denied';
    END IF;
  END IF;

  FOR v_index IN 0..(v_questions - 1) LOOP
    v_label := upper(v_answers->>v_index);
    IF v_label IS NULL OR char_length(v_label) <> 1 OR v_label < 'A' OR v_label > 'H'
       OR ascii(v_label) - ascii('A') + 1 > v_choices THEN
      RAISE EXCEPTION 'quick_exam_answer_key_invalid';
    END IF;
  END LOOP;

  v_fingerprint := md5(jsonb_build_object(
    'institution_id', v_institution,
    'subject_id', v_subject,
    'class_id', v_class,
    'section_id', v_section,
    'title', v_title,
    'prompt_prefix', v_prompt_prefix,
    'question_count', v_questions,
    'choices_count', v_choices,
    'answers', v_answers
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(v_institution::text || ':' || v_request_id::text, 0));
  SELECT * INTO v_existing
  FROM public.quick_exam_requests r
  WHERE r.institution_id = v_institution AND r.request_id = v_request_id;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'quick_exam_idempotency_conflict';
    END IF;
    SELECT count(*) INTO v_questions FROM public.exam_questions WHERE exam_id = v_existing.exam_id;
    RETURN jsonb_build_object('exam_id', v_existing.exam_id, 'bubble_sheet_id',
      (SELECT b.id FROM public.bubble_sheets b WHERE b.exam_id = v_existing.exam_id ORDER BY b.created_at LIMIT 1),
      'questions_count', v_questions, 'exam_question_links', v_questions, 'reused', true);
  END IF;

  INSERT INTO public.examify_exams (
    institution_id, subject_id, class_id, title, description, total_points,
    passing_score, duration_minutes, max_attempts, shuffle_questions,
    shuffle_options, show_result_immediately, show_correct_answers, status
  ) VALUES (
    v_institution, v_subject, v_class, v_title,
    'تم إنشاؤه من مسار الاختبار السريع', v_questions, ceil(v_questions * 0.5),
    greatest(30, v_questions), 1, false, false, false, false, 'draft'
  ) RETURNING id INTO v_exam_id;

  FOR v_index IN 0..(v_questions - 1) LOOP
    INSERT INTO public.questions (
      institution_id, subject_id, type, prompt, difficulty, points, metadata
    ) VALUES (
      v_institution, v_subject, 'multiple_choice',
      v_prompt_prefix || ' ' || (v_index + 1), 'medium', 1,
      jsonb_build_object('quick_exam', true, 'answer', upper(v_answers->>v_index))
    ) RETURNING id INTO v_question_id;

    FOR v_option_index IN 0..(v_choices - 1) LOOP
      v_label := chr(ascii('A') + v_option_index);
      INSERT INTO public.question_options (question_id, label, is_correct, sort_order)
      VALUES (v_question_id, v_label, v_label = upper(v_answers->>v_index), v_option_index);
    END LOOP;

    INSERT INTO public.exam_questions (exam_id, question_id, points, sort_order)
    VALUES (v_exam_id, v_question_id, 1, v_index);
  END LOOP;

  INSERT INTO public.bubble_sheets (
    institution_id, exam_id, model_label, questions_count, choices_count,
    include_student_id, include_student_name, include_qr
  ) VALUES (
    v_institution, v_exam_id, 'A', v_questions, v_choices, true, true, true
  ) RETURNING id INTO v_sheet_id;

  IF v_class IS NOT NULL THEN
    INSERT INTO public.exam_assignments (exam_id, class_id, section_id)
    VALUES (v_exam_id, v_class, v_section);
  END IF;

  INSERT INTO public.quick_exam_requests (institution_id, request_id, request_fingerprint, exam_id)
  VALUES (v_institution, v_request_id, v_fingerprint, v_exam_id);

  RETURN jsonb_build_object(
    'exam_id', v_exam_id, 'bubble_sheet_id', v_sheet_id,
    'questions_count', v_questions, 'exam_question_links', v_questions, 'reused', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_quick_exam_atomic(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quick_exam_atomic(jsonb) TO authenticated;
