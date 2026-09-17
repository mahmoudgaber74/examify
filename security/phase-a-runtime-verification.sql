-- Phase A runtime verification. This file is intentionally not self-executing
-- from the repository: run it only against a disposable local Supabase DB.
-- It never commits data. It assumes the Phase A migration has already been
-- loaded in the target database and fails loudly when it has not.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE phase_a_context (
  exam_id uuid,
  institution_id uuid,
  staff_user_id uuid,
  staff_role text,
  question_count integer,
  choices_count integer,
  valid_payload jsonb,
  valid_sheet_id uuid,
  institution_b_id uuid,
  staff_user_b_id uuid,
  exam_b_id uuid,
  question_a1_id uuid,
  question_a2_id uuid,
  question_b_id uuid,
  mixed_exam_id uuid
) ON COMMIT DROP;

DO $$
BEGIN
  IF to_regclass('public.bubble_sheet_sections') IS NULL
     OR to_regclass('public.bubble_sheet_questions') IS NULL
     OR to_regclass('public.bubble_sheet_options') IS NULL
     OR to_regprocedure('public.create_exact_bubble_sheet_snapshot(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'HARNESS_ERROR: Phase A migration objects are not present';
  END IF;
END $$;

-- Create all fixtures in this transaction. Auth users use the local auth
-- schema and empty credentials; no real login material is created.
DO $$
DECLARE
  institution_a uuid := gen_random_uuid(); institution_b uuid := gen_random_uuid();
  user_a uuid := gen_random_uuid(); user_b uuid := gen_random_uuid();
  staff_a uuid := gen_random_uuid(); staff_b uuid := gen_random_uuid();
  exam_a uuid := gen_random_uuid(); exam_b uuid := gen_random_uuid(); mixed_exam uuid := gen_random_uuid();
  question_a1 uuid := gen_random_uuid(); question_a2 uuid := gen_random_uuid(); question_b uuid := gen_random_uuid();
  question_m1 uuid := gen_random_uuid(); question_m2 uuid := gen_random_uuid();
  subject_a uuid := gen_random_uuid(); class_a uuid := gen_random_uuid();
  option_id uuid;
BEGIN
  INSERT INTO public.institutions(id,name,subscription_plan,subscription_status,max_students,max_teachers,max_exams,is_active)
  VALUES (institution_a,'Phase A Runtime Tenant A','enterprise','active',10,10,10,true),
         (institution_b,'Phase A Runtime Tenant B','enterprise','active',10,10,10,true);

  INSERT INTO auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES (user_a,'authenticated','authenticated','phase-a-staff-a@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
         (user_b,'authenticated','authenticated','phase-a-staff-b@example.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

  INSERT INTO public.staff_profiles(id,user_id,institution_id,full_name,role,is_active)
  VALUES (staff_a,user_a,institution_a,'Phase A Staff A','teacher',true),
         (staff_b,user_b,institution_b,'Phase A Staff B','teacher',true);

  INSERT INTO public.subjects(id,institution_id,name,name_en,code,is_active)
  VALUES(subject_a,institution_a,'Phase A Subject','Phase A Subject','PHASE-A',true);
  INSERT INTO public.classes(id,institution_id,name,academic_year,is_active)
  VALUES(class_a,institution_a,'Phase A Class','2026-2027',true);

  INSERT INTO public.examify_exams(id,institution_id,subject_id,class_id,teacher_id,title,total_points,passing_score,duration_minutes,max_attempts,status)
  VALUES (exam_a,institution_a,subject_a,class_a,staff_a,'Phase A Exam A',20,50,30,1,'draft'),
         (exam_b,institution_b,NULL,NULL,NULL,'Phase A Exam B',10,50,30,1,'draft'),
         (mixed_exam,institution_a,subject_a,class_a,staff_a,'Phase A Mixed Options Exam',20,50,30,1,'draft');
  INSERT INTO public.questions(id,institution_id,subject_id,type,prompt,difficulty,points,metadata)
  VALUES (question_a1,institution_a,subject_a,'multiple_choice','Phase A question A1','easy',10,'{}'::jsonb),
         (question_a2,institution_a,subject_a,'multiple_choice','Phase A question A2','easy',10,'{}'::jsonb),
         (question_b,institution_b,NULL,'multiple_choice','Phase A question B','easy',10,'{}'::jsonb),
         (question_m1,institution_a,subject_a,'multiple_choice','Phase A mixed question 1','easy',10,'{}'::jsonb),
         (question_m2,institution_a,subject_a,'multiple_choice','Phase A mixed question 2','easy',10,'{}'::jsonb);
  INSERT INTO public.exam_questions(exam_id,question_id,points,sort_order)
  VALUES (exam_a,question_a1,10,0),(exam_a,question_a2,10,1),(exam_b,question_b,10,0),
         (mixed_exam,question_m1,10,0),(mixed_exam,question_m2,10,1);

  FOR option_id IN SELECT gen_random_uuid() FROM generate_series(1,4) LOOP
    INSERT INTO public.question_options(id,question_id,label,is_correct,sort_order)
    VALUES(option_id,question_a1,'A-' || option_id::text,(SELECT count(*) FROM public.question_options WHERE question_id=question_a1)=0,(SELECT count(*) FROM public.question_options WHERE question_id=question_a1));
  END LOOP;
  FOR option_id IN SELECT gen_random_uuid() FROM generate_series(1,4) LOOP
    INSERT INTO public.question_options(id,question_id,label,is_correct,sort_order)
    VALUES(option_id,question_a2,'B-' || option_id::text,(SELECT count(*) FROM public.question_options WHERE question_id=question_a2)=0,(SELECT count(*) FROM public.question_options WHERE question_id=question_a2));
  END LOOP;
  FOR option_id IN SELECT gen_random_uuid() FROM generate_series(1,4) LOOP
    INSERT INTO public.question_options(id,question_id,label,is_correct,sort_order)
    VALUES(option_id,question_b,'C-' || option_id::text,(SELECT count(*) FROM public.question_options WHERE question_id=question_b)=0,(SELECT count(*) FROM public.question_options WHERE question_id=question_b));
  END LOOP;
  FOR option_id IN SELECT gen_random_uuid() FROM generate_series(1,3) LOOP
    INSERT INTO public.question_options(id,question_id,label,is_correct,sort_order)
    VALUES(option_id,question_m1,'M1-' || option_id::text,(SELECT count(*) FROM public.question_options WHERE question_id=question_m1)=0,(SELECT count(*) FROM public.question_options WHERE question_id=question_m1));
  END LOOP;
  FOR option_id IN SELECT gen_random_uuid() FROM generate_series(1,4) LOOP
    INSERT INTO public.question_options(id,question_id,label,is_correct,sort_order)
    VALUES(option_id,question_m2,'M2-' || option_id::text,(SELECT count(*) FROM public.question_options WHERE question_id=question_m2)=0,(SELECT count(*) FROM public.question_options WHERE question_id=question_m2));
  END LOOP;

  INSERT INTO phase_a_context(exam_id,institution_id,staff_user_id,staff_role,question_count,choices_count,institution_b_id,staff_user_b_id,exam_b_id,question_a1_id,question_a2_id,question_b_id,mixed_exam_id)
  VALUES(exam_a,institution_a,user_a,'teacher',2,4,institution_b,user_b,exam_b,question_a1,question_a2,question_b,mixed_exam);
END $$;

DO $$
DECLARE c phase_a_context%ROWTYPE;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HARNESS_ERROR: synthetic fixture creation did not produce a context row';
  ELSE
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', c.staff_user_id::text,
      'role', 'authenticated'
    )::text, true);
    PERFORM set_config('request.jwt.claim.sub', c.staff_user_id::text, true);
    RAISE NOTICE 'Fixture selected: exam %, institution %, staff role %', c.exam_id, c.institution_id, c.staff_role;
  END IF;
END $$;

-- Build the exact payload from the current exam/question/options graph. The
-- coordinates are deterministic normalized values and are not application data.
CREATE FUNCTION pg_temp.phase_a_valid_payload(p_exam_id uuid)
RETURNS jsonb
LANGUAGE sql
AS $$
  WITH ordered_questions AS (
    SELECT eq.id AS exam_question_id, eq.question_id, q.type AS question_type, eq.points AS points_snapshot, eq.sort_order,
           row_number() OVER (ORDER BY eq.sort_order, eq.id)::integer AS question_number
    FROM public.exam_questions eq
    JOIN public.questions q ON q.id = eq.question_id
    WHERE eq.exam_id = p_exam_id
  ),
  question_payloads AS (
    SELECT oq.question_id, oq.sort_order, oq.question_number,
           jsonb_build_object(
             'exam_question_id', oq.exam_question_id,
             'question_id', oq.question_id,
             'question_type', oq.question_type,
             'points_snapshot', oq.points_snapshot,
             'omr_eligible', true,
             'question_ordinal', oq.question_number,
             'section_visual_index', 0,
             'global_question_number', oq.question_number,
             'section_question_number', oq.question_number,
             'page_number', 1,
             'sort_snapshot', oq.sort_order,
             'normalized_x', 0.10,
             'normalized_y', 0.20,
             'normalized_width', 0.80,
             'normalized_height', 0.03,
             'options', (
               SELECT jsonb_agg(jsonb_build_object(
                 'option_id', qo_idx.id,
                 'option_label', qo_idx.label,
                 'canonical_option_ordinal', qo_idx.visual_index + 1,
                 'visual_index', qo_idx.visual_index,
                 'normalized_x', 0.10 + (qo_idx.visual_index * 0.18),
                 'normalized_y', 0.25,
                 'normalized_width', 0.10,
                 'normalized_height', 0.02
               ) ORDER BY qo_idx.sort_order, qo_idx.id)
               FROM LATERAL (
                 SELECT qo.*, row_number() OVER (ORDER BY qo.sort_order, qo.id)::integer - 1 AS visual_index
                 FROM public.question_options qo
                 WHERE qo.question_id = oq.question_id
               ) qo_idx
             )
           ) AS payload
    FROM ordered_questions oq
  )
  SELECT jsonb_build_object(
    'exam_id', p_exam_id,
    'model_label', 'A',
    'questions_count', (SELECT count(*)::integer FROM question_payloads),
    'choices_count', 4,
    'include_student_id', true,
    'include_student_name', true,
    'include_qr', true,
    'template_version', 1,
    'qr_token', gen_random_uuid(),
    'page_size', 'A4',
    'page_orientation', 'portrait',
    'generator_version', 'phase-a-runtime-test',
    'sections', jsonb_build_array(jsonb_build_object(
      'section_key', 'runtime-test',
      'title', 'Runtime test',
      'visual_index', 0,
      'question_start_index', 1,
      'question_count', (SELECT count(*)::integer FROM question_payloads),
      'page_number', 1,
      'normalized_x', 0.05,
      'normalized_y', 0.10,
      'normalized_width', 0.90,
      'normalized_height', 0.80
    )),
    'questions', COALESCE((SELECT jsonb_agg(payload ORDER BY question_number) FROM question_payloads), '[]'::jsonb)
  );
$$;

UPDATE phase_a_context
SET valid_payload = pg_temp.phase_a_valid_payload(exam_id);

CREATE FUNCTION pg_temp.phase_a_assert_rpc_rejects(p_label text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE succeeded boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_exact_bubble_sheet_snapshot(p_payload);
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: % was accepted', p_label; END IF;
  RAISE NOTICE 'PASS rejected %', p_label;
END;
$$;

CREATE FUNCTION pg_temp.phase_a_assert_rpc_rejects_expected(p_label text, p_payload jsonb, p_expected_error text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  succeeded boolean := false;
  error_message text := null;
BEGIN
  BEGIN
    PERFORM public.create_exact_bubble_sheet_snapshot(p_payload);
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: % was accepted', p_label;
  END IF;
  IF p_expected_error IS NOT NULL AND position(p_expected_error IN coalesce(error_message, '')) = 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: % returned unexpected error: %', p_label, error_message;
  END IF;
  RAISE NOTICE 'PASS rejected % (%): %', p_label, p_expected_error, error_message;
END;
$$;

CREATE FUNCTION pg_temp.phase_a_assert_idempotent_rejects_expected(p_label text, p_payload jsonb, p_expected_error text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE succeeded boolean := false; error_message text := null;
BEGIN
  BEGIN
    PERFORM public.create_exact_bubble_sheet_snapshot_idempotent(p_payload);
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
  END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: % was accepted', p_label; END IF;
  IF position(p_expected_error IN coalesce(error_message, '')) = 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: % returned unexpected error: %', p_label, error_message;
  END IF;
  RAISE NOTICE 'PASS rejected % (%): %', p_label, p_expected_error, error_message;
END;
$$;

-- Required runtime fixture precheck.
DO $$
DECLARE c phase_a_context%ROWTYPE;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF c.exam_id IS NULL OR c.institution_id IS NULL OR c.staff_user_id IS NULL
     OR c.question_count IS NULL OR c.question_count < 1 OR c.choices_count IS NULL
     OR c.valid_payload IS NULL THEN
    RAISE EXCEPTION 'HARNESS_ERROR: required Phase A fixture IDs or payload are missing';
  END IF;
  IF (SELECT count(*) FROM public.exam_questions WHERE exam_id = c.exam_id) <> c.question_count THEN
    RAISE EXCEPTION 'HARNESS_ERROR: exam question fixture changed during setup';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.exam_questions eq
    WHERE eq.exam_id = c.exam_id
      AND (SELECT count(*) FROM public.question_options qo WHERE qo.question_id = eq.question_id) <> c.choices_count
  ) THEN
    RAISE EXCEPTION 'HARNESS_ERROR: question option fixture is not exactly four options per question';
  END IF;
END $$;

-- Phase A.2 runtime invariant: MCQ and true/false must have exactly one
-- correct option. Invalid cases are forced to check immediately so the
-- expected rejection is observed inside this transaction.
DO $$
DECLARE
  c phase_a_context%ROWTYPE;
  q_valid uuid := gen_random_uuid();
  q_tf_valid uuid := gen_random_uuid();
  q_zero uuid := gen_random_uuid();
  q_two uuid := gen_random_uuid();
  q_tf_zero uuid := gen_random_uuid();
  q_tf_two uuid := gen_random_uuid();
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'HARNESS_ERROR: invariant fixture context unavailable'; END IF;
  INSERT INTO public.questions(id,institution_id,subject_id,type,prompt,difficulty,points,metadata)
  VALUES
    (q_valid,c.institution_id,NULL,'multiple_choice','Phase A.2 valid MCQ','easy',1,'{}'),
    (q_tf_valid,c.institution_id,NULL,'true_false','Phase A.2 valid true-false','easy',1,'{}');
  INSERT INTO public.question_options(question_id,label,is_correct,sort_order)
  VALUES(q_valid,'A',true,0),(q_valid,'B',false,1),
        (q_tf_valid,'True',false,0),(q_tf_valid,'False',true,1);
  SET CONSTRAINTS trg_validate_single_answer_question_options IMMEDIATE;
  RAISE NOTICE 'PASS valid MCQ and true_false exactly-one invariant';
  SET CONSTRAINTS ALL DEFERRED;

  INSERT INTO public.questions(id,institution_id,type,prompt,difficulty,points,metadata)
  VALUES(q_zero,c.institution_id,'multiple_choice','Phase A.2 zero-correct MCQ','easy',1,'{}');
  BEGIN
    INSERT INTO public.question_options(question_id,label,is_correct,sort_order)
    VALUES(q_zero,'A',false,0),(q_zero,'B',false,1);
    SET CONSTRAINTS trg_validate_single_answer_question_options IMMEDIATE;
    RAISE EXCEPTION 'ASSERTION_FAILED: zero-correct MCQ accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION_FAILED:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS zero-correct MCQ rejected: %', SQLERRM;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  INSERT INTO public.questions(id,institution_id,type,prompt,difficulty,points,metadata)
  VALUES(q_two,c.institution_id,'multiple_choice','Phase A.2 two-correct MCQ','easy',1,'{}');
  BEGIN
    INSERT INTO public.question_options(question_id,label,is_correct,sort_order)
    VALUES(q_two,'A',true,0),(q_two,'B',true,1);
    SET CONSTRAINTS trg_validate_single_answer_question_options IMMEDIATE;
    RAISE EXCEPTION 'ASSERTION_FAILED: two-correct MCQ accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION_FAILED:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS two-correct MCQ rejected: %', SQLERRM;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  INSERT INTO public.questions(id,institution_id,type,prompt,difficulty,points,metadata)
  VALUES
    (q_tf_zero,c.institution_id,'true_false','Phase A.2 zero-correct true-false','easy',1,'{}'),
    (q_tf_two,c.institution_id,'true_false','Phase A.2 two-correct true-false','easy',1,'{}');
  BEGIN
    INSERT INTO public.question_options(question_id,label,is_correct,sort_order)
    VALUES(q_tf_zero,'True',false,0),(q_tf_zero,'False',false,1);
    SET CONSTRAINTS trg_validate_single_answer_question_options IMMEDIATE;
    RAISE EXCEPTION 'ASSERTION_FAILED: zero-correct true-false accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION_FAILED:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS zero-correct true-false rejected: %', SQLERRM;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    INSERT INTO public.question_options(question_id,label,is_correct,sort_order)
    VALUES(q_tf_two,'True',true,0),(q_tf_two,'False',true,1);
    SET CONSTRAINTS trg_validate_single_answer_question_options IMMEDIATE;
    RAISE EXCEPTION 'ASSERTION_FAILED: two-correct true-false accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION_FAILED:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS two-correct true-false rejected: %', SQLERRM;
  END;
  SET CONSTRAINTS ALL DEFERRED;
END $$;

-- 1. Valid exact snapshot creation and finalization.
DO $$
DECLARE c phase_a_context%ROWTYPE; result jsonb; sheet_id uuid;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT public.create_exact_bubble_sheet_snapshot(c.valid_payload) INTO result;
  sheet_id := (result->>'id')::uuid;
  UPDATE phase_a_context SET valid_sheet_id = sheet_id;
  IF NOT EXISTS (SELECT 1 FROM public.bubble_sheets WHERE id=sheet_id AND snapshot_state='exact' AND is_finalized AND finalized_at IS NOT NULL) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: valid snapshot was not finalized exactly';
  END IF;
  IF (SELECT count(*) FROM public.bubble_sheet_sections WHERE bubble_sheet_id=sheet_id) < 1
     OR (SELECT count(*) FROM public.bubble_sheet_questions WHERE bubble_sheet_id=sheet_id) <> c.question_count
     OR (SELECT count(*) FROM public.bubble_sheet_options o JOIN public.bubble_sheet_questions q ON q.id=o.bubble_sheet_question_id WHERE q.bubble_sheet_id=sheet_id) <> c.question_count*c.choices_count THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: valid snapshot child rows are incomplete';
  END IF;
  RAISE NOTICE 'PASS valid exact snapshot: %', sheet_id;
END $$;

-- Phase A.4 request-scoped retry contract. The same semantic payload and key
-- must reuse one finalized row; a conflicting payload must be rejected.
DO $$
DECLARE
  c phase_a_context%ROWTYPE;
  keyed_payload jsonb;
  first_result jsonb;
  retry_result jsonb;
  before_count integer;
  after_count integer;
BEGIN
  IF to_regprocedure('public.create_exact_bubble_sheet_snapshot_idempotent(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'HARNESS_ERROR: Phase A.4 idempotency RPC is not present';
  END IF;
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  keyed_payload := c.valid_payload || jsonb_build_object('generation_request_id', '44000000-0000-4000-8000-000000000001', 'qr_token', '45000000-0000-4000-8000-000000000001');
  SELECT count(*) INTO before_count FROM public.bubble_sheets WHERE exam_id = c.exam_id;
  SELECT public.create_exact_bubble_sheet_snapshot_idempotent(keyed_payload) INTO first_result;
  SELECT public.create_exact_bubble_sheet_snapshot_idempotent(keyed_payload) INTO retry_result;
  SELECT count(*) INTO after_count FROM public.bubble_sheets WHERE exam_id = c.exam_id;
  IF (first_result->>'id') IS DISTINCT FROM (retry_result->>'id') OR after_count <> before_count + 1
     OR coalesce((retry_result->>'reused')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: idempotent retry did not reuse the first snapshot';
  END IF;
  RAISE NOTICE 'PASS idempotent retry reused snapshot %', first_result->>'id';
  PERFORM pg_temp.phase_a_assert_idempotent_rejects_expected(
    'conflicting idempotency payload',
    keyed_payload || jsonb_build_object('questions_count', 3, 'qr_token', '46000000-0000-4000-8000-000000000001'),
    'OMR_SNAPSHOT_IDEMPOTENCY_CONFLICT');
END $$;

-- Authoritative source validation matrix. Every case must be rejected before
-- any snapshot parent can be finalized.
DO $$
DECLARE
  c phase_a_context%ROWTYPE;
  p jsonb;
  questions jsonb;
  options jsonb;
  other_option_id uuid;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  questions := c.valid_payload->'questions';
  options := questions->0->'options';
  SELECT qo.id INTO other_option_id
  FROM public.question_options qo
  WHERE qo.question_id = c.question_a2_id
  ORDER BY qo.sort_order, qo.id
  LIMIT 1;

  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'missing authoritative exam question',
    jsonb_set(c.valid_payload, '{questions}', questions - 1, false),
    'omr_template_eligible_question_count_mismatch');

  p := jsonb_set(c.valid_payload, '{questions,1,question_id}', to_jsonb(c.question_b_id), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'extra non-exam question', p, 'omr_template_question_source_mismatch');

  p := jsonb_set(jsonb_set(c.valid_payload, '{questions,1,question_id}', to_jsonb(c.question_a1_id), false), '{questions,1,exam_question_id}', c.valid_payload->'questions'->0->'exam_question_id', false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'duplicate exam question', p, 'omr_template_exam_question_duplicate');

  p := jsonb_set(c.valid_payload, '{questions}', jsonb_build_array(questions->1, questions->0), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'wrong canonical question order', p, 'omr_template_question_source_mismatch');

  p := jsonb_set(c.valid_payload, '{questions,0,global_question_number}', to_jsonb(2), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'wrong global question number', p, 'omr_template_question_source_mismatch');

  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'missing authoritative option',
    jsonb_set(c.valid_payload, '{questions,0,options}', options - 1, false),
    'omr_template_option_source_mismatch');

  p := jsonb_set(c.valid_payload, '{questions,0,options,0,option_id}', to_jsonb(other_option_id), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'extra option from another question', p, 'omr_template_option_order_mismatch');

  p := jsonb_set(c.valid_payload, '{questions,0,options}', options || jsonb_build_array(options->0), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'duplicate option id', p, 'omr_template_option_source_mismatch');

  p := jsonb_set(c.valid_payload, '{questions,0,options}', jsonb_build_array(options->1, options->0, options->2, options->3), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'wrong authoritative option order', p, 'omr_template_option_order_mismatch');

  p := pg_temp.phase_a_valid_payload(c.mixed_exam_id);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'mixed option-count exam', p, 'omr_template_exam_option_count_mixed');

  p := jsonb_set(c.valid_payload, '{choices_count}', to_jsonb(3), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'incorrect choices_count below source', p, 'omr_template_choices_count_mismatch');
  p := jsonb_set(c.valid_payload, '{choices_count}', to_jsonb(5), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects_expected(
    'incorrect choices_count above source', p, 'omr_template_choices_count_mismatch');

  RAISE NOTICE 'PASS authoritative question/option completeness matrix';
END $$;

-- Helper for expected-error assertions. Each block is a nested transaction;
-- the test fails if the protected operation unexpectedly succeeds.
DO $$
DECLARE c phase_a_context%ROWTYPE; bad_payload jsonb; succeeded boolean := false; before_count integer; after_count integer;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  bad_payload := jsonb_set(c.valid_payload, '{questions,0,options,0,option_id}', to_jsonb(gen_random_uuid()), false);
  SELECT count(*) INTO before_count FROM public.bubble_sheets WHERE generated_by=c.staff_user_id AND generator_version='phase-a-runtime-test';
  BEGIN
    PERFORM public.create_exact_bubble_sheet_snapshot(bad_payload);
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: invalid option mapping was accepted'; END IF;
  SELECT count(*) INTO after_count FROM public.bubble_sheets WHERE generated_by=c.staff_user_id AND generator_version='phase-a-runtime-test';
  IF after_count <> before_count THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: failed RPC left an exact parent row';
  END IF;
  RAISE NOTICE 'PASS transaction atomicity and invalid option mapping';
END $$;

-- 6-10. Invalid option counts/order, global numbering, and section totals.
DO $$
DECLARE c phase_a_context%ROWTYPE; p jsonb; first_options jsonb; first_question jsonb;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  first_question := c.valid_payload->'questions'->0;
  first_options := first_question->'options';
  PERFORM pg_temp.phase_a_assert_rpc_rejects('too few options', jsonb_set(c.valid_payload, '{questions,0,options}', '[]'::jsonb, false));
  PERFORM pg_temp.phase_a_assert_rpc_rejects('too many/duplicate options', jsonb_set(c.valid_payload, '{questions,0,options}', first_options || jsonb_build_array(first_options->0), false));
  p := jsonb_set(c.valid_payload, '{questions,0,options,1,visual_index}', to_jsonb(0), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects('duplicate option visual index', p);
  p := jsonb_set(c.valid_payload, '{questions,0,global_question_number}', to_jsonb(0), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects('global question number zero', p);
  p := jsonb_set(c.valid_payload, '{questions,0,global_question_number}', to_jsonb(2), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects('global question numbering gap/duplicate', p);
  p := jsonb_set(c.valid_payload, '{sections,0,question_count}', to_jsonb(c.question_count + 1), false);
  PERFORM pg_temp.phase_a_assert_rpc_rejects('section question-count mismatch', p);
  RAISE NOTICE 'PASS option, numbering, and section consistency matrix';
END $$;

-- 3-5. Direct child relationship checks. The database is the actor here so
-- these tests exercise FK integrity independently of client/RLS privileges.
DO $$
DECLARE c phase_a_context%ROWTYPE; sheet_id uuid; other_sheet_id uuid; section_id uuid; other_section_id uuid; other_option_id uuid; question_id uuid; question_snapshot_id uuid; succeeded boolean;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.bubble_sheets(institution_id, exam_id, model_label, questions_count, choices_count, qr_token, snapshot_state, generator_version, generated_by)
  VALUES(c.institution_id,c.exam_id,'T',c.question_count,c.choices_count,gen_random_uuid(),'draft','phase-a-runtime-direct',c.staff_user_id)
  RETURNING id INTO sheet_id;
  INSERT INTO public.bubble_sheet_sections(bubble_sheet_id,section_key,title,visual_index,question_start_index,question_count,normalized_x,normalized_y,normalized_width,normalized_height)
  VALUES(sheet_id,'direct','Direct',0,1,c.question_count,0.05,0.1,0.9,0.8) RETURNING id INTO section_id;
  INSERT INTO public.bubble_sheets(institution_id, exam_id, model_label, questions_count, choices_count, qr_token, snapshot_state, generator_version, generated_by)
  VALUES(c.institution_id,c.exam_id,'T2',c.question_count,c.choices_count,gen_random_uuid(),'draft','phase-a-runtime-direct-2',c.staff_user_id)
  RETURNING id INTO other_sheet_id;
  INSERT INTO public.bubble_sheet_sections(bubble_sheet_id,section_key,title,visual_index,question_start_index,question_count,normalized_x,normalized_y,normalized_width,normalized_height)
  VALUES(other_sheet_id,'other','Other',0,1,c.question_count,0.05,0.1,0.9,0.8) RETURNING id INTO other_section_id;
  SELECT eq.question_id INTO question_id FROM public.exam_questions eq WHERE eq.exam_id=c.exam_id ORDER BY eq.sort_order,eq.id LIMIT 1;

  BEGIN
    INSERT INTO public.bubble_sheet_questions(bubble_sheet_id,section_id,question_id,exam_id,global_question_number,section_question_number,page_number,sort_snapshot,normalized_x,normalized_y,normalized_width,normalized_height)
    VALUES(sheet_id,other_section_id,question_id,c.exam_id,1,1,1,0,0.1,0.2,0.8,0.03);
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN succeeded := false; END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: cross-sheet section was accepted'; END IF;

  BEGIN
    INSERT INTO public.bubble_sheet_questions(bubble_sheet_id,section_id,question_id,exam_id,global_question_number,section_question_number,page_number,sort_snapshot,normalized_x,normalized_y,normalized_width,normalized_height)
    VALUES(sheet_id,section_id,c.question_b_id,c.exam_id,1,1,1,0,0.1,0.2,0.8,0.03);
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN succeeded := false; END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: question/exam mismatch was accepted'; END IF;

  SELECT qo.id INTO other_option_id FROM public.question_options qo WHERE qo.question_id=c.question_a2_id ORDER BY qo.sort_order,qo.id LIMIT 1;
  INSERT INTO public.bubble_sheet_questions(bubble_sheet_id,section_id,question_id,exam_id,global_question_number,section_question_number,page_number,sort_snapshot,normalized_x,normalized_y,normalized_width,normalized_height)
  VALUES(sheet_id,section_id,question_id,c.exam_id,2,2,1,1,0.1,0.3,0.8,0.03) RETURNING id INTO question_snapshot_id;
  BEGIN
    INSERT INTO public.bubble_sheet_options(bubble_sheet_question_id,question_id,option_id,option_label,visual_index,normalized_x,normalized_y,normalized_width,normalized_height)
    VALUES(question_snapshot_id,question_id,other_option_id,'wrong',0,0.1,0.25,0.1,0.02);
    succeeded := true;
  EXCEPTION WHEN OTHERS THEN succeeded := false; END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: option/question mismatch was accepted'; END IF;
  RAISE NOTICE 'PASS section, question/exam, and option/question ownership checks';
END $$;

-- 7-10. State, count, and numbering rejection probes are tested through the
-- finalized parent trigger using the valid snapshot created above.
DO $$
DECLARE c phase_a_context%ROWTYPE; succeeded boolean; sheet_id uuid;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  sheet_id := c.valid_sheet_id;
  BEGIN UPDATE public.bubble_sheets SET snapshot_state='draft' WHERE id=sheet_id; succeeded:=true; EXCEPTION WHEN OTHERS THEN succeeded:=false; END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: finalized state was mutable'; END IF;
  BEGIN DELETE FROM public.bubble_sheets WHERE id=sheet_id; succeeded:=true; EXCEPTION WHEN OTHERS THEN succeeded:=false; END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: finalized sheet deletion was accepted'; END IF;
  RAISE NOTICE 'PASS finalized state and deletion protection';
END $$;

-- Child mutation protection after finalization.
DO $$
DECLARE c phase_a_context%ROWTYPE; qid uuid; sid uuid; oid uuid; succeeded boolean;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT id INTO sid FROM public.bubble_sheet_sections WHERE bubble_sheet_id=c.valid_sheet_id LIMIT 1;
  SELECT id INTO qid FROM public.bubble_sheet_questions WHERE bubble_sheet_id=c.valid_sheet_id LIMIT 1;
  SELECT id INTO oid FROM public.bubble_sheet_options WHERE bubble_sheet_question_id=qid LIMIT 1;
  BEGIN UPDATE public.bubble_sheet_sections SET title='changed' WHERE id=sid; succeeded:=true; EXCEPTION WHEN OTHERS THEN succeeded:=false; END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: finalized section changed'; END IF;
  BEGIN UPDATE public.bubble_sheet_questions SET sort_snapshot=sort_snapshot+1 WHERE id=qid; succeeded:=true; EXCEPTION WHEN OTHERS THEN succeeded:=false; END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: finalized question changed'; END IF;
  BEGIN UPDATE public.bubble_sheet_options SET option_label='changed' WHERE id=oid; succeeded:=true; EXCEPTION WHEN OTHERS THEN succeeded:=false; END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: finalized option changed'; END IF;
  BEGIN DELETE FROM public.bubble_sheet_options WHERE id=oid; succeeded:=true; EXCEPTION WHEN OTHERS THEN succeeded:=false; END;
  IF succeeded THEN RAISE EXCEPTION 'ASSERTION_FAILED: finalized child deletion accepted'; END IF;
  RAISE NOTICE 'PASS finalized child immutability';
END $$;

-- 13. Draft deletion and cascade.
DO $$
DECLARE c phase_a_context%ROWTYPE; draft_id uuid; section_id uuid; qid uuid; succeeded boolean;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.bubble_sheets(institution_id,exam_id,model_label,questions_count,choices_count,qr_token,snapshot_state,generator_version,generated_by)
  VALUES(c.institution_id,c.exam_id,'D',c.question_count,c.choices_count,gen_random_uuid(),'draft','phase-a-runtime-draft',c.staff_user_id) RETURNING id INTO draft_id;
  INSERT INTO public.bubble_sheet_sections(bubble_sheet_id,section_key,title,visual_index,question_start_index,question_count,normalized_x,normalized_y,normalized_width,normalized_height)
  VALUES(draft_id,'draft','Draft',0,1,c.question_count,0.05,0.1,0.9,0.8) RETURNING id INTO section_id;
  SELECT eq.question_id INTO qid FROM public.exam_questions eq WHERE eq.exam_id=c.exam_id ORDER BY eq.sort_order,eq.id LIMIT 1;
  INSERT INTO public.bubble_sheet_questions(bubble_sheet_id,section_id,question_id,exam_id,global_question_number,section_question_number,page_number,sort_snapshot,normalized_x,normalized_y,normalized_width,normalized_height)
  VALUES(draft_id,section_id,qid,c.exam_id,1,1,1,0,0.1,0.2,0.8,0.03);
  DELETE FROM public.bubble_sheets WHERE id=draft_id;
  IF EXISTS (SELECT 1 FROM public.bubble_sheet_sections WHERE bubble_sheet_id=draft_id)
     OR EXISTS (SELECT 1 FROM public.bubble_sheet_questions WHERE bubble_sheet_id=draft_id) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: draft child rows did not cascade';
  END IF;
  RAISE NOTICE 'PASS draft deletion cascade';
END $$;

-- 14. Authorization is deliberately verified only when a real local staff
-- fixture was found. The valid RPC call above proves authorized execution.
DO $$
DECLARE c phase_a_context%ROWTYPE; denied boolean := false;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'HARNESS_ERROR: synthetic authorization fixture is unavailable'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',gen_random_uuid()::text,'role','anon')::text,true);
  BEGIN PERFORM public.create_exact_bubble_sheet_snapshot(c.valid_payload); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'ASSERTION_FAILED: anonymous RPC execution was accepted'; END IF;
  RAISE NOTICE 'BLOCKED_EXTERNAL: SQL session cannot prove anon EXECUTE privilege; function-level anonymous rejection was observed, but REST grant behavior requires an actual anon session';
  denied := false;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c.staff_user_b_id::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c.staff_user_b_id::text, true);
  BEGIN PERFORM public.create_exact_bubble_sheet_snapshot(c.valid_payload); EXCEPTION WHEN OTHERS THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'ASSERTION_FAILED: cross-institution staff RPC execution was accepted'; END IF;
  RAISE NOTICE 'PASS cross-institution staff rejection';
END $$;

-- 15. Legacy compatibility: add a legacy row in the transaction and verify
-- defaults/worker-facing columns remain readable without child rows.
DO $$
DECLARE c phase_a_context%ROWTYPE; legacy_id uuid;
BEGIN
  SELECT * INTO c FROM phase_a_context LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.bubble_sheets(institution_id,exam_id,model_label,questions_count,choices_count,qr_token,generated_by)
  VALUES(c.institution_id,c.exam_id,'LEGACY',c.question_count,c.choices_count,gen_random_uuid(),c.staff_user_id)
  RETURNING id INTO legacy_id;
  IF NOT EXISTS (SELECT 1 FROM public.bubble_sheets WHERE id=legacy_id AND snapshot_state='legacy' AND is_finalized=false AND finalized_at IS NULL) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: legacy default state is incorrect';
  END IF;
  RAISE NOTICE 'PASS legacy compatibility: %', legacy_id;
END $$;

SELECT 'PASS SUMMARY: Phase A runtime assertions completed in one transaction; all changes will be rolled back.' AS summary;
ROLLBACK;
