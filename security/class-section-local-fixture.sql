\set ON_ERROR_STOP on
\set inst_a '91000000-0000-0000-0000-000000000001'
\set inst_b '91000000-0000-0000-0000-000000000002'
\set admin_a '91000000-0000-0000-0000-000000000101'
\set admin_b '91000000-0000-0000-0000-000000000102'
\set student_a1_user '91000000-0000-0000-0000-000000000201'
\set student_a2_user '91000000-0000-0000-0000-000000000202'
\set student_b1_user '91000000-0000-0000-0000-000000000203'
\set teacher_a_user '91000000-0000-0000-0000-000000000301'
\set student_a1 '91000000-0000-0000-0000-000000000401'
\set student_a2 '91000000-0000-0000-0000-000000000402'
\set student_b1 '91000000-0000-0000-0000-000000000403'
\set teacher_a '91000000-0000-0000-0000-000000000501'
\set year_a '91000000-0000-0000-0000-000000000601'
\set year_b '91000000-0000-0000-0000-000000000602'
\set grade_a '91000000-0000-0000-0000-000000000701'
\set grade_b '91000000-0000-0000-0000-000000000702'
\set branch_a '91000000-0000-0000-0000-000000000801'
\set branch_b '91000000-0000-0000-0000-000000000802'
\set class_a '91000000-0000-0000-0000-000000000901'
\set class_b '91000000-0000-0000-0000-000000000902'
\set section_a1 '91000000-0000-0000-0000-000000001001'
\set section_a2 '91000000-0000-0000-0000-000000001002'
\set section_b1 '91000000-0000-0000-0000-000000001003'
\set subject_a '91000000-0000-0000-0000-000000001101'
\set exam_class '91000000-0000-0000-0000-000000001201'
\set exam_section '91000000-0000-0000-0000-000000001202'
\set exam_b '91000000-0000-0000-0000-000000001203'

DELETE FROM public.institutions WHERE id IN (:'inst_a'::uuid, :'inst_b'::uuid);
DELETE FROM auth.users WHERE id IN (:'admin_a'::uuid, :'admin_b'::uuid, :'student_a1_user'::uuid, :'student_a2_user'::uuid, :'student_b1_user'::uuid, :'teacher_a_user'::uuid);

INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at, is_super_admin, is_anonymous)
VALUES
  (:'admin_a'::uuid, 'authenticated', 'authenticated', 'section-admin-a@example.test', '{"role":"school_admin"}', '{}', now(), now(), now(), false, false),
  (:'admin_b'::uuid, 'authenticated', 'authenticated', 'section-admin-b@example.test', '{"role":"school_admin"}', '{}', now(), now(), now(), false, false),
  (:'student_a1_user'::uuid, 'authenticated', 'authenticated', 'section-student-a1@example.test', '{"role":"student"}', '{}', now(), now(), now(), false, false),
  (:'student_a2_user'::uuid, 'authenticated', 'authenticated', 'section-student-a2@example.test', '{"role":"student"}', '{}', now(), now(), now(), false, false),
  (:'student_b1_user'::uuid, 'authenticated', 'authenticated', 'section-student-b1@example.test', '{"role":"student"}', '{}', now(), now(), now(), false, false),
  (:'teacher_a_user'::uuid, 'authenticated', 'authenticated', 'section-teacher-a@example.test', '{"role":"teacher"}', '{}', now(), now(), now(), false, false);

INSERT INTO public.institutions (id, name, name_en, created_by)
VALUES
  (:'inst_a'::uuid, 'Section Institution A', 'Section Institution A', :'admin_a'::uuid),
  (:'inst_b'::uuid, 'Section Institution B', 'Section Institution B', :'admin_b'::uuid);

INSERT INTO public.staff_profiles (id, user_id, institution_id, full_name, role, is_active)
VALUES
  (:'admin_a'::uuid, :'admin_a'::uuid, :'inst_a'::uuid, 'Admin A', 'school_admin', true),
  (:'admin_b'::uuid, :'admin_b'::uuid, :'inst_b'::uuid, 'Admin B', 'school_admin', true),
  (:'teacher_a'::uuid, :'teacher_a_user'::uuid, :'inst_a'::uuid, 'Teacher A', 'teacher', true);

INSERT INTO public.academic_years (id, institution_id, name, start_date, end_date, is_current, is_active)
VALUES
  (:'year_a'::uuid, :'inst_a'::uuid, '2026-2027', '2026-09-01', '2027-06-30', true, true),
  (:'year_b'::uuid, :'inst_b'::uuid, '2026-2027', '2026-09-01', '2027-06-30', true, true);

