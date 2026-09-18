\set ON_ERROR_STOP on
\set test_inst_a '10000000-0000-0000-0000-000000000001'
\set test_inst_b '10000000-0000-0000-0000-000000000002'
\set test_admin_a '10000000-0000-0000-0000-000000000101'
\set test_admin_b '10000000-0000-0000-0000-000000000102'
\set test_student_a_user '10000000-0000-0000-0000-000000000201'
\set test_student_b_user '10000000-0000-0000-0000-000000000202'
\set test_student_a2_user '10000000-0000-0000-0000-000000000203'
\set test_student_a3_user '10000000-0000-0000-0000-000000000204'
\set test_student_a4_user '10000000-0000-0000-0000-000000000205'
\set test_student_a2 '10000000-0000-0000-0000-000000000703'
\set test_student_a3 '10000000-0000-0000-0000-000000000704'
\set test_student_a4 '10000000-0000-0000-0000-000000000705'
\set test_subject_a '10000000-0000-0000-0000-000000000301'
\set test_subject_b '10000000-0000-0000-0000-000000000302'
\set test_outcome_a '10000000-0000-0000-0000-000000000501'
\set test_outcome_a2 '10000000-0000-0000-0000-000000000503'
\set test_outcome_b '10000000-0000-0000-0000-000000000502'
\set test_exam_a '10000000-0000-0000-0000-000000000601'
\set test_q_a1 '10000000-0000-0000-0000-000000000401'
\set test_q_a2 '10000000-0000-0000-0000-000000000402'
\set test_q_a3 '10000000-0000-0000-0000-000000000403'
\set test_q_a4 '10000000-0000-0000-0000-000000000404'
\set test_q_b1 '10000000-0000-0000-0000-000000000405'
\set test_student_a '10000000-0000-0000-0000-000000000701'
\set test_student_b '10000000-0000-0000-0000-000000000702'
\set test_request '10000000-0000-0000-0000-000000000801'

\echo 'Cleaning only the fixed Phase 1 fixture identifiers'
DELETE FROM public.institutions WHERE id IN (:'test_inst_a'::uuid, :'test_inst_b'::uuid);
DELETE FROM auth.users WHERE id IN (
  :'test_admin_a'::uuid, :'test_admin_b'::uuid,
  :'test_student_a_user'::uuid, :'test_student_b_user'::uuid,
  :'test_student_a2_user'::uuid, :'test_student_a3_user'::uuid, :'test_student_a4_user'::uuid
);

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', :'test_admin_a', 'role', 'authenticated',
  'raw_app_meta_data', json_build_object('role', 'school_admin'))::text, false);

BEGIN;
INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  email_confirmed_at, created_at, updated_at, is_super_admin, is_anonymous)
VALUES
  (:'test_admin_a'::uuid, 'authenticated', 'authenticated', 'phase1-admin-a@example.test', '{"role":"school_admin"}', '{}', now(), now(), now(), false, false),
  (:'test_admin_b'::uuid, 'authenticated', 'authenticated', 'phase1-admin-b@example.test', '{"role":"school_admin"}', '{}', now(), now(), now(), false, false),
  (:'test_student_a_user'::uuid, 'authenticated', 'authenticated', 'phase1-student-a@example.test', '{"role":"student"}', '{}', now(), now(), now(), false, false),
  (:'test_student_b_user'::uuid, 'authenticated', 'authenticated', 'phase1-student-b@example.test', '{"role":"student"}', '{}', now(), now(), now(), false, false),
  (:'test_student_a2_user'::uuid, 'authenticated', 'authenticated', 'phase1-student-a2@example.test', '{"role":"student"}', '{}', now(), now(), now(), false, false),
  (:'test_student_a3_user'::uuid, 'authenticated', 'authenticated', 'phase1-student-a3@example.test', '{"role":"student"}', '{}', now(), now(), now(), false, false),
  (:'test_student_a4_user'::uuid, 'authenticated', 'authenticated', 'phase1-student-a4@example.test', '{"role":"student"}', '{}', now(), now(), now(), false, false);

