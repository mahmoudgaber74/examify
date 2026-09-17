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
  q2a: randomUUID(),
  q2b: randomUUID(),
  examA: randomUUID(),
  bubbleA: randomUUID(),
  concurrentExam: randomUUID(),
  concurrentBubble: randomUUID(),
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
  if (error) throw new Error(`${account} | ${operation} expected success but failed: ${error.message}`);
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
      (${sqlValue(ids.q2)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'multiple_choice', 'OMR second MCQ', 'medium', 3, '{}'::jsonb);

    insert into public.question_options (id, question_id, label, is_correct, sort_order)
    values
      (${sqlValue(ids.q1a)}::uuid, ${sqlValue(ids.q1)}::uuid, 'A', false, 0),
      (${sqlValue(ids.q1b)}::uuid, ${sqlValue(ids.q1)}::uuid, 'B', true, 1),
      (${sqlValue(ids.q2a)}::uuid, ${sqlValue(ids.q2)}::uuid, 'A', true, 0),
      (${sqlValue(ids.q2b)}::uuid, ${sqlValue(ids.q2)}::uuid, 'B', false, 1);

    insert into public.examify_exams (id, institution_id, subject_id, class_id, title, total_points, passing_score, duration_minutes, max_attempts, status, show_result_immediately, show_correct_answers)
    values (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, 'OMR Workflow Exam', 5, 40, 30, 1, 'published', false, true);

    insert into public.exam_questions (exam_id, question_id, points, sort_order)
    values
      (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.q1)}::uuid, 2, 0),
      (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.q2)}::uuid, 3, 1);

    insert into public.exam_assignments (exam_id, class_id)
    values (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.classA)}::uuid);

    insert into public.examify_exams (id, institution_id, subject_id, class_id, title, total_points, passing_score, duration_minutes, max_attempts, status, show_result_immediately, show_correct_answers)
    values (${sqlValue(ids.concurrentExam)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, 'OMR Concurrency Exam', 5, 40, 30, 1, 'published', false, true);
    insert into public.exam_questions (exam_id, question_id, points, sort_order)
    values (${sqlValue(ids.concurrentExam)}::uuid, ${sqlValue(ids.q1)}::uuid, 2, 0), (${sqlValue(ids.concurrentExam)}::uuid, ${sqlValue(ids.q2)}::uuid, 3, 1);
    insert into public.exam_assignments (exam_id, class_id)
    values (${sqlValue(ids.concurrentExam)}::uuid, ${sqlValue(ids.classA)}::uuid);

    insert into public.bubble_sheets (id, institution_id, exam_id, model_label, questions_count, choices_count, include_student_id, include_student_name, include_qr)
    values (${sqlValue(ids.bubbleA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.examA)}::uuid, 'A', 2, 4, true, true, true);
    insert into public.bubble_sheets (id, institution_id, exam_id, model_label, questions_count, choices_count, include_student_id, include_student_name, include_qr)
    values (${sqlValue(ids.concurrentBubble)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.concurrentExam)}::uuid, 'A', 2, 4, true, true, true);
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

  const { data: omrRows } = await expectOk('Fixture Admin', 'create uploaded OMR record', adminA.from('omr_results').insert({
    institution_id: ids.instA,
    bubble_sheet_id: ids.bubbleA,
    exam_id: ids.examA,
    student_profile_id: ids.studentA,
    original_storage_path: storagePath,
    image_mime_type: 'image/png',
    image_size_bytes: 8,
    uploaded_by: users.teacherA.id,
    model_label: 'A',
    status: 'uploaded',
    total_questions: 2,
  }).select('id').single());
  const returnedOmrId = (Array.isArray(omrRows) ? omrRows[0]?.id : omrRows?.id) ?? null;
  const omrId = returnedOmrId ?? psql(`select id::text from public.omr_results where original_storage_path = ${sqlValue(storagePath)} limit 1;`);
  if (!omrId || !/^[0-9a-f-]{36}$/i.test(omrId)) throw new Error(`HARNESS_ERROR: OMR result insert returned invalid id: ${String(omrId)}`);

  await expectOk('Fixture Admin', 'save processing result needing review', adminA.from('omr_results').update({
    status: 'needs_review',
    score: 0,
    total_questions: 2,
    correct_count: 0,
    wrong_count: 1,
    empty_count: 1,
    confidence: 0.5,
    review_reasons: [{ question: 1, reason: 'ambiguous' }],
  }).eq('id', omrId));

  await expectOk('Fixture Admin', 'insert detected OMR answers', adminA.from('omr_answers').insert([
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
      detected_answer: 'B',
      correct_answer: 'A',
      is_correct: false,
      confidence: 0.95,
      needs_manual_review: false,
      review_reason: 'confident_wrong',
      fill_ratios: {},
    },
  ]));

  const relationalPrecheck = Number(psql(`
    select count(*)
    from public.omr_results r
    join public.bubble_sheets b on b.id = r.bubble_sheet_id
      and b.exam_id = r.exam_id and b.institution_id = r.institution_id
    join public.examify_exams e on e.id = r.exam_id
      and e.institution_id = r.institution_id
    join public.student_profiles s on s.id = r.student_profile_id
      and s.institution_id = r.institution_id
    join public.staff_profiles st on st.user_id = ${sqlValue(users.teacherA.id)}::uuid
      and st.institution_id = r.institution_id
      and st.role in ('teacher', 'grader', 'school_admin', 'super_admin')
    where r.id = ${sqlValue(omrId)}::uuid
      and r.exam_attempt_id is null
      and r.status = 'needs_review'
      and (select count(*) from public.omr_answers oa
           where oa.omr_result_id = r.id and oa.question_id in (${sqlValue(ids.q1)}::uuid, ${sqlValue(ids.q2)}::uuid)) = 2
      and (select count(*) from public.omr_answers oa
           where oa.omr_result_id = r.id and oa.needs_manual_review) = 1;
  `));
  record('Harness', 'OMR relational precheck', '1 valid source graph; no attempt before approval', String(relationalPrecheck), relationalPrecheck === 1);

  await expectFail('Student A', 'cannot read OMR review data', studentA.from('omr_results').select('id').eq('id', omrId));
  await expectFail('Student A', 'cannot approve OMR sheet', studentA.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));
  await expectFail('Institution B', 'cannot approve institution A OMR', adminB.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));

  await expectFail('Teacher A', 'cannot approve unresolved OMR answer', teacherA.rpc('approve_omr_result', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));

  const reviewAnswerId = (await adminA.from('omr_answers').select('id').eq('omr_result_id', omrId).eq('question_number', 1).single()).data?.id;
  if (!reviewAnswerId) throw new Error(`HARNESS_ERROR: OMR answer fixture missing for result ${omrId}.`);
  const reviewAnswer = await expectOk('Teacher A', 'manual review fixes detected answer', teacherA.rpc('resolve_omr_answer', {
    p_omr_answer_id: reviewAnswerId,
    p_manual_answer: 'B',
  }));

  const { data: approvalRows } = await expectOk('Teacher A', 'approve OMR into modern attempt', teacherA.rpc('approve_omr_result_idempotent', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));
  const approval = Array.isArray(approvalRows) ? approvalRows[0] : approvalRows;
  const persistedAttemptId = psql(`select COALESCE(exam_attempt_id::text, '') from public.omr_results where id = ${sqlValue(omrId)}::uuid;`);
  const attemptId = approval?.exam_attempt_id ?? (persistedAttemptId || null);
  if (!attemptId) throw new Error('HARNESS_ERROR: OMR approval returned no linked exam_attempt_id.');

  const attemptSummary = psql(`
    select status || ':' || score::text || ':' || score_percentage::text || ':' || is_result_published::text
    from public.exam_attempts
    where id = ${sqlValue(attemptId)}::uuid;
  `);
  record('Database', 'OMR attempt score and unpublished result', 'graded score 2 percentage 40 unpublished', attemptSummary, attemptSummary === 'graded:2.00:40.00:false');

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
  await expectOk('Teacher A', 'approve OMR idempotently second time', teacherA.rpc('approve_omr_result_idempotent', { p_omr_result_id: omrId, p_student_profile_id: ids.studentA }));
  const afterRepeat = {
    attempts: Number(psql(`select count(*) from public.exam_attempts where exam_id = ${sqlValue(ids.examA)}::uuid and student_id = ${sqlValue(ids.studentA)}::uuid;`)),
    answers: Number(psql(`select count(*) from public.answers where attempt_id = ${sqlValue(attemptId)}::uuid;`)),
  };
  record('Database', 'OMR approval idempotency', 'same attempt and answer counts', JSON.stringify({ beforeRepeat, afterRepeat }), beforeRepeat.attempts === afterRepeat.attempts && beforeRepeat.answers === afterRepeat.answers);

  const auditEvidence = Number(psql(`
    select count(*) from public.omr_results r
    join public.omr_answers oa on oa.omr_result_id = r.id
    where r.id = ${sqlValue(omrId)}::uuid and r.status = 'approved'
      and r.exam_attempt_id = ${sqlValue(attemptId)}::uuid
      and r.approved_by = ${sqlValue(users.teacherA.id)}::uuid and r.approved_at is not null
      and r.reviewed_by = ${sqlValue(users.teacherA.id)}::uuid and r.reviewed_at is not null
      and oa.detected_answer = 'A' and oa.confidence = 0.42
      and oa.manual_override = 'B' and oa.needs_manual_review = false
      and oa.manually_reviewed_at is not null;
  `));
  record('Audit', 'machine extraction and review evidence preserved', '1 result with raw answer/confidence, correction, reviewer, timestamps', String(auditEvidence), auditEvidence === 1);

  const concurrentOmrId = randomUUID();
  const concurrentPath = `${ids.instA}/omr-original/${users.teacherA.id}/${ids.concurrentExam}/${randomUUID()}/concurrent.png`;
  await expectOk('Teacher A', 'upload OMR concurrency scan', teacherA.storage.from('exam-sheets').upload(concurrentPath, pngBlob(), { contentType: 'image/png' }));
  await expectOk('Fixture Admin', 'create fresh OMR concurrency result', adminA.from('omr_results').insert({ id: concurrentOmrId, institution_id: ids.instA, bubble_sheet_id: ids.concurrentBubble, exam_id: ids.concurrentExam, student_profile_id: ids.studentA, original_storage_path: concurrentPath, image_mime_type: 'image/png', image_size_bytes: 8, uploaded_by: users.teacherA.id, model_label: 'A', status: 'processed', total_questions: 2 }));
  await expectOk('Fixture Admin', 'create fresh OMR concurrency answers', adminA.from('omr_answers').insert([
    { omr_result_id: concurrentOmrId, question_number: 1, question_id: ids.q1, option_id: ids.q1b, detected_answer: 'B', correct_answer: 'B', is_correct: true, confidence: 0.99, needs_manual_review: false, fill_ratios: {} },
    { omr_result_id: concurrentOmrId, question_number: 2, question_id: ids.q2, option_id: ids.q2b, detected_answer: 'B', correct_answer: 'A', is_correct: false, confidence: 0.99, needs_manual_review: false, fill_ratios: {} },
  ]));
  const concurrentApprovals = await Promise.allSettled([
    teacherA.rpc('approve_omr_result_idempotent', { p_omr_result_id: concurrentOmrId, p_student_profile_id: ids.studentA }),
    teacherA.rpc('approve_omr_result_idempotent', { p_omr_result_id: concurrentOmrId, p_student_profile_id: ids.studentA }),
  ]);
  const concurrentErrors = concurrentApprovals
    .map((r) => r.status === 'fulfilled' ? r.value?.error?.message : r.reason?.message)
    .filter(Boolean);
  const concurrentState = psql(`
    select (select count(*) from public.exam_attempts where id = (select exam_attempt_id from public.omr_results where id = ${sqlValue(concurrentOmrId)}::uuid)),
           (select count(*) from public.answers where attempt_id = (select exam_attempt_id from public.omr_results where id = ${sqlValue(concurrentOmrId)}::uuid)),
           (select coalesce(sum(awarded_points), 0) from public.answers where attempt_id = (select exam_attempt_id from public.omr_results where id = ${sqlValue(concurrentOmrId)}::uuid)),
           (select status from public.omr_results where id = ${sqlValue(concurrentOmrId)}::uuid);
  `);
  record('Concurrency', 'two OMR approvals converge safely', 'one attempt, two answers, score 2, approved', `${concurrentState}${concurrentErrors.length ? ` errors=${concurrentErrors.join(' || ')}` : ''}`, concurrentErrors.length === 0 && concurrentState === '1|2|2.00|approved');

  const rollbackAttemptId = randomUUID();
  const rollbackOmrId = randomUUID();
  psql(`
    set session_replication_role = replica;
    insert into public.exam_attempts (id, exam_id, student_id, attempt_number, status, started_at, is_result_published)
    values (${sqlValue(rollbackAttemptId)}::uuid, ${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.studentB)}::uuid, 99, 'submitted', now(), false);
    insert into public.omr_results (id, institution_id, bubble_sheet_id, exam_id, student_profile_id, original_storage_path, image_mime_type, image_size_bytes, uploaded_by, model_label, status, total_questions)
    values (${sqlValue(rollbackOmrId)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.bubbleA)}::uuid, ${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.studentA)}::uuid, ${sqlValue(concurrentPath)}, 'image/png', 8, ${sqlValue(users.teacherA.id)}::uuid, 'A', 'processed', 2);
    insert into public.omr_answers (omr_result_id, question_number, question_id, option_id, detected_answer, correct_answer, is_correct, confidence, needs_manual_review, fill_ratios)
    values
      (${sqlValue(rollbackOmrId)}::uuid, 1, ${sqlValue(ids.q1)}::uuid, ${sqlValue(ids.q1b)}::uuid, 'B', 'B', true, 0.99, false, '{}'::jsonb),
      (${sqlValue(rollbackOmrId)}::uuid, 2, ${sqlValue(ids.q2)}::uuid, ${sqlValue(ids.q2b)}::uuid, 'B', 'A', false, 0.99, false, '{}'::jsonb);
    update public.omr_results set exam_attempt_id = ${sqlValue(rollbackAttemptId)}::uuid where id = ${sqlValue(rollbackOmrId)}::uuid;
    set session_replication_role = origin;
  `);
  const rollbackResult = await teacherA.rpc('approve_omr_result_idempotent', { p_omr_result_id: rollbackOmrId, p_student_profile_id: ids.studentA });
  const rollbackState = psql(`
    select (select status from public.omr_results where id = ${sqlValue(rollbackOmrId)}::uuid),
           (select count(*) from public.answers where attempt_id = ${sqlValue(rollbackAttemptId)}::uuid),
           (select status from public.exam_attempts where id = ${sqlValue(rollbackAttemptId)}::uuid),
           (select detected_answer from public.omr_answers where omr_result_id = ${sqlValue(rollbackOmrId)}::uuid and question_number = 1);
  `);
  record('Rollback', 'invalid linked attempt rolls back atomically', 'RPC error; result not approved; no answers; attempt unchanged; extraction intact', rollbackState, Boolean(rollbackResult.error) && rollbackState === 'processed|0|submitted|B');

  const legacyAfter = {
    exams: Number(psql('select count(*) from public.exams;')),
    submissions: Number(psql('select count(*) from public.submissions;')),
  };
  record('Database', 'OMR workflow did not write legacy tables', 'exams_delta=0 submissions_delta=0', JSON.stringify({ legacyBefore, legacyAfter }), legacyBefore.exams === legacyAfter.exams && legacyBefore.submissions === legacyAfter.submissions);

  await expectFail('Student A', 'cannot see result before publish', studentA.from('exam_attempts').select('id, is_result_published').eq('id', attemptId).eq('is_result_published', true));
  await expectOk('Admin A', 'publish modern result after OMR approval', adminA.rpc('publish_exam_result', { p_attempt_id: attemptId }));
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
