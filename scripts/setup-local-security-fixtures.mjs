import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const ids = {
  institutionA: '10000000-0000-4000-8000-000000000001',
  institutionB: '10000000-0000-4000-8000-000000000002',
  studentA: '20000000-0000-4000-8000-000000000001',
  studentB: '20000000-0000-4000-8000-000000000002',
  staffA: '21000000-0000-4000-8000-000000000001',
  adminA: '21000000-0000-4000-8000-000000000002',
  adminB: '21000000-0000-4000-8000-000000000003',
  superAdmin: '21000000-0000-4000-8000-000000000004',
  parentA: '22000000-0000-4000-8000-000000000001',
  subjectA: '23000000-0000-4000-8000-000000000001',
  classA: '24000000-0000-4000-8000-000000000001',
  sectionA: '25000000-0000-4000-8000-000000000001',
  examA: '31000000-0000-4000-8000-000000000001',
  examB: '30000000-0000-4000-8000-000000000002',
  questionA: '32000000-0000-4000-8000-000000000001',
  optionA: '33000000-0000-4000-8000-000000000001',
  optionB: '33000000-0000-4000-8000-000000000002',
  attemptActive: '34000000-0000-4000-8000-000000000001',
  attemptSubmitted: '34000000-0000-4000-8000-000000000002',
  attemptGraded: '34000000-0000-4000-8000-000000000003',
  attemptRecovery: '34000000-0000-4000-8000-000000000004',
  omrResult: '35000000-0000-4000-8000-000000000001',
  omrAnswer: '36000000-0000-4000-8000-000000000001',
  recoveryToken: '37000000-0000-4000-8000-000000000001',
  certificateB: '40000000-0000-4000-8000-000000000002',
};
const password = 'LocalSecurityFixture-2026!Aa';
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], ...options });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let statusRaw;
let statusError;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    statusRaw = run('cmd.exe', ['/c', '.\\node_modules\\.bin\\supabase.cmd', 'status', '-o', 'json']);
    statusError = null;
    break;
  } catch (error) {
    statusError = error;
    await wait(500);
  }
}
if (!statusRaw) throw new Error(`LOCAL SERVICES NOT READY: supabase status failed after 30 seconds (${statusError?.message ?? 'unknown error'}).`);
const status = JSON.parse(statusRaw);
const supabaseUrl = status.API_URL;
const anonKey = status.ANON_KEY;
const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.service_role_key;
if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Local Supabase status is missing API_URL, ANON_KEY, or SERVICE_ROLE_KEY.');
console.log('DATABASE_READY (supabase status succeeded)');
console.log('REST_API_READY (local API URL discovered)');
const storageProbeUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/bucket/tutor_attachments`;
const storageTimeoutMs = 30000;
const storageStartedAt = Date.now();
let storageAttempts = 0;
let storageReady = false;
let storageLastStatus = 'no response';
let storageLastError = 'none';
while (Date.now() - storageStartedAt < storageTimeoutMs) {
  storageAttempts += 1;
  try {
    const response = await fetch(storageProbeUrl, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(2000),
    });
    storageLastStatus = `HTTP ${response.status}`;
    storageLastError = 'none';
    if (![502, 503, 504].includes(response.status)) {
      storageReady = true;
      break;
    }
  } catch (error) {
    storageLastStatus = 'no HTTP response';
    storageLastError = error instanceof Error ? error.message : String(error);
  }
  await wait(Math.min(2000, 250 * 2 ** Math.min(storageAttempts - 1, 3)));
}
if (!storageReady) {
  throw new Error(`STORAGE READINESS FAILED\nlast status: ${storageLastStatus}\nlast error: ${storageLastError}\nattempts: ${storageAttempts}\nelapsed: ${Date.now() - storageStartedAt}ms\nendpoint: ${storageProbeUrl}`);
}
console.log(`STORAGE_READY (${storageLastStatus}; attempts=${storageAttempts})`);

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const withTimeout = (promise, label, ms = 7000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
]);
const authHealthUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`;
let authReady = false;
let readinessDetail = 'no response';
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch(authHealthUrl, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(2000) });
    readinessDetail = `health HTTP ${response.status}`;
    if (response.ok) { authReady = true; break; }
  } catch (error) { readinessDetail = error instanceof Error ? error.message : String(error); }
  await wait(500);
}
if (!authReady) throw new Error(`AUTH SERVICE NOT READY: ${authHealthUrl} did not return a healthy response within 30 seconds (${readinessDetail}).`);
let listedUsers;
let listError;
for (let attempt = 0; attempt < 12; attempt += 1) {
  try {
    const listed = await withTimeout(admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'Auth admin listUsers');
    listedUsers = listed.data;
    listError = listed.error;
    if (!listError) break;
  } catch (error) { listError = error; }
  await wait(500);
}
if (listError || !listedUsers) throw new Error(`AUTH READY BUT FIXTURE CREATION FAILED: ${listError?.message ?? JSON.stringify(listError)}`);
const existingUsers = new Map(listedUsers.users.map((user) => [user.email, user]));
const users = {};
for (const [label, email] of Object.entries({
  studentA: 'security-student-a@local.examify.test',
  studentB: 'security-student-b@local.examify.test',
  teacherA: 'security-teacher-a@local.examify.test',
  adminA: 'security-admin-a@local.examify.test',
  adminB: 'security-admin-b@local.examify.test',
  superAdmin: 'security-super-admin@local.examify.test',
  parentA: 'security-parent-a@local.examify.test',
})) {
  const existingUser = existingUsers.get(email);
  let data;
  let error;
  if (existingUser) {
    ({ data, error } = await withTimeout(admin.auth.admin.updateUserById(existingUser.id, { password, email_confirm: true }), `Auth update ${label}`));
  } else {
    ({ data, error } = await withTimeout(admin.auth.admin.createUser({ email, password, email_confirm: true }), `Auth create ${label}`));
  }
  if (error || !data.user) throw new Error(`Cannot create ${label}: ${error?.message ?? 'unknown error'}`);
  users[label] = { id: data.user.id, email };
}