INSERT INTO public.institutions (id, name, name_en, logo_url, created_by)
VALUES
  (:'test_inst_a'::uuid, 'مؤسسة اختبار ألف', 'Phase 1 Institution A', 'https://example.test/a.svg', :'test_admin_a'::uuid),
  (:'test_inst_b'::uuid, 'مؤسسة اختبار باء', 'Phase 1 Institution B', 'https://example.test/b.svg', :'test_admin_b'::uuid);

INSERT INTO public.staff_profiles (id, user_id, institution_id, full_name, role, is_active)
VALUES
  (:'test_admin_a'::uuid, :'test_admin_a'::uuid, :'test_inst_a'::uuid, 'مدير المؤسسة ألف', 'school_admin', true),
  (:'test_admin_b'::uuid, :'test_admin_b'::uuid, :'test_inst_b'::uuid, 'مدير المؤسسة باء', 'school_admin', true);

INSERT INTO public.student_profiles (id, user_id, institution_id, student_code, full_name, is_active)
VALUES
  (:'test_student_a'::uuid, :'test_student_a_user'::uuid, :'test_inst_a'::uuid, 'P1-A', 'طالب اختبار ألف', true),
  (:'test_student_b'::uuid, :'test_student_b_user'::uuid, :'test_inst_b'::uuid, 'P1-B', 'طالب اختبار باء', true),
  (:'test_student_a2'::uuid, :'test_student_a2_user'::uuid, :'test_inst_a'::uuid, 'P1-A2', 'طالب اختبار ألف 2', true),
  (:'test_student_a3'::uuid, :'test_student_a3_user'::uuid, :'test_inst_a'::uuid, 'P1-A3', 'طالب اختبار ألف 3', true),
  (:'test_student_a4'::uuid, :'test_student_a4_user'::uuid, :'test_inst_a'::uuid, 'P1-A4', 'طالب اختبار ألف 4', true);

INSERT INTO public.subjects (id, institution_id, name, code, is_active)
VALUES
  (:'test_subject_a'::uuid, :'test_inst_a'::uuid, 'رياضيات ألف', 'P1-MATH-A', true),
  (:'test_subject_b'::uuid, :'test_inst_b'::uuid, 'رياضيات باء', 'P1-MATH-B', true);

INSERT INTO public.learning_outcomes (id, institution_id, subject_id, code, name_ar, unit, lesson, created_by)
VALUES
  (:'test_outcome_a'::uuid, :'test_inst_a'::uuid, :'test_subject_a'::uuid, 'P1-LO-A', 'يفهم الطالب المفهوم الأساسي', 'الوحدة الأولى', 'الدرس الأول', :'test_admin_a'::uuid),
  (:'test_outcome_a2'::uuid, :'test_inst_a'::uuid, :'test_subject_a'::uuid, 'P1-LO-A2', 'يطبق الطالب المفهوم في مسألة', 'الوحدة الأولى', 'الدرس الثاني', :'test_admin_a'::uuid),
  (:'test_outcome_b'::uuid, :'test_inst_b'::uuid, :'test_subject_b'::uuid, 'P1-LO-B', 'ناتج مؤسسة أخرى', 'الوحدة الأولى', 'الدرس الأول', :'test_admin_b'::uuid);

INSERT INTO public.questions (id, institution_id, subject_id, teacher_id, type, prompt, difficulty, unit, lesson, points, is_public)
VALUES
  (:'test_q_a1'::uuid, :'test_inst_a'::uuid, :'test_subject_a'::uuid, :'test_admin_a'::uuid, 'short_answer', 'سؤال اختبار ألف 1', 'easy', 'الوحدة الأولى', 'الدرس الأول', 1, false),
  (:'test_q_a2'::uuid, :'test_inst_a'::uuid, :'test_subject_a'::uuid, :'test_admin_a'::uuid, 'short_answer', 'سؤال اختبار ألف 2', 'medium', 'الوحدة الأولى', 'الدرس الأول', 1, false),
  (:'test_q_a3'::uuid, :'test_inst_a'::uuid, :'test_subject_a'::uuid, :'test_admin_a'::uuid, 'short_answer', 'سؤال blueprint ألف 3', 'easy', 'الوحدة الثانية', 'الدرس الثاني', 1, false),
  (:'test_q_a4'::uuid, :'test_inst_a'::uuid, :'test_subject_a'::uuid, :'test_admin_a'::uuid, 'short_answer', 'سؤال blueprint ألف 4', 'easy', 'الوحدة الثانية', 'الدرس الثاني', 1, false);

