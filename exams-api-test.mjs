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
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
const run = Date.now().toString(36);
const ids = {
  instA: randomUUID(),
  instB: randomUUID(),
  classA: randomUUID(),
  classB: randomUUID(),
  sectionA: randomUUID(),
  studentA: randomUUID(),
  studentB: randomUUID(),
  studentOtherInst: randomUUID(),
};

function record(account, operation, expected, actual, passed) {
  results.push({ account, operation, expected, actual, passed });
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
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

async function createUser(label) {
  const email = `${label}-${run}@example.local`;
  const id = randomUUID();
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

async function expectFailOrEmpty(account, operation, promise) {
  const { data, error } = await promise;
  const blocked = Boolean(error) || data === null || (Array.isArray(data) && data.length === 0);
  record(account, operation, 'fail or empty', error ? error.message : JSON.stringify(data), blocked);
  return { data, error };
}

async function main() {
  const users = {
    adminA: await createUser('exams-admin-a'),
    adminB: await createUser('exams-admin-b'),
    graderA: await createUser('exams-grader-a'),
    studentA: await createUser('exams-student-a'),
    studentB: await createUser('exams-student-b'),
    studentOtherInst: await createUser('exams-student-other'),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, 'Exams School A', 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, 'Exams School B', 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Exam Admin A', 'school_admin', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Exam Admin B', 'school_admin', true),
      (${sqlValue(users.graderA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Exam Grader A', 'grader', true);

    insert into public.classes (id, institution_id, name, academic_year, is_active)
    values
      (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Class A', '2026-2027', true),
      (${sqlValue(ids.classB)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Class B', '2026-2027', true);

    insert into public.sections (id, class_id, name, is_active)
    values (${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.classA)}::uuid, 'Section A', true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, is_active, status)
    values
      (${sqlValue(ids.studentA)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`EX-ST-A-${run}`)}, 'Exam Student A', true, 'active'),
      (${sqlValue(ids.studentB)}::uuid, ${sqlValue(users.studentB.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`EX-ST-B-${run}`)}, 'Exam Student B', true, 'active'),
      (${sqlValue(ids.studentOtherInst)}::uuid, ${sqlValue(users.studentOtherInst.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`EX-ST-C-${run}`)}, 'Exam Student Other', true, 'active');

    insert into public.class_students (class_id, section_id, student_id)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentA)}::uuid);
  `);

  const clients = {
    adminA: signedClient(users.adminA),
    adminB: signedClient(users.adminB),
    graderA: signedClient(users.graderA),
    studentA: signedClient(users.studentA),
    studentB: signedClient(users.studentB),
    studentOtherInst: signedClient(users.studentOtherInst),
  };

  const legacyBefore = Number(psql(`select count(*) from public.submissions;`));
  const legacyExamsBefore = Number(psql(`select count(*) from public.exams;`));

  const subjectResult = await expectOk(
    'School Admin A',
    'create subject for canonical exam',
    clients.adminA.from('subjects').insert({
      institution_id: ids.instA,
      name: 'Canonical Exam Subject',
      code: `CEX-${run}`,
      is_active: true,
    }).select('id').single(),
  );
  const subjectId = subjectResult.data.id;

  const questionResult = await expectOk(
    'School Admin A',
    'create question in question bank',
    clients.adminA.from('questions').insert({
      institution_id: ids.instA,
      subject_id: subjectId,
      type: 'multiple_choice',
      prompt: 'Canonical path question',
      difficulty: 'medium',
      points: 1,
    }).select('id').single(),
  );
  const questionId = questionResult.data.id;

  const optionResult = await expectOk(
    'School Admin A',
    'create correct option',
    clients.adminA.from('question_options').insert({
      question_id: questionId,
      label: 'A',
      is_correct: true,
      sort_order: 0,
    }).select('id').single(),
  );
  const optionId = optionResult.data.id;

  const examResult = await expectOk(
    'School Admin A',
    'create modern draft exam',
    clients.adminA.from('examify_exams').insert({
      institution_id: ids.instA,
      subject_id: subjectId,
      class_id: ids.classA,
      title: `Canonical Exam ${run}`,
      total_points: 1,
      passing_score: 50,
      duration_minutes: 30,
      max_attempts: 1,
      status: 'draft',
      show_result_immediately: false,
    }).select('id').single(),
  );
  const examId = examResult.data.id;

  const unassignedExamResult = await expectOk(
    'School Admin A',
    'create unassigned modern exam',
    clients.adminA.from('examify_exams').insert({
      institution_id: ids.instA,
      subject_id: subjectId,
      title: `Unassigned Canonical Exam ${run}`,
      total_points: 1,
      passing_score: 50,
      duration_minutes: 30,
      max_attempts: 1,
      status: 'published',
    }).select('id').single(),
  );
  const unassignedExamId = unassignedExamResult.data.id;

  const directExamResult = await expectOk(
    'School Admin A',
    'create direct-assignment modern exam',
    clients.adminA.from('examify_exams').insert({
      institution_id: ids.instA,
      subject_id: subjectId,
      title: `Direct Canonical Exam ${run}`,
      total_points: 1,
      passing_score: 50,
      duration_minutes: 30,
      max_attempts: 1,
      status: 'published',
    }).select('id').single(),
  );
  const directExamId = directExamResult.data.id;

  await expectOk(
    'School Admin A',
    'assign exam directly to Student B',
    clients.adminA.from('exam_assignments').insert({
      exam_id: directExamId,
      student_id: ids.studentB,
    }).select('id').single(),
  );

  await expectOk(
    'School Admin A',
    'link question with exam_questions',
    clients.adminA.from('exam_questions').insert({
      exam_id: examId,
      question_id: questionId,
      points: 1,
      sort_order: 0,
    }).select('id').single(),
  );

  await expectOk(
    'School Admin A',
    'assign exam to section with exam_assignments',
    clients.adminA.from('exam_assignments').insert({
      exam_id: examId,
      section_id: ids.sectionA,
    }).select('id').single(),
  );

  await expectOk(
    'School Admin A',
    'assign exam to class with exam_assignments',
    clients.adminA.from('exam_assignments').insert({
      exam_id: examId,
      class_id: ids.classA,
    }).select('id').single(),
  );

  await expectOk(
    'School Admin A',
    'publish modern exam',
    clients.adminA.from('examify_exams').update({ status: 'published' }).eq('id', examId).select('id').single(),
  );

  const studentAExam = await clients.studentA.from('examify_exams').select('id, status').eq('id', examId);
  record(
    'Student A',
    'can read assigned published exam',
    'one modern exam',
    studentAExam.error ? studentAExam.error.message : JSON.stringify(studentAExam.data),
    !studentAExam.error && studentAExam.data.length === 1 && studentAExam.data[0].id === examId,
  );

  await expectFailOrEmpty(
    'Student A',
    'cannot start unassigned exam',
    clients.studentA.from('exam_attempts').insert({
      exam_id: unassignedExamId,
      student_id: ids.studentA,
      attempt_number: 1,
      status: 'in_progress',
    }).select('id').single(),
  );

  const studentBDirectExam = await clients.studentB.from('examify_exams').select('id, status').eq('id', directExamId);
  record(
    'Student B',
    'can read directly assigned published exam',
    'one direct modern exam',
    studentBDirectExam.error ? studentBDirectExam.error.message : JSON.stringify(studentBDirectExam.data),
    !studentBDirectExam.error && studentBDirectExam.data.length === 1 && studentBDirectExam.data[0].id === directExamId,
  );

  await expectFailOrEmpty(
    'Student B',
    'cannot read unassigned exam in same institution',
    clients.studentB.from('examify_exams').select('id').eq('id', examId),
  );

  await expectFailOrEmpty(
    'Student Other Institution',
    'cannot read institution A exam',
    clients.studentOtherInst.from('examify_exams').select('id').eq('id', examId),
  );

  const attemptResult = await expectOk(
    'Student A',
    'start modern attempt',
    clients.studentA.from('exam_attempts').insert({
      exam_id: examId,
      student_id: ids.studentA,
      attempt_number: 1,
      status: 'in_progress',
    }).select('id').single(),
  );
  const attemptId = attemptResult.data.id;

  await expectFailOrEmpty(
    'Student A',
    'cannot start own attempt with grading fields',
    clients.studentA.from('exam_attempts').insert({
      exam_id: examId,
      student_id: ids.studentA,
      attempt_number: 2,
      status: 'in_progress',
      score: 1,
      score_percentage: 100,
      is_result_published: true,
    }).select('id').single(),
  );

  await expectFailOrEmpty(
    'Student A',
    'cannot create attempt for Student B',
    clients.studentA.from('exam_attempts').insert({
      exam_id: directExamId,
      student_id: ids.studentB,
      attempt_number: 1,
      status: 'in_progress',
    }).select('id').single(),
  );

  const directAttemptResult = await expectOk(
    'Student B',
    'start directly assigned modern attempt',
    clients.studentB.from('exam_attempts').insert({
      exam_id: directExamId,
      student_id: ids.studentB,
      attempt_number: 1,
      status: 'in_progress',
    }).select('id').single(),
  );
  const directAttemptId = directAttemptResult.data.id;

  await expectFailOrEmpty(
    'Student B',
    'cannot start unassigned attempt',
    clients.studentB.from('exam_attempts').insert({
      exam_id: examId,
      student_id: ids.studentB,
      attempt_number: 1,
      status: 'in_progress',
    }).select('id').single(),
  );

  await expectFailOrEmpty(
    'anon',
    'cannot start attempt',
    anon.from('exam_attempts').insert({
      exam_id: examId,
      student_id: ids.studentA,
      attempt_number: 2,
      status: 'in_progress',
    }).select('id').single(),
  );

  const answerResult = await expectOk(
    'Student A',
    'save answer linked to own attempt',
    clients.studentA.from('answers').insert({
      attempt_id: attemptId,
      question_id: questionId,
      option_id: optionId,
    }).select('id').single(),
  );
  const answerId = answerResult.data.id;

  await expectFailOrEmpty(
    'Student A',
    'cannot write answer grading fields',
    clients.studentA.from('answers').insert({
      attempt_id: attemptId,
      question_id: questionId,
      option_id: optionId,
      is_correct: true,
      awarded_points: 1,
    }).select('id').single(),
  );

  await expectFailOrEmpty(
    'Student A',
    'cannot save answer inside another student attempt',
    clients.studentA.from('answers').insert({
      attempt_id: directAttemptId,
      question_id: questionId,
      option_id: optionId,
    }).select('id').single(),
  );

  await expectFailOrEmpty(
    'Student B',
    'cannot update Student A answer',
    clients.studentB.from('answers').update({ text_answer: 'tamper' }).eq('id', answerId).select('id').single(),
  );

  await expectOk(
    'Student A',
    'submit modern attempt through atomic RPC',
    clients.studentA.rpc('submit_exam_attempt', {
      p_attempt_id: attemptId,
      p_answers: [{ question_id: questionId, option_id: optionId }],
      p_auto: false,
      p_time_remaining_seconds: 120,
    }),
  );

  const submittedSummary = psql(`
    select status || ':' || score::text || ':' || score_percentage::text || ':' || is_result_published::text
    from public.exam_attempts
    where id = ${sqlValue(attemptId)}::uuid;
  `);
  record(
    'Database',
    'objective-only atomic submit autogrades and publishes',
    'approved:1.00:100.00:true',
    submittedSummary,
    submittedSummary === 'approved:1.00:100.00:true',
  );

  await expectFailOrEmpty(
    'Student A',
    'cannot change score after atomic submission',
    clients.studentA.from('exam_attempts').update({
      score: 1,
    }).eq('id', attemptId).select('id').single(),
  );

  await expectFailOrEmpty(
    'Student A',
    'cannot change score percentage after atomic submission',
    clients.studentA.from('exam_attempts').update({
      score_percentage: 100,
    }).eq('id', attemptId).select('id').single(),
  );

  await expectFailOrEmpty(
    'Student A',
    'cannot publish own result',
    clients.studentA.from('exam_attempts').update({
      is_result_published: true,
    }).eq('id', attemptId).select('id').single(),
  );

  await expectFailOrEmpty(
    'Student A',
    'cannot update attempt after submission',
    clients.studentA.from('exam_attempts').update({
      time_remaining_seconds: 999,
    }).eq('id', attemptId).select('id').single(),
  );

  await expectFailOrEmpty(
    'Student A',
    'cannot update answer after submission',
    clients.studentA.from('answers').update({
      text_answer: 'late change',
    }).eq('id', answerId).select('id').single(),
  );

  await expectFailOrEmpty(
    'Student A',
    'cannot start second attempt when max_attempts is one',
    clients.studentA.from('exam_attempts').insert({
      exam_id: examId,
      student_id: ids.studentA,
      attempt_number: 2,
      status: 'in_progress',
    }).select('id').single(),
  );

  const graderRead = await clients.graderA.from('exam_attempts').select('id').eq('id', attemptId);
  record(
    'Grader A',
    'can read institution A attempt',
    'one attempt',
    graderRead.error ? graderRead.error.message : JSON.stringify(graderRead.data),
    !graderRead.error && graderRead.data.length === 1,
  );

  await expectOk(
    'Grader A',
    'grade modern attempt inside institution A',
    clients.graderA.from('exam_attempts').update({
      status: 'graded',
      score: 1,
      score_percentage: 100,
      is_passed: true,
      graded_by: users.graderA.id,
      graded_at: new Date().toISOString(),
    }).eq('id', attemptId).select('id, status').single(),
  );

  await expectOk(
    'School Admin A',
    'publish result from modern attempt',
    clients.adminA.from('exam_attempts').update({
      status: 'approved',
      is_result_published: true,
      approved_by: users.adminA.id,
      approved_at: new Date().toISOString(),
    }).eq('id', attemptId).select('id, status, is_result_published').single(),
  );

  await expectFailOrEmpty(
    'School Admin B',
    'cannot read institution A attempt',
    clients.adminB.from('exam_attempts').select('id').eq('id', attemptId),
  );

  await expectFailOrEmpty(
    'School Admin B',
    'cannot grade institution A attempt',
    clients.adminB.from('exam_attempts').update({
      score: 0,
      score_percentage: 0,
    }).eq('id', attemptId).select('id').single(),
  );

  await expectFailOrEmpty(
    'anon',
    'cannot read modern result',
    anon.from('exam_attempts').select('id, score').eq('id', attemptId),
  );

  const counts = {
    examify_exams: Number(psql(`select count(*) from public.examify_exams where id = ${sqlValue(examId)}::uuid;`)),
    exam_assignments: Number(psql(`select count(*) from public.exam_assignments where exam_id = ${sqlValue(examId)}::uuid;`)),
    exam_attempts: Number(psql(`select count(*) from public.exam_attempts where id = ${sqlValue(attemptId)}::uuid;`)),
    answers: Number(psql(`select count(*) from public.answers where attempt_id = ${sqlValue(attemptId)}::uuid;`)),
    submissions_delta: Number(psql(`select count(*) from public.submissions;`)) - legacyBefore,
    exams_delta: Number(psql(`select count(*) from public.exams;`)) - legacyExamsBefore,
  };
  record(
    'Database',
    'canonical path writes only modern exam tables',
    'modern counts > 0 and submissions_delta=0 and exams_delta=0',
    JSON.stringify(counts),
    counts.examify_exams === 1 && counts.exam_assignments >= 2 && counts.exam_attempts === 1 && counts.answers === 1 && counts.submissions_delta === 0 && counts.exams_delta === 0,
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.account} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`EXAMS_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
