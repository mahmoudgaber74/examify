import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const statusRaw = execFileSync('cmd.exe', ['/c', '.\\node_modules\\.bin\\supabase.cmd', 'status', '-o', 'json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const status = JSON.parse(statusRaw);
const url = status.API_URL;
const anonKey = status.ANON_KEY;
const jwtSecret = status.JWT_SECRET;
const run = Date.now().toString(36);
const results = [];

const ids = {
  instA: randomUUID(),
  instB: randomUUID(),
  gradeA: randomUUID(),
  classA: randomUUID(),
  sectionA: randomUUID(),
  studentA: randomUUID(),
  subjectA: randomUUID(),
  questionA: randomUUID(),
  optionA: randomUUID(),
  optionB: randomUUID(),
  examA: randomUUID(),
  bubbleA: randomUUID(),
};

function record(account, operation, expected, actual, passed) {
  results.push({ account, operation, expected, actual, passed });
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_project', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function userToken(userId, email) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: 'supabase-demo',
    aud: 'authenticated',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: userId,
    email,
    role: 'authenticated',
  }));
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function createUser(label) {
  const id = randomUUID();
  const email = `${label}-${run}@example.local`;
  psql(`
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (${sqlValue(id)}::uuid, 'authenticated', 'authenticated', ${sqlValue(email)}, 'local-test-only', now(), now(), now());
  `);
  return { id, email, token: userToken(id, email) };
}