INSERT INTO public.question_learning_outcomes (question_id, learning_outcome_id, weight)
VALUES
  (:'test_q_a1'::uuid, :'test_outcome_a'::uuid, 1),
  (:'test_q_a2'::uuid, :'test_outcome_a'::uuid, 0.5),
  (:'test_q_a2'::uuid, :'test_outcome_a2'::uuid, 0.5);

INSERT INTO public.examify_exams (id, institution_id, subject_id, title, total_points, passing_score, duration_minutes, status)
VALUES (:'test_exam_a'::uuid, :'test_inst_a'::uuid, :'test_subject_a'::uuid, 'امتحان تقرير الطالب', 2, 1, 30, 'published');

INSERT INTO public.exam_questions (exam_id, question_id, points, sort_order)
VALUES
  (:'test_exam_a'::uuid, :'test_q_a1'::uuid, 1, 0),
  (:'test_exam_a'::uuid, :'test_q_a2'::uuid, 1, 1);

INSERT INTO public.exam_attempts (id, exam_id, student_id, attempt_number, status, submitted_at,
  score, score_percentage, is_passed, graded_by, graded_at, is_result_published)
SELECT gen_random_uuid(), :'test_exam_a'::uuid, :'test_student_a'::uuid, n, 'graded', now(),
  1, 50, false, :'test_admin_a'::uuid, now(), true
FROM generate_series(1, 5) AS n;

INSERT INTO public.answers (attempt_id, question_id, is_correct, awarded_points, is_teacher_approved)
SELECT ea.id, :'test_q_a1'::uuid, true, 1, true
FROM public.exam_attempts ea
WHERE ea.exam_id = :'test_exam_a'::uuid AND ea.student_id = :'test_student_a'::uuid
UNION ALL
SELECT ea.id, :'test_q_a2'::uuid, false, 0, true
FROM public.exam_attempts ea
WHERE ea.exam_id = :'test_exam_a'::uuid AND ea.student_id = :'test_student_a'::uuid;
COMMIT;

\echo 'RLS isolation as institution A'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', :'test_admin_a', 'role', 'authenticated',
  'raw_app_meta_data', json_build_object('role', 'school_admin'))::text, true);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.institutions WHERE id IN ('10000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000002'::uuid)) <> 1 THEN
    RAISE EXCEPTION 'phase1_rls_institution_leak';
  END IF;
  IF (SELECT count(*) FROM public.subjects WHERE id IN ('10000000-0000-0000-0000-000000000301'::uuid, '10000000-0000-0000-0000-000000000302'::uuid)) <> 1 THEN
    RAISE EXCEPTION 'phase1_rls_subject_leak';
  END IF;
  IF (SELECT count(*) FROM public.learning_outcomes WHERE id IN ('10000000-0000-0000-0000-000000000501'::uuid, '10000000-0000-0000-0000-000000000502'::uuid)) <> 1 THEN
    RAISE EXCEPTION 'phase1_rls_outcome_leak';
  END IF;
END $$;

DO $$
DECLARE
  report jsonb;
BEGIN
  report := public.get_student_learning_outcome_report(
    '10000000-0000-0000-0000-000000000601'::uuid,
    '10000000-0000-0000-0000-000000000701'::uuid
  );
  IF (report->>'eligible_attempt_count')::integer <> 5 THEN RAISE EXCEPTION 'phase1_report_attempt_count'; END IF;
  IF jsonb_array_length(report->'questions') <> 2 THEN RAISE EXCEPTION 'phase1_report_question_coverage'; END IF;
  IF jsonb_array_length(report->'mastery') <> 2 THEN RAISE EXCEPTION 'phase1_report_mastery'; END IF;
  IF (report->'mastery'->0->>'classification') <> 'developing' THEN RAISE EXCEPTION 'phase1_report_classification'; END IF;
  IF (report->'mastery'->1->>'classification') <> 'needs_review' THEN RAISE EXCEPTION 'phase1_report_multi_outcome_classification'; END IF;
  IF (report->'institution'->>'name') <> 'مؤسسة اختبار ألف' THEN RAISE EXCEPTION 'phase1_report_institution'; END IF;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM public.get_student_learning_outcome_report(
      '10000000-0000-0000-0000-000000000601'::uuid,
      '10000000-0000-0000-0000-000000000702'::uuid
    );
    RAISE EXCEPTION 'phase1_cross_tenant_report_was_allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'student_report_student_not_found' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE
  preview_a jsonb;
  preview_b jsonb;
  shortage jsonb;
