\set ON_ERROR_STOP on
\set inst '92000000-0000-0000-0000-000000000001'
\set user_id '92000000-0000-0000-0000-000000000101'
\set student_id '92000000-0000-0000-0000-000000000201'
\set exam_id '92000000-0000-0000-0000-000000000301'
\set attempt_id '92000000-0000-0000-0000-000000000401'

DELETE FROM public.institutions WHERE id = :'inst'::uuid;
DELETE FROM auth.users WHERE id = :'user_id'::uuid;

INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at, is_super_admin, is_anonymous)
VALUES (:'user_id'::uuid, 'authenticated', 'authenticated', 'session-guard@example.test', '{"role":"student"}', '{}', now(), now(), now(), false, false);
INSERT INTO public.institutions (id, name, name_en, created_by)
VALUES (:'inst'::uuid, 'Session Guard Institution', 'Session Guard Institution', :'user_id'::uuid);
INSERT INTO public.student_profiles (id, user_id, institution_id, full_name, is_active)
VALUES (:'student_id'::uuid, :'user_id'::uuid, :'inst'::uuid, 'Session Guard Student', true);
INSERT INTO public.examify_exams (id, institution_id, title, status, duration_minutes)
VALUES (:'exam_id'::uuid, :'inst'::uuid, 'Session Guard Exam', 'published', 30);
INSERT INTO public.exam_assignments (exam_id, student_id)
VALUES (:'exam_id'::uuid, :'student_id'::uuid);

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_id', 'role', 'authenticated', 'session_id', 'session-a-12345', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT public.claim_student_session('device-a', 'fixture');
INSERT INTO public.exam_attempts (id, exam_id, student_id, status)
VALUES (:'attempt_id'::uuid, :'exam_id'::uuid, :'student_id'::uuid, 'in_progress');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.student_sessions WHERE user_id = '92000000-0000-0000-0000-000000000101'::uuid AND revoked_at IS NULL) <> 1 THEN RAISE EXCEPTION 'first_session_not_claimed'; END IF;
  IF NOT public.student_session_is_current() THEN RAISE EXCEPTION 'first_session_not_current'; END IF;
END $$;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_id', 'role', 'authenticated', 'session_id', 'session-b-12345', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT public.claim_student_session('device-b', 'fixture');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.student_sessions WHERE user_id = '92000000-0000-0000-0000-000000000101'::uuid AND revoked_at IS NULL) <> 1 THEN RAISE EXCEPTION 'old_session_not_revoked'; END IF;
  IF (SELECT count(*) FROM public.student_sessions WHERE user_id = '92000000-0000-0000-0000-000000000101'::uuid AND auth_session_id = 'session-a-12345' AND revoked_at IS NOT NULL) <> 1 THEN RAISE EXCEPTION 'old_session_still_active'; END IF;
  IF public.student_session_is_current() IS NOT TRUE THEN RAISE EXCEPTION 'second_session_not_current'; END IF;
END $$;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_id', 'role', 'authenticated', 'session_id', 'session-a-12345', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
DO $$
BEGIN
  IF public.student_session_is_current() IS NOT FALSE THEN RAISE EXCEPTION 'revoked_session_still_current'; END IF;
  IF (SELECT count(*) FROM public.examify_exams) <> 0 THEN RAISE EXCEPTION 'revoked_session_can_read_exam'; END IF;
END $$;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_id', 'role', 'authenticated', 'session_id', 'session-b-12345', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT public.claim_student_exam_device(:'attempt_id'::uuid, 'device-b', 'fixture');
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'user_id', 'role', 'authenticated', 'session_id', 'session-c-12345', 'raw_app_meta_data', json_build_object('role', 'student'))::text, true);
SELECT public.claim_student_session('device-c', 'fixture');
DO $$
BEGIN
  IF public.touch_student_session('device-c') IS NOT TRUE THEN RAISE EXCEPTION 'current_session_touch_failed'; END IF;
END $$;
SELECT public.claim_student_exam_device(:'attempt_id'::uuid, 'device-c', 'fixture') AS second_device_result;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.student_exam_device_conflicts WHERE attempt_id = '92000000-0000-0000-0000-000000000401'::uuid) <> 1 THEN RAISE EXCEPTION 'device_conflict_not_logged'; END IF;
END $$;
COMMIT;

RESET ROLE;
DELETE FROM public.institutions WHERE id = :'inst'::uuid;
DELETE FROM auth.users WHERE id = :'user_id'::uuid;
\echo 'STUDENT_SESSION_FIXTURE_PASS'