INSERT INTO public.grade_levels (id, institution_id, name, sort_order, is_active)
VALUES
  (:'grade_a'::uuid, :'inst_a'::uuid, 'Grade A', 1, true),
  (:'grade_b'::uuid, :'inst_b'::uuid, 'Grade B', 1, true);

INSERT INTO public.branches (id, institution_id, name, is_active)
VALUES
  (:'branch_a'::uuid, :'inst_a'::uuid, 'Branch A', true),
  (:'branch_b'::uuid, :'inst_b'::uuid, 'Branch B', true);

INSERT INTO public.classes (id, institution_id, branch_id, grade_level_id, name, academic_year, academic_year_id, is_active)
VALUES
  (:'class_a'::uuid, :'inst_a'::uuid, :'branch_a'::uuid, :'grade_a'::uuid, 'Class A', '2026-2027', :'year_a'::uuid, true),
  (:'class_b'::uuid, :'inst_b'::uuid, :'branch_b'::uuid, :'grade_b'::uuid, 'Class B', '2026-2027', :'year_b'::uuid, true);

INSERT INTO public.sections (id, institution_id, class_id, academic_year_id, grade_level_id, branch_id, code, name, capacity, is_active)
VALUES
  (:'section_a1'::uuid, :'inst_a'::uuid, :'class_a'::uuid, :'year_a'::uuid, :'grade_a'::uuid, :'branch_a'::uuid, 'A1', 'Section A1', 30, true),
  (:'section_a2'::uuid, :'inst_a'::uuid, :'class_a'::uuid, :'year_a'::uuid, :'grade_a'::uuid, :'branch_a'::uuid, 'A2', 'Section A2', 30, true),
  (:'section_b1'::uuid, :'inst_b'::uuid, :'class_b'::uuid, :'year_b'::uuid, :'grade_b'::uuid, :'branch_b'::uuid, 'B1', 'Section B1', 30, true);

INSERT INTO public.student_profiles (id, user_id, institution_id, student_code, full_name, grade_level_id, is_active)
VALUES
  (:'student_a1'::uuid, :'student_a1_user'::uuid, :'inst_a'::uuid, 'SA1', 'Student A1', :'grade_a'::uuid, true),
  (:'student_a2'::uuid, :'student_a2_user'::uuid, :'inst_a'::uuid, 'SA2', 'Student A2', :'grade_a'::uuid, true),
  (:'student_b1'::uuid, :'student_b1_user'::uuid, :'inst_b'::uuid, 'SB1', 'Student B1', :'grade_b'::uuid, true);

INSERT INTO public.class_students (institution_id, class_id, section_id, student_id, academic_year_id, grade_level_id, status, seat_number)
VALUES
  (:'inst_a'::uuid, :'class_a'::uuid, :'section_a1'::uuid, :'student_a1'::uuid, :'year_a'::uuid, :'grade_a'::uuid, 'active', 'SA1'),
  (:'inst_a'::uuid, :'class_a'::uuid, :'section_a2'::uuid, :'student_a2'::uuid, :'year_a'::uuid, :'grade_a'::uuid, 'active', 'SA2'),
  (:'inst_b'::uuid, :'class_b'::uuid, :'section_b1'::uuid, :'student_b1'::uuid, :'year_b'::uuid, :'grade_b'::uuid, 'active', 'SB1');

INSERT INTO public.subjects (id, institution_id, name, code, is_active)
VALUES (:'subject_a'::uuid, :'inst_a'::uuid, 'Subject A', 'SUB-A', true);

INSERT INTO public.subject_teachers (institution_id, subject_id, class_id, teacher_id, academic_year_id, grade_level_id, is_active)
VALUES (:'inst_a'::uuid, :'subject_a'::uuid, :'class_a'::uuid, :'teacher_a'::uuid, :'year_a'::uuid, :'grade_a'::uuid, true);

INSERT INTO public.examify_exams (id, institution_id, subject_id, class_id, teacher_id, title, total_points, passing_score, duration_minutes, status)
VALUES
  (:'exam_class'::uuid, :'inst_a'::uuid, :'subject_a'::uuid, :'class_a'::uuid, :'teacher_a'::uuid, 'Class Exam A', 10, 5, 30, 'published'),
  (:'exam_section'::uuid, :'inst_a'::uuid, :'subject_a'::uuid, :'class_a'::uuid, :'teacher_a'::uuid, 'Section Exam A1', 10, 5, 30, 'published'),
  (:'exam_b'::uuid, :'inst_b'::uuid, NULL, :'class_b'::uuid, NULL, 'Class Exam B', 10, 5, 30, 'published');