BEGIN
  preview_a := public.preview_exam_blueprint(jsonb_build_object(
    'subject_id', '10000000-0000-0000-0000-000000000301', 'total_questions', 2,
    'seed', 'phase1-seed', 'buckets', jsonb_build_array(jsonb_build_object('count', 2, 'unit', 'الوحدة الثانية'))
  ));
  preview_b := public.preview_exam_blueprint(jsonb_build_object(
    'subject_id', '10000000-0000-0000-0000-000000000301', 'total_questions', 2,
    'seed', 'phase1-seed', 'buckets', jsonb_build_array(jsonb_build_object('count', 2, 'unit', 'الوحدة الثانية'))
  ));
  IF preview_a <> preview_b OR (preview_a->>'complete')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'phase1_blueprint_not_deterministic'; END IF;
  shortage := public.preview_exam_blueprint(jsonb_build_object(
    'subject_id', '10000000-0000-0000-0000-000000000301', 'total_questions', 3,
    'seed', 'phase1-shortage', 'buckets', jsonb_build_array(jsonb_build_object('count', 3, 'unit', 'وحدة غير موجودة'))
  ));
  IF (shortage->>'complete')::boolean IS NOT FALSE OR jsonb_array_length(shortage->'shortages') <> 1 THEN RAISE EXCEPTION 'phase1_blueprint_shortage_missing'; END IF;
END $$;

SELECT public.create_exam_from_blueprint(jsonb_build_object(
  'request_id', :'test_request'::uuid, 'subject_id', :'test_subject_a'::uuid,
  'title', 'Blueprint Phase 1', 'total_questions', 2, 'total_points', 20,
  'passing_score', 10, 'duration_minutes', 30, 'max_attempts', 1,
  'seed', 'phase1-create', 'buckets', jsonb_build_array(jsonb_build_object('count', 2, 'unit', 'الوحدة الثانية'))
)) AS blueprint_first \gset

SELECT public.create_exam_from_blueprint(jsonb_build_object(
  'request_id', :'test_request'::uuid, 'subject_id', :'test_subject_a'::uuid,
  'title', 'Blueprint Phase 1', 'total_questions', 2, 'total_points', 20,
  'passing_score', 10, 'duration_minutes', 30, 'max_attempts', 1,
  'seed', 'phase1-create', 'buckets', jsonb_build_array(jsonb_build_object('count', 2, 'unit', 'الوحدة الثانية'))
))->>'exam_id' AS replayed_exam_id \gset

SELECT (:'replayed_exam_id' = (:'blueprint_first'::jsonb->>'exam_id')) AS replay_match \gset
\if :replay_match
\echo 'Blueprint replay returned the original exam'
\else
\quit 1
\endif

DO $$
BEGIN
  BEGIN
    PERFORM public.create_exam_from_blueprint(jsonb_build_object(
      'request_id', '10000000-0000-0000-0000-000000000801'::uuid,
      'subject_id', '10000000-0000-0000-0000-000000000301'::uuid,
      'title', 'Changed title', 'total_questions', 2,
      'seed', 'phase1-create', 'buckets', jsonb_build_array(jsonb_build_object('count', 2, 'unit', 'الوحدة الثانية'))
    ));
    RAISE EXCEPTION 'phase1_blueprint_conflict_was_allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'exam_blueprint_idempotency_conflict' THEN RAISE; END IF;
  END;
END $$;

COMMIT;

\echo 'Cleanup fixture'
DELETE FROM public.institutions WHERE id IN (:'test_inst_a'::uuid, :'test_inst_b'::uuid);
DELETE FROM auth.users WHERE id IN (
  :'test_admin_a'::uuid, :'test_admin_b'::uuid,
  :'test_student_a_user'::uuid, :'test_student_b_user'::uuid,
  :'test_student_a2_user'::uuid, :'test_student_a3_user'::uuid, :'test_student_a4_user'::uuid
);
\echo 'PHASE1_LOCAL_FIXTURE_PASS'