const fixtureSql = `
DELETE FROM public.cart_items WHERE user_id IN (${sql(users.studentA.id)}::uuid, ${sql(users.studentB.id)}::uuid);
DELETE FROM public.marketplace_entitlements WHERE product_id LIKE 'phase91-%';
DELETE FROM public.marketplace_orders o USING public.marketplace_order_items i
WHERE i.order_id = o.id AND i.product_id LIKE 'phase91-%';
DELETE FROM public.marketplace_order_items WHERE product_id LIKE 'phase91-%';
DELETE FROM public.marketplace_products WHERE id LIKE 'phase91-%';
DELETE FROM public.audit_log WHERE institution_id IN (${sql(ids.institutionA)}::uuid, ${sql(ids.institutionB)}::uuid);
DELETE FROM public.user_notifications WHERE institution_id IN (${sql(ids.institutionA)}::uuid, ${sql(ids.institutionB)}::uuid);
DELETE FROM public.parent_notifications WHERE institution_id IN (${sql(ids.institutionA)}::uuid, ${sql(ids.institutionB)}::uuid);
DELETE FROM public.notifications WHERE institution_id IN (${sql(ids.institutionA)}::uuid, ${sql(ids.institutionB)}::uuid);
DELETE FROM public.certificates WHERE achievement_exam_id = ${sql(ids.examA)}::uuid AND student_id = ${sql(ids.studentA)}::uuid;
DELETE FROM public.certificates WHERE recipient = 'Security Student A' OR program = 'Security Test';
DELETE FROM public.certificates WHERE id = ${sql(ids.certificateB)}::uuid;
DELETE FROM public.omr_answers WHERE id = ${sql(ids.omrAnswer)}::uuid;
DELETE FROM public.omr_results WHERE id = ${sql(ids.omrResult)}::uuid;
DELETE FROM public.answers WHERE id = ${sql(ids.omrAnswer)}::uuid;
DELETE FROM public.exam_attempts WHERE id IN (${sql(ids.attemptActive)}::uuid, ${sql(ids.attemptSubmitted)}::uuid, ${sql(ids.attemptGraded)}::uuid, ${sql(ids.attemptRecovery)}::uuid);
DELETE FROM public.exam_assignments WHERE exam_id = ${sql(ids.examA)}::uuid AND student_id = ${sql(ids.studentA)}::uuid;
DELETE FROM public.exam_questions WHERE exam_id = ${sql(ids.examA)}::uuid;
DELETE FROM public.question_options WHERE question_id = ${sql(ids.questionA)}::uuid;
DELETE FROM public.questions WHERE id = ${sql(ids.questionA)}::uuid;
DELETE FROM public.subject_teachers WHERE teacher_id = ${sql(ids.staffA)}::uuid AND subject_id = ${sql(ids.subjectA)}::uuid;
DELETE FROM public.class_students WHERE class_id = ${sql(ids.classA)}::uuid AND student_id = ${sql(ids.studentA)}::uuid;
DELETE FROM public.sections WHERE id = ${sql(ids.sectionA)}::uuid;
DELETE FROM public.classes WHERE id = ${sql(ids.classA)}::uuid;
DELETE FROM public.subjects WHERE id = ${sql(ids.subjectA)}::uuid;
DELETE FROM public.parent_student_links WHERE parent_id = ${sql(ids.parentA)}::uuid AND student_id = ${sql(ids.studentA)}::uuid;
DELETE FROM public.parent_profiles WHERE id = ${sql(ids.parentA)}::uuid;
DELETE FROM public.staff_profiles WHERE id = ${sql(ids.staffA)}::uuid;
DELETE FROM public.staff_profiles WHERE id IN (${sql(ids.adminA)}::uuid, ${sql(ids.adminB)}::uuid, ${sql(ids.superAdmin)}::uuid);
DELETE FROM public.student_profiles WHERE id IN (${sql(ids.studentA)}::uuid, ${sql(ids.studentB)}::uuid);
DELETE FROM public.examify_exams WHERE id IN (${sql(ids.examA)}::uuid, ${sql(ids.examB)}::uuid);
DELETE FROM public.institutions WHERE id IN (${sql(ids.institutionA)}::uuid, ${sql(ids.institutionB)}::uuid);
INSERT INTO public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
VALUES (${sql(ids.institutionA)}::uuid, 'Local Security Tenant A', 'enterprise', 'active', 100, 20, 20, true),
       (${sql(ids.institutionB)}::uuid, 'Local Security Tenant B', 'enterprise', 'active', 100, 20, 20, true);
INSERT INTO public.student_profiles (id, user_id, institution_id, student_code, full_name, is_active, status)
VALUES (${sql(ids.studentA)}::uuid, ${sql(users.studentA.id)}::uuid, ${sql(ids.institutionA)}::uuid, 'SEC-A', 'Security Student A', true, 'active'),
       (${sql(ids.studentB)}::uuid, ${sql(users.studentB.id)}::uuid, ${sql(ids.institutionB)}::uuid, 'SEC-B', 'Security Student B', true, 'active');
INSERT INTO public.staff_profiles (id, user_id, institution_id, full_name, role, is_active)
VALUES (${sql(ids.staffA)}::uuid, ${sql(users.teacherA.id)}::uuid, ${sql(ids.institutionA)}::uuid, 'Security Teacher A', 'teacher', true);
INSERT INTO public.staff_profiles (id, user_id, institution_id, full_name, role, is_active)
VALUES (${sql(ids.adminA)}::uuid, ${sql(users.adminA.id)}::uuid, ${sql(ids.institutionA)}::uuid, 'Security Admin A', 'school_admin', true),
       (${sql(ids.adminB)}::uuid, ${sql(users.adminB.id)}::uuid, ${sql(ids.institutionB)}::uuid, 'Security Admin B', 'school_admin', true);
INSERT INTO public.staff_profiles (id, user_id, institution_id, full_name, role, is_active)
VALUES (${sql(ids.superAdmin)}::uuid, ${sql(users.superAdmin.id)}::uuid, ${sql(ids.institutionA)}::uuid, 'Security Super Admin', 'super_admin', true);
INSERT INTO public.parent_profiles (id, user_id, institution_id, full_name, phone, is_active)
VALUES (${sql(ids.parentA)}::uuid, ${sql(users.parentA.id)}::uuid, ${sql(ids.institutionA)}::uuid, 'Security Parent A', '0500000000', true);
INSERT INTO public.parent_student_links (parent_id, student_id, relationship, can_view_grades, can_view_attendance, can_receive_alerts)
VALUES (${sql(ids.parentA)}::uuid, ${sql(ids.studentA)}::uuid, 'parent', true, true, true);
INSERT INTO public.subjects (id, institution_id, name, name_en, code, is_active)
VALUES (${sql(ids.subjectA)}::uuid, ${sql(ids.institutionA)}::uuid, 'Security Subject', 'Security Subject', 'SEC', true);
INSERT INTO public.classes (id, institution_id, name, academic_year, is_active)
VALUES (${sql(ids.classA)}::uuid, ${sql(ids.institutionA)}::uuid, 'Security Class', '2026-2027', true);
INSERT INTO public.sections (id, class_id, name, is_active)
VALUES (${sql(ids.sectionA)}::uuid, ${sql(ids.classA)}::uuid, 'A', true);
INSERT INTO public.class_students (class_id, section_id, student_id)
VALUES (${sql(ids.classA)}::uuid, ${sql(ids.sectionA)}::uuid, ${sql(ids.studentA)}::uuid);
INSERT INTO public.subject_teachers (subject_id, class_id, teacher_id, section_id, is_active)
VALUES (${sql(ids.subjectA)}::uuid, ${sql(ids.classA)}::uuid, ${sql(ids.staffA)}::uuid, ${sql(ids.sectionA)}::uuid, true);
INSERT INTO public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
VALUES (${sql(ids.questionA)}::uuid, ${sql(ids.institutionA)}::uuid, ${sql(ids.subjectA)}::uuid, 'multiple_choice', 'Security question', 'easy', 10, '{}'::jsonb);
INSERT INTO public.question_options (id, question_id, label, is_correct, sort_order)
VALUES (${sql(ids.optionA)}::uuid, ${sql(ids.questionA)}::uuid, 'A', true, 0), (${sql(ids.optionB)}::uuid, ${sql(ids.questionA)}::uuid, 'B', false, 1);
INSERT INTO public.examify_exams (id, institution_id, subject_id, class_id, teacher_id, title, total_points, passing_score, duration_minutes, max_attempts, status)
VALUES (${sql(ids.examA)}::uuid, ${sql(ids.institutionA)}::uuid, ${sql(ids.subjectA)}::uuid, ${sql(ids.classA)}::uuid, ${sql(ids.staffA)}::uuid, 'Tenant A Security Exam', 10, 50, 30, 10, 'published');
INSERT INTO public.exam_questions (exam_id, question_id, points, sort_order)
VALUES (${sql(ids.examA)}::uuid, ${sql(ids.questionA)}::uuid, 10, 0);
INSERT INTO public.exam_assignments (exam_id, student_id, section_id)
VALUES (${sql(ids.examA)}::uuid, ${sql(ids.studentA)}::uuid, ${sql(ids.sectionA)}::uuid);
INSERT INTO public.examify_exams (id, institution_id, title, total_points, passing_score, duration_minutes, max_attempts, status)
VALUES (${sql(ids.examB)}::uuid, ${sql(ids.institutionB)}::uuid, 'Tenant B Security Exam', 10, 50, 30, 1, 'published');
SET session_replication_role = replica;
INSERT INTO public.exam_attempts (id, exam_id, student_id, attempt_number, status, started_at, deadline_at, offline_recovery_token, is_result_published, score, score_percentage, is_passed)
VALUES
 (${sql(ids.attemptActive)}::uuid, ${sql(ids.examA)}::uuid, ${sql(ids.studentA)}::uuid, 6, 'in_progress', now() + interval '1 minute', now() + interval '31 minutes', gen_random_uuid(), false, NULL, NULL, NULL),
 (${sql(ids.attemptSubmitted)}::uuid, ${sql(ids.examA)}::uuid, ${sql(ids.studentA)}::uuid, 2, 'submitted', now() - interval '1 hour', now() - interval '30 minutes', NULL, false, 0, 0, NULL),
 (${sql(ids.attemptGraded)}::uuid, ${sql(ids.examA)}::uuid, ${sql(ids.studentA)}::uuid, 3, 'graded', now() - interval '2 hours', now() - interval '90 minutes', NULL, false, 10, 100, true),
 (${sql(ids.attemptRecovery)}::uuid, ${sql(ids.examA)}::uuid, ${sql(ids.studentA)}::uuid, 5, 'in_progress', now() - interval '1 hour', now() - interval '30 minutes', ${sql(ids.recoveryToken)}::uuid, false, NULL, NULL, NULL);
INSERT INTO public.answers (id, attempt_id, question_id, option_id, is_correct, awarded_points)
VALUES (${sql(ids.omrAnswer)}::uuid, ${sql(ids.attemptSubmitted)}::uuid, ${sql(ids.questionA)}::uuid, ${sql(ids.optionA)}::uuid, true, 10);
INSERT INTO public.omr_results (id, institution_id, exam_id, student_profile_id, status, score, total_questions, correct_count, wrong_count, empty_count, needs_review, review_reason, exam_attempt_id)
VALUES (${sql(ids.omrResult)}::uuid, ${sql(ids.institutionA)}::uuid, ${sql(ids.examA)}::uuid, ${sql(ids.studentA)}::uuid, 'needs_review', 0, 1, 0, 0, 1, true, 'fixture ambiguity', ${sql(ids.attemptSubmitted)}::uuid);
INSERT INTO public.omr_answers (id, omr_result_id, question_number, question_id, detected_answer, correct_answer, needs_manual_review, fill_ratios)
VALUES (${sql(ids.omrAnswer)}::uuid, ${sql(ids.omrResult)}::uuid, 1, ${sql(ids.questionA)}::uuid, NULL, 'A', true, '{}'::jsonb);
SET session_replication_role = origin;
INSERT INTO public.certificates (id, recipient, program, issuer, issued_date, credential_id, verified_method, score, institution_id, student_id, achievement_exam_id, status)
VALUES (${sql(ids.certificateB)}::uuid, 'Security Student B', 'Security Test', 'Local Fixture', current_date, 'LOCAL-SEC-B', 'RPC', 100, ${sql(ids.institutionB)}::uuid, ${sql(ids.studentB)}::uuid, ${sql(ids.examB)}::uuid, 'active');
`;
run('docker', ['exec', '-i', 'supabase_db_project', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: fixtureSql });

