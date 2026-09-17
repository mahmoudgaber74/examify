import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync('test-results/security-local-fixtures.json', 'utf8'));
const status = JSON.parse(execFileSync('cmd.exe', ['/c', '.\\node_modules\\.bin\\supabase.cmd', 'status', '-o', 'json'], { encoding: 'utf8' }));
const url = fixture.SECURITY_TEST_SUPABASE_URL;
const anonKey = fixture.SECURITY_TEST_SUPABASE_ANON_KEY;
const admin = createClient(url, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const client = (token) => createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
const student = client(fixture.SECURITY_TEST_USER_A_TOKEN);
const teacher = client(fixture.SECURITY_TEST_TEACHER_A_TOKEN);
const parent = client(fixture.SECURITY_TEST_PARENT_A_TOKEN);
const other = client(fixture.SECURITY_TEST_USER_B_TOKEN);
const results = [];
const record = (name, pass, actual) => { results.push({ name, pass, actual }); console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${actual}`); };
const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_project', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }).trim();
const esc = (v) => `'${String(v).replaceAll("'", "''")}'`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const exam = fixture.SECURITY_TEST_EXAM_A_ID;
  const question = '32000000-0000-4000-8000-000000000001';
  const option = '33000000-0000-4000-8000-000000000001';
  const submission = fixture.SECURITY_TEST_ATTEMPT_ACTIVE_ID;
  const grading = fixture.SECURITY_TEST_ATTEMPT_SUBMITTED_ID;
  const publication = fixture.SECURITY_TEST_ATTEMPT_GRADED_ID;

  const teacherBAuth = await admin.auth.admin.createUser({ email: `teacher-b-${Date.now()}@local.examify.test`, password: 'LocalSecurityFixture-2026!Aa', email_confirm: true });
  if (teacherBAuth.error || !teacherBAuth.data.user) throw new Error(`HARNESS_ERROR: Tenant B teacher provisioning failed: ${teacherBAuth.error?.message}`);
  const teacherBId = teacherBAuth.data.user.id;
  const teacherBProfile = '21000000-0000-4000-8000-000000000002';
  const tenantBAttempt = '34000000-0000-4000-8000-000000000099';
  const tenantBSubject = '23000000-0000-4000-8000-000000000099';
  psql(`
    insert into public.subjects (id, institution_id, name, name_en, code, is_active)
    values (${esc(tenantBSubject)}::uuid, ${esc(fixture.SECURITY_TEST_INSTITUTION_B_ID)}::uuid, 'Tenant B Subject', 'Tenant B Subject', 'SEC-B', true)
    on conflict (id) do nothing;
    update public.examify_exams set subject_id = ${esc(tenantBSubject)}::uuid where id = ${esc(fixture.SECURITY_TEST_EXAM_B_ID)}::uuid;
    insert into public.staff_profiles (id, user_id, institution_id, full_name, role, is_active)
    values (${esc(teacherBProfile)}::uuid, ${esc(teacherBId)}::uuid, ${esc(fixture.SECURITY_TEST_INSTITUTION_B_ID)}::uuid, 'Security Admin B', 'school_admin', true);
    set session_replication_role = replica;
    insert into public.exam_attempts (id, exam_id, student_id, attempt_number, status, started_at, submitted_at, is_result_published, score, score_percentage, is_passed)
    values (${esc(tenantBAttempt)}::uuid, ${esc(fixture.SECURITY_TEST_EXAM_B_ID)}::uuid, ${esc(fixture.SECURITY_TEST_STUDENT_B_ID)}::uuid, 1, 'graded', now(), now(), false, 10, 100, true);
    set session_replication_role = origin;
  `);
  const teacherBSession = await admin.auth.signInWithPassword({ email: teacherBAuth.data.user.email, password: 'LocalSecurityFixture-2026!Aa' });
  if (teacherBSession.error || !teacherBSession.data.session?.access_token) throw new Error(`HARNESS_ERROR: Tenant B teacher session failed: ${teacherBSession.error?.message}`);
  const teacherB = client(teacherBSession.data.session.access_token);
  const eventsBefore = Number(psql(`select count(*) from public.result_publication_events where attempt_id = ${esc(tenantBAttempt)}::uuid;`));
  const parentNotificationsBefore = Number(psql(`select count(*) from public.parent_notifications where data->>'attempt_id' = ${esc(tenantBAttempt)};`));
  const deniedPublication = await teacher.rpc('publish_exam_result', { p_attempt_id: tenantBAttempt });
  const deniedState = psql(`select is_result_published::text || '|' || (select count(*) from public.result_publication_events where attempt_id = ${esc(tenantBAttempt)}::uuid) || '|' || (select count(*) from public.parent_notifications where data->>'attempt_id' = ${esc(tenantBAttempt)}) from public.exam_attempts where id = ${esc(tenantBAttempt)}::uuid;`);
  record('teacher A tenant B publication IDOR', Boolean(deniedPublication.error) && deniedState === 'false|0|0', `${deniedPublication.error?.message ?? 'unexpected success'}; ${deniedState}`);
  const allowedPublication = await teacherB.rpc('publish_exam_result', { p_attempt_id: tenantBAttempt });
  record('tenant B authorized publication sanity', !allowedPublication.error, allowedPublication.error?.message ?? 'success');

  const started = await student.rpc('start_exam_attempt', { p_exam_id: exam });
  const submissionCalls = await Promise.allSettled([
    student.rpc('submit_exam_attempt', { p_attempt_id: submission, p_answers: [{ question_id: question, option_id: option }], p_auto: false, p_time_remaining_seconds: 120 }),
    student.rpc('submit_exam_attempt', { p_attempt_id: submission, p_answers: [{ question_id: question, option_id: option }], p_auto: false, p_time_remaining_seconds: 120 }),
  ]);
  const submissionState = psql(`select status || '|' || count(*) over() from public.exam_attempts where id = ${esc(submission)}::uuid;`);
  const submissionAnswers = psql(`select count(*) from public.answers where attempt_id = ${esc(submission)}::uuid;`);
  record('submission concurrency', submissionCalls.every((r) => r.status === 'fulfilled') && submissionState.startsWith('graded|1') && submissionAnswers === '1', `${submissionState}, answers=${submissionAnswers}`);

  const gradingCalls = await Promise.allSettled([
    teacher.rpc('record_manual_exam_grade', { p_attempt_id: grading, p_score: 10 }),
    teacher.rpc('record_manual_exam_grade', { p_attempt_id: grading, p_score: 10 }),
  ]);
  const gradingState = psql(`select status || '|' || score::text from public.exam_attempts where id = ${esc(grading)}::uuid;`);
  record('grading concurrency', gradingCalls.every((r) => r.status === 'fulfilled') && gradingState === 'graded|10.00', gradingState);

  const publicationCalls = await Promise.allSettled([
    teacher.rpc('publish_exam_result', { p_attempt_id: publication }),
    teacher.rpc('publish_exam_result', { p_attempt_id: publication }),
  ]);
  const publicationState = psql(`select ea.is_result_published::text || '|' || (select count(*) from public.result_publication_events where attempt_id = ${esc(publication)}::uuid) || '|' || (select count(*) from public.parent_notifications where student_id = ${esc(fixture.SECURITY_TEST_STUDENT_A_ID)}::uuid and data->>'attempt_id' = ${esc(publication)}) from public.exam_attempts ea where ea.id = ${esc(publication)}::uuid;`);
  record('publication concurrency', publicationCalls.every((r) => r.status === 'fulfilled') && publicationState === 'true|1|1', publicationState);

  const certCalls = await Promise.allSettled([
    teacher.rpc('issue_certificate_for_exam', { p_student_id: fixture.SECURITY_TEST_STUDENT_A_ID, p_exam_id: exam, p_issuer: 'concurrency-test' }),
    teacher.rpc('issue_certificate_for_exam', { p_student_id: fixture.SECURITY_TEST_STUDENT_A_ID, p_exam_id: exam, p_issuer: 'concurrency-test' }),
  ]);
  const certState = psql(`select count(*) || '|' || count(distinct credential_id) from public.certificates where student_id = ${esc(fixture.SECURITY_TEST_STUDENT_A_ID)}::uuid and achievement_exam_id = ${esc(exam)}::uuid;`);
  record('certificate concurrency', certCalls.every((r) => r.status === 'fulfilled') && certState === '1|1', certState);

  const ownNotifications = await parent.from('parent_notifications').select('id,student_id,data').eq('student_id', fixture.SECURITY_TEST_STUDENT_A_ID);
  const otherNotifications = await parent.from('parent_notifications').select('id').eq('student_id', fixture.SECURITY_TEST_STUDENT_B_ID);
  record('parent own-child IDOR', !ownNotifications.error && ownNotifications.data.length === 1, JSON.stringify(ownNotifications.data));
  record('parent cross-student IDOR', !otherNotifications.error && otherNotifications.data.length === 0, JSON.stringify(otherNotifications.data));

  const teacherCrossTenant = await teacher.rpc('issue_certificate_for_exam', { p_student_id: fixture.SECURITY_TEST_STUDENT_B_ID, p_exam_id: fixture.SECURITY_TEST_EXAM_B_ID, p_issuer: 'idor-test' });
  record('teacher cross-tenant certificate IDOR', Boolean(teacherCrossTenant.error), teacherCrossTenant.error?.message ?? 'unexpected success');

  const conversation = await student.rpc('get_or_create_tutor_conversation');
  const conversationId = conversation.data?.id;
  if (!conversationId) throw new Error(`HARNESS_ERROR: tutor conversation fixture unavailable: ${conversation.error?.message}`);
  const ownerUserId = psql(`select user_id::text from public.student_profiles where id = ${esc(fixture.SECURITY_TEST_STUDENT_A_ID)}::uuid;`);
  if (!ownerUserId) throw new Error('HARNESS_ERROR: Student A user identity missing for Tutor storage fixture.');
  const ownerPath = `${ownerUserId}/${conversationId}/integrity.png`;
  const upload = await student.storage.from('tutor_attachments').upload(ownerPath, new Blob([Buffer.from([137, 80, 78, 71])], { type: 'image/png' }), { contentType: 'image/png' });
  if (upload.error) throw new Error(`HARNESS_ERROR: owner attachment setup failed: ${upload.error.message}`);
  const ownerUrl = await student.storage.from('tutor_attachments').createSignedUrl(ownerPath, 1);
  record('signed URL owner generation', !ownerUrl.error, ownerUrl.error?.message ?? 'signed URL created');
  const ownerRead = ownerUrl.data?.signedUrl ? await fetch(ownerUrl.data.signedUrl) : null;
  record('signed URL valid consumption', Boolean(ownerRead?.ok), ownerRead ? `HTTP ${ownerRead.status}` : 'not generated');
  const crossUser = await other.storage.from('tutor_attachments').createSignedUrl(ownerPath, 60);
  record('signed URL cross-user generation denied', Boolean(crossUser.error), crossUser.error?.message ?? 'unexpected success');
  const sameTenantUnrelated = await parent.storage.from('tutor_attachments').createSignedUrl(ownerPath, 60);
  record('signed URL same-tenant unrelated generation denied', Boolean(sameTenantUnrelated.error), sameTenantUnrelated.error?.message ?? 'unexpected success');
  const staffUrl = await teacher.storage.from('tutor_attachments').createSignedUrl(ownerPath, 60);
  record('signed URL authorized staff generation', !staffUrl.error, staffUrl.error?.message ?? 'signed URL created');
  const anonUrl = await createClient(url, anonKey, { auth: { persistSession: false } }).storage.from('tutor_attachments').createSignedUrl(ownerPath, 60);
  record('signed URL unauthenticated denied', Boolean(anonUrl.error), anonUrl.error?.message ?? 'unexpected success');
  const missing = await student.storage.from('tutor_attachments').createSignedUrl(`${ownerPath}-missing`, 60);
  const missingRead = missing.data?.signedUrl ? await fetch(missing.data.signedUrl) : null;
  record('signed URL nonexistent safe failure', Boolean(missing.error) || !missingRead?.ok, missing.error?.message ?? `HTTP ${missingRead?.status}`);
  const manipulated = await student.storage.from('tutor_attachments').createSignedUrl(`${ownerUserId}/00000000-0000-4000-8000-000000000099/integrity.png`, 60);
  record('signed URL manipulated conversation safe denial', Boolean(manipulated.error), manipulated.error?.message ?? 'unexpected success');
  const sibling = await student.storage.from('tutor_attachments').createSignedUrl(`${ownerUserId}/${conversationId}/sibling.png`, 60);
  record('signed URL sibling path safe denial', Boolean(sibling.error), sibling.error?.message ?? 'unexpected success');
  const encoded = await student.storage.from('tutor_attachments').createSignedUrl(ownerPath.replace('/', '%2F'), 60);
  record('signed URL encoded owner path remains scoped', !encoded.error, encoded.error?.message ?? 'owner-authorized normalization');
  const expiring = await student.storage.from('tutor_attachments').createSignedUrl(ownerPath, 1);
  await sleep(1600);
  const expiredRead = expiring.data?.signedUrl ? await fetch(expiring.data.signedUrl) : null;
  record('signed URL expiry', Boolean(expiredRead) && !expiredRead.ok, expiredRead ? `HTTP ${expiredRead.status}` : 'not generated');

  const passed = results.filter((r) => r.pass).length;
  console.log(`FINAL_LOCAL_INTEGRITY_GATE passed=${passed} failed=${results.length - passed} harness_errors=0`);
  if (passed !== results.length) process.exit(1);
}
main().catch((error) => { console.error(error); process.exit(1); });