INSERT INTO public.exam_assignments (exam_id, class_id, section_id)
VALUES
  (:'exam_class'::uuid, :'class_a'::uuid, NULL),
  (:'exam_section'::uuid, :'class_a'::uuid, :'section_a1'::uuid),
  (:'exam_b'::uuid, :'class_b'::uuid, NULL);

-- Administrative tenant isolation and duplicate prevention.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'admin_a', 'role', 'authenticated', 'raw_app_meta_data', json_build_object('role', 'school_admin'))::text, true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.sections WHERE id IN ('91000000-0000-0000-0000-000000001001'::uuid, '91000000-0000-0000-0000-000000001002'::uuid, '91000000-0000-0000-0000-000000001003'::uuid)) <> 2 THEN RAISE EXCEPTION 'section_tenant_leak'; END IF;
  BEGIN
    INSERT INTO public.sections (institution_id, class_id, name, is_active) VALUES ('91000000-0000-0000-0000-000000000001'::uuid, '91000000-0000-0000-0000-000000000901'::uuid, 'Section A1', true);
    RAISE EXCEPTION 'section_duplicate_was_allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
COMMIT;

-- Student A1 sees the class exam and the exact section exam only.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'student_a1_user', 'role', 'authenticated', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', :'student_a1_user', 'role', 'authenticated', 'session_id', 'class-section-a1-session', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT public.claim_student_session('class-section-a1-device', 'fixture');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.class_students WHERE student_id = '91000000-0000-0000-0000-000000000401'::uuid AND section_id = '91000000-0000-0000-0000-000000001001'::uuid) <> 1 THEN RAISE EXCEPTION 'student_a1_section_missing'; END IF;
  IF (SELECT count(*) FROM public.examify_exams WHERE id IN ('91000000-0000-0000-0000-000000001201'::uuid, '91000000-0000-0000-0000-000000001202'::uuid)) <> 2 THEN RAISE EXCEPTION 'student_a1_exam_visibility'; END IF;
END $$;
COMMIT;

-- Student A2 is in the same class but a different section.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'student_a2_user', 'role', 'authenticated', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', :'student_a2_user', 'role', 'authenticated', 'session_id', 'class-section-a2-session', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT public.claim_student_session('class-section-a2-device', 'fixture');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.examify_exams WHERE id = '91000000-0000-0000-0000-000000001201'::uuid) <> 1 THEN RAISE EXCEPTION 'student_a2_class_exam_missing'; END IF;
  IF (SELECT count(*) FROM public.examify_exams WHERE id = '91000000-0000-0000-0000-000000001202'::uuid) <> 0 THEN RAISE EXCEPTION 'student_a2_section_exam_leak'; END IF;
END $$;
COMMIT;

-- Student B1 cannot see institution A data, but sees its own class exam.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'student_b1_user', 'role', 'authenticated', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', :'student_b1_user', 'role', 'authenticated', 'session_id', 'class-section-b1-session', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT public.claim_student_session('class-section-b1-device', 'fixture');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.sections WHERE institution_id = '91000000-0000-0000-0000-000000000001'::uuid) <> 0 THEN RAISE EXCEPTION 'institution_a_visible_to_b'; END IF;
  IF (SELECT count(*) FROM public.examify_exams WHERE id = '91000000-0000-0000-0000-000000001203'::uuid) <> 1 THEN RAISE EXCEPTION 'student_b1_exam_missing'; END IF;
  IF (SELECT count(*) FROM public.examify_exams WHERE id IN ('91000000-0000-0000-0000-000000001201'::uuid, '91000000-0000-0000-0000-000000001202'::uuid)) <> 0 THEN RAISE EXCEPTION 'institution_a_exam_visible_to_b'; END IF;
END $$;
COMMIT;

-- The assigned teacher can see both published exams for the assigned class.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'teacher_a_user', 'role', 'authenticated', 'raw_app_meta_data', json_build_object('role', 'teacher'))::text, true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.examify_exams WHERE id IN ('91000000-0000-0000-0000-000000001201'::uuid, '91000000-0000-0000-0000-000000001202'::uuid)) <> 2 THEN RAISE EXCEPTION 'teacher_exam_visibility'; END IF;
END $$;
COMMIT;

RESET ROLE;
DELETE FROM public.institutions WHERE id IN (:'inst_a'::uuid, :'inst_b'::uuid);
DELETE FROM auth.users WHERE id IN (:'admin_a'::uuid, :'admin_b'::uuid, :'student_a1_user'::uuid, :'student_a2_user'::uuid, :'student_b1_user'::uuid, :'teacher_a_user'::uuid);

\echo 'CLASS_SECTION_FIXTURE_PASS'