const { data: session, error: signInError } = await withTimeout(admin.auth.signInWithPassword({ email: users.studentA.email, password }), 'Student A sign-in');
if (signInError || !session.session?.access_token) throw new Error(`Cannot sign in fixture student A: ${signInError?.message ?? 'missing session'}`);
const signIn = async (user) => {
  const result = await withTimeout(admin.auth.signInWithPassword({ email: user.email, password }), `Sign-in ${user.email}`);
  if (result.error || !result.data.session?.access_token) throw new Error(`Cannot sign in fixture ${user.email}: ${result.error?.message ?? 'missing session'}`);
  return result.data.session.access_token;
};
for (const [label, user] of Object.entries(users)) {
  const token = await signIn(user);
  const verified = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: authUser, error: authError } = await verified.auth.getUser();
  if (authError || authUser.user?.id !== user.id) throw new Error(`HARNESS FAILED — ${label} session validation failed.`);
}
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/security-local-fixtures.json', JSON.stringify({
  SECURITY_TEST_SUPABASE_URL: supabaseUrl,
  SECURITY_TEST_SUPABASE_ANON_KEY: anonKey,
  SECURITY_TEST_USER_A_TOKEN: session.session.access_token,
  SECURITY_TEST_USER_B_TOKEN: await signIn(users.studentB),
  SECURITY_TEST_TEACHER_A_TOKEN: await signIn(users.teacherA),
  SECURITY_TEST_ADMIN_A_TOKEN: await signIn(users.adminA),
  SECURITY_TEST_ADMIN_B_TOKEN: await signIn(users.adminB),
  SECURITY_TEST_SUPER_ADMIN_TOKEN: await signIn(users.superAdmin),
  SECURITY_TEST_PARENT_A_TOKEN: await signIn(users.parentA),
  SECURITY_TEST_INSTITUTION_B_ID: ids.institutionB,
  SECURITY_TEST_STUDENT_B_ID: ids.studentB,
  SECURITY_TEST_STUDENT_A_ID: ids.studentA,
  SECURITY_TEST_EXAM_B_ID: ids.examB,
  SECURITY_TEST_CERTIFICATE_B_ID: ids.certificateB,
  SECURITY_TEST_EXAM_A_ID: ids.examA,
  SECURITY_TEST_ATTEMPT_ACTIVE_ID: ids.attemptActive,
  SECURITY_TEST_ATTEMPT_SUBMITTED_ID: ids.attemptSubmitted,
  SECURITY_TEST_ATTEMPT_GRADED_ID: ids.attemptGraded,
  SECURITY_TEST_ATTEMPT_RECOVERY_ID: ids.attemptRecovery,
  SECURITY_TEST_RECOVERY_TOKEN: ids.recoveryToken,
  SECURITY_TEST_ANSWER_ID: ids.omrAnswer,
  SECURITY_TEST_OMR_RESULT_ID: ids.omrResult,
}, null, 2));
console.log('Created isolated local security fixtures and wrote test-results/security-local-fixtures.json.');