function signedClient(user) {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set('authorization', `Bearer ${user.token}`);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

async function expectOk(account, operation, promise) {
  const { data, error } = await promise;
  record(account, operation, 'success', error ? error.message : 'success', !error);
  return { data, error };
}

async function expectFail(account, operation, promise) {
  const { data, error } = await promise;
  const failed = Boolean(error) || data === null || (Array.isArray(data) && data.length === 0);
  record(account, operation, 'fail', error ? error.message : JSON.stringify(data), failed);
  return { data, error };
}

function pngBuffer(seed = '') {
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(seed)]);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const users = {
    adminA: await createUser('omr-api-admin-a'),
    teacherA: await createUser('omr-api-teacher-a'),
    studentAUser: await createUser('omr-api-student-a'),
    adminB: await createUser('omr-api-admin-b'),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, 'OMR API School A', 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, 'OMR API School B', 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR API Admin A', 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR API Teacher A', 'teacher', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, 'OMR API Admin B', 'school_admin', true);

    insert into public.grade_levels (id, institution_id, name, sort_order)
    values (${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR API Grade', 1);

    insert into public.classes (id, institution_id, grade_level_id, name, is_active)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.gradeA)}::uuid, 'OMR API Class', true);

    insert into public.sections (id, class_id, name, is_active)
    values (${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.classA)}::uuid, 'A', true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, grade_level_id, is_active, status)
    values (${sqlValue(ids.studentA)}::uuid, ${sqlValue(users.studentAUser.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`OMRA-${run}`)}, 'OMR API Student A', ${sqlValue(ids.gradeA)}::uuid, true, 'active');

    insert into public.class_students (class_id, section_id, student_id)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentA)}::uuid);

    insert into public.subjects (id, institution_id, name, code, is_active)
    values (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR API Subject', ${sqlValue(`OMRA_${run}`)}, true);

    insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
    values (${sqlValue(ids.questionA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'multiple_choice', 'OMR API MCQ', 'easy', 1, '{}'::jsonb);

    insert into public.question_options (id, question_id, label, is_correct, sort_order)
    values
      (${sqlValue(ids.optionA)}::uuid, ${sqlValue(ids.questionA)}::uuid, 'A', false, 0),
      (${sqlValue(ids.optionB)}::uuid, ${sqlValue(ids.questionA)}::uuid, 'B', true, 1);

    insert into public.examify_exams (id, institution_id, subject_id, class_id, title, total_points, passing_score, duration_minutes, max_attempts, status, show_result_immediately, show_correct_answers)
    values (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, 'OMR API Exam', 1, 50, 30, 1, 'published', false, true);

    insert into public.exam_questions (exam_id, question_id, points, sort_order)
    values (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.questionA)}::uuid, 1, 0);

    insert into public.exam_assignments (exam_id, class_id)
    values (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.classA)}::uuid);
  `);

  const teacherA = signedClient(users.teacherA);
  const studentA = signedClient(users.studentAUser);
  const adminB = signedClient(users.adminB);
  const image = pngBuffer(run);
  const imageHash = sha256(image);
  const storagePath = `${ids.instA}/omr-original/${users.teacherA.id}/${ids.examA}/${randomUUID()}/${imageHash}.png`;

  const { data: bubbleRows } = await expectOk('Teacher A', 'create OMR template with metadata', teacherA.from('bubble_sheets').insert({
    institution_id: ids.instA,
    exam_id: ids.examA,
    model_label: 'A',
    questions_count: 1,
    choices_count: 4,
    include_student_id: true,
    include_student_name: true,
    include_qr: true,
    template_version: 1,
    page_size: 'A4',
    generated_by: users.teacherA.id,
  }).select('id, template_version, page_size').single());
  ids.bubbleA = bubbleRows?.id;

  await expectOk('Teacher A', 'upload OMR image bytes', teacherA.storage.from('exam-sheets').upload(
    storagePath,
    new Blob([image], { type: 'image/png' }),
    { contentType: 'image/png' },
  ));

  const { data: omrRows } = await expectOk('Teacher A', 'create OMR result with SHA-256 metadata', teacherA.from('omr_results').insert({
    institution_id: ids.instA,
    bubble_sheet_id: ids.bubbleA,
    exam_id: ids.examA,
    original_storage_path: storagePath,
    image_mime_type: 'image/png',
    image_size_bytes: image.length,
    file_sha256: imageHash,
    template_version: 1,
    processing_metadata: { scanner: 'test-fixture', confidence_policy: 'manual-review-required' },
    uploaded_by: users.teacherA.id,
    model_label: 'A',
    status: 'needs_review',
    total_questions: 1,
    confidence: 0.42,
  }).select('id').single());
  const omrId = omrRows?.id;

  await expectFail('Teacher A', 'reject duplicate OMR scan hash for same exam', teacherA.from('omr_results').insert({
    institution_id: ids.instA,
    bubble_sheet_id: ids.bubbleA,
    exam_id: ids.examA,
    original_storage_path: storagePath,
    image_mime_type: 'image/png',
    image_size_bytes: image.length,
    file_sha256: imageHash,
    uploaded_by: users.teacherA.id,
    model_label: 'A',
    status: 'uploaded',
  }));

  await expectFail('Teacher A', 'reject invalid OMR SHA-256 format', teacherA.from('omr_results').insert({
    institution_id: ids.instA,
    exam_id: ids.examA,
    image_mime_type: 'image/png',
    image_size_bytes: image.length,
    file_sha256: 'not-a-hash',
    uploaded_by: users.teacherA.id,
    model_label: 'A',
  }));

  const { data: answerRows } = await expectOk('Teacher A', 'insert low-confidence OMR answer', teacherA.from('omr_answers').insert({
    omr_result_id: omrId,
    question_number: 1,
    question_id: ids.questionA,
    option_id: ids.optionA,
    detected_answer: 'A',
    correct_answer: 'B',
    is_correct: false,
    confidence: 0.42,
    needs_manual_review: true,
    review_reason: 'ambiguous',
    fill_ratios: { A: 0.28, B: 0.26 },
  }).select('id').single());
  const answerId = answerRows?.id;

  await expectFail('Student A', 'cannot read OMR result before approval', studentA.from('omr_results').select('id').eq('id', omrId));
  await expectFail('Institution B', 'cannot approve foreign OMR', adminB.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));
  await expectFail('Teacher A', 'cannot approve unresolved review item', teacherA.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));

  await expectOk('Teacher A', 'manual review writes override and audit', teacherA.from('omr_answers').update({
    manual_override: 'B',
    option_id: ids.optionB,
    is_correct: true,
    needs_manual_review: false,
  }).eq('id', answerId));

  const auditCount = Number(psql(`
    select count(*)
    from public.audit_log
    where action = 'omr_answer_manual_review'
      and entity_id = ${sqlValue(answerId)}::uuid;
  `));
  record('Database', 'manual OMR review audit row exists', '1+', String(auditCount), auditCount >= 1);

  const { data: approvalRows } = await expectOk('Teacher A', 'approve OMR into exam attempt', teacherA.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));
  const attemptId = approvalRows?.[0]?.exam_attempt_id;

  record('Database', 'approved OMR has attempt id', 'uuid', attemptId ?? 'missing', Boolean(attemptId));
  record('Database', 'OMR attempt answer written', '1', psql(`select count(*) from public.answers where attempt_id = ${sqlValue(attemptId)}::uuid;`), psql(`select count(*) from public.answers where attempt_id = ${sqlValue(attemptId)}::uuid;`) === '1');
  record('Database', 'OMR attempt hidden until result publish', 'false', psql(`select is_result_published::text from public.exam_attempts where id = ${sqlValue(attemptId)}::uuid;`), psql(`select is_result_published::text from public.exam_attempts where id = ${sqlValue(attemptId)}::uuid;`) === 'false');

  await expectFail('Teacher A', 'cannot edit OMR answer after approval', teacherA.from('omr_answers').update({ manual_override: 'A' }).eq('id', answerId));
  await expectFail('Teacher A', 'cannot relink approved OMR result', teacherA.from('omr_results').update({ student_profile_id: null }).eq('id', omrId));

  console.table(results);
  const failed = results.filter((result) => !result.passed);
  console.log(`OMR_API_TEST_SUMMARY passed=${results.length - failed.length} failed=${failed.length}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
