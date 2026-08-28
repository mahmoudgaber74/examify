import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

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
  studentB: randomUUID(),
  subjectA: randomUUID(),
  q1: randomUUID(),
  q2: randomUUID(),
  q1a: randomUUID(),
  q1b: randomUUID(),
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

function pngBlob() {
  return new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
}

async function main() {
  const users = {
    adminA: await createUser('omr-workflow-admin-a'),
    teacherA: await createUser('omr-workflow-teacher-a'),
    graderA: await createUser('omr-workflow-grader-a'),
    studentAUser: await createUser('omr-workflow-student-a'),
    adminB: await createUser('omr-workflow-admin-b'),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, 'OMR Workflow School A', 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, 'OMR Workflow School B', 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR Workflow Admin A', 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR Workflow Teacher A', 'teacher', true),
      (${sqlValue(users.graderA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR Workflow Grader A', 'grader', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, 'OMR Workflow Admin B', 'school_admin', true);

    insert into public.grade_levels (id, institution_id, name, sort_order)
    values (${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR Grade', 1);

    insert into public.classes (id, institution_id, grade_level_id, name, is_active)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.gradeA)}::uuid, 'OMR Class', true);

    insert into public.sections (id, class_id, name, is_active)
    values (${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.classA)}::uuid, 'A', true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, grade_level_id, is_active, status)
    values
      (${sqlValue(ids.studentA)}::uuid, ${sqlValue(users.studentAUser.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`OMRW-${run}`)}, 'OMR Workflow Student A', ${sqlValue(ids.gradeA)}::uuid, true, 'active'),
      (${sqlValue(ids.studentB)}::uuid, null, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`OMRB-${run}`)}, 'OMR Workflow Student B', null, true, 'active');

    insert into public.class_students (class_id, section_id, student_id)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentA)}::uuid);

    insert into public.subjects (id, institution_id, name, code, is_active)
    values (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR Workflow Subject', ${sqlValue(`OMRW_${run}`)}, true);

    insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
    values
      (${sqlValue(ids.q1)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'multiple_choice', 'OMR weighted MCQ', 'easy', 2, '{}'::jsonb),
      (${sqlValue(ids.q2)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'essay', 'OMR manual essay', 'medium', 3, '{}'::jsonb);

    insert into public.question_options (id, question_id, label, is_correct, sort_order)
    values
      (${sqlValue(ids.q1a)}::uuid, ${sqlValue(ids.q1)}::uuid, 'A', false, 0),
      (${sqlValue(ids.q1b)}::uuid, ${sqlValue(ids.q1)}::uuid, 'B', true, 1);

    insert into public.examify_exams (id, institution_id, subject_id, class_id, title, total_points, passing_score, duration_minutes, max_attempts, status, show_result_immediately, show_correct_answers)
    values (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, 'OMR Workflow Exam', 5, 40, 30, 1, 'published', false, true);

    insert into public.exam_questions (exam_id, question_id, points, sort_order)
    values
      (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.q1)}::uuid, 2, 0),
      (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.q2)}::uuid, 3, 1);

    insert into public.exam_assignments (exam_id, class_id)
    values (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.classA)}::uuid);

    insert into public.bubble_sheets (id, institution_id, exam_id, model_label, questions_count, choices_count, include_student_id, include_student_name, include_qr)
    values (${sqlValue(ids.bubbleA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.examA)}::uuid, 'A', 2, 4, true, true, true);
  `);

  const adminA = signedClient(users.adminA);
  const teacherA = signedClient(users.teacherA);
  const studentA = signedClient(users.studentAUser);
  const adminB = signedClient(users.adminB);

  const legacyBefore = {
    exams: Number(psql('select count(*) from public.exams;')),
    submissions: Number(psql('select count(*) from public.submissions;')),
  };

  const storagePath = `${ids.instA}/omr-original/${users.teacherA.id}/${ids.examA}/${randomUUID()}/original.png`;
  await expectOk('Teacher A', 'upload OMR workflow scan', teacherA.storage.from('exam-sheets').upload(storagePath, pngBlob(), { contentType: 'image/png' }));

  const { data: omrRows } = await expectOk('Teacher A', 'create uploaded OMR record', teacherA.from('omr_results').insert({
    institution_id: ids.instA,
    bubble_sheet_id: ids.bubbleA,
    exam_id: ids.examA,
    original_storage_path: storagePath,
    image_mime_type: 'image/png',
    image_size_bytes: 8,
    uploaded_by: users.teacherA.id,
    model_label: 'A',
    status: 'uploaded',
    total_questions: 2,
  }).select('id').single());
  const omrId = omrRows?.id;

  await expectOk('Teacher A', 'save processing result needing review', teacherA.from('omr_results').update({
    status: 'needs_review',
    score: 0,
    total_questions: 2,
    correct_count: 0,
    wrong_count: 1,
    empty_count: 1,
    confidence: 0.5,
    review_reasons: [{ question: 1, reason: 'ambiguous' }],
  }).eq('id', omrId));

  await expectOk('Teacher A', 'insert detected OMR answers', teacherA.from('omr_answers').insert([
    {
      omr_result_id: omrId,
      question_number: 1,
      question_id: ids.q1,
      option_id: ids.q1a,
      detected_answer: 'A',
      correct_answer: 'B',
      is_correct: false,
      confidence: 0.42,
      needs_manual_review: true,
      review_reason: 'ambiguous',
      fill_ratios: { A: 0.25, B: 0.24 },
    },
    {
      omr_result_id: omrId,
      question_number: 2,
      question_id: ids.q2,
      detected_answer: null,
      correct_answer: null,
      is_correct: null,
      confidence: 0,
      needs_manual_review: false,
      review_reason: 'empty',
      fill_ratios: {},
    },
  ]));

  await expectFail('Student A', 'cannot read OMR review data', studentA.from('omr_results').select('id').eq('id', omrId));
  await expectFail('Student A', 'cannot approve OMR sheet', studentA.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));
  await expectFail('Institution B', 'cannot approve institution A OMR', adminB.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));

  await expectFail('Teacher A', 'cannot approve unresolved OMR answer', teacherA.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));

  await expectOk('Teacher A', 'manual review fixes detected answer', teacherA.from('omr_answers').update({
    manual_override: 'B',
    option_id: ids.q1b,
    is_correct: true,
    needs_manual_review: false,
    manually_reviewed_at: new Date().toISOString(),
  }).eq('omr_result_id', omrId).eq('question_number', 1));

  const { data: approvalRows } = await expectOk('Teacher A', 'approve OMR into modern attempt', teacherA.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));
  const attemptId = approvalRows?.[0]?.exam_attempt_id;

  const attemptSummary = psql(`
    select status || ':' || score::text || ':' || score_percentage::text || ':' || is_result_published::text
    from public.exam_attempts
    where id = ${sqlValue(attemptId)}::uuid;
  `);
  record('Database', 'OMR attempt score and unpublished result', 'graded/submitted score 2 percentage 40 unpublished', attemptSummary, attemptSummary === 'submitted:2.00:40.00:false');

  const answerSummary = psql(`
    select count(*)::text || ':' || COALESCE(sum(awarded_points), 0)::text
    from public.answers
    where attempt_id = ${sqlValue(attemptId)}::uuid;
  `);
  record('Database', 'OMR answers written once with weighted points', '2 answers, 2 points', answerSummary, answerSummary === '2:2.00');

  const beforeRepeat = {
    attempts: Number(psql(`select count(*) from public.exam_attempts where exam_id = ${sqlValue(ids.examA)}::uuid and student_id = ${sqlValue(ids.studentA)}::uuid;`)),
    answers: Number(psql(`select count(*) from public.answers where attempt_id = ${sqlValue(attemptId)}::uuid;`)),
  };
  await expectOk('Teacher A', 'approve OMR idempotently second time', teacherA.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));
  const afterRepeat = {
    attempts: Number(psql(`select count(*) from public.exam_attempts where exam_id = ${sqlValue(ids.examA)}::uuid and student_id = ${sqlValue(ids.studentA)}::uuid;`)),
    answers: Number(psql(`select count(*) from public.answers where attempt_id = ${sqlValue(attemptId)}::uuid;`)),
  };
  record('Database', 'OMR approval idempotency', 'same attempt and answer counts', JSON.stringify({ beforeRepeat, afterRepeat }), beforeRepeat.attempts === afterRepeat.attempts && beforeRepeat.answers === afterRepeat.answers);

  const legacyAfter = {
    exams: Number(psql('select count(*) from public.exams;')),
    submissions: Number(psql('select count(*) from public.submissions;')),
  };
  record('Database', 'OMR workflow did not write legacy tables', 'exams_delta=0 submissions_delta=0', JSON.stringify({ legacyBefore, legacyAfter }), legacyBefore.exams === legacyAfter.exams && legacyBefore.submissions === legacyAfter.submissions);

  await expectFail('Student A', 'cannot see result before publish', studentA.from('exam_attempts').select('id, is_result_published').eq('id', attemptId).eq('is_result_published', true));
  await expectOk('Admin A', 'publish modern result after OMR approval', adminA.from('exam_attempts').update({ status: 'approved', is_result_published: true, approved_at: new Date().toISOString(), approved_by: users.adminA.id }).eq('id', attemptId));
  const { data: publishedRows, error: publishedError } = await studentA.from('exam_attempts').select('id, score, score_percentage, is_result_published').eq('id', attemptId).eq('is_result_published', true);
  record('Student A', 'can see result after publish', 'one published modern result', publishedError ? publishedError.message : JSON.stringify(publishedRows), !publishedError && Array.isArray(publishedRows) && publishedRows.length === 1);

  console.table(results);
  const failed = results.filter((result) => !result.passed);
  console.log(`OMR_WORKFLOW_TEST_SUMMARY passed=${results.length - failed.length} failed=${failed.length}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
