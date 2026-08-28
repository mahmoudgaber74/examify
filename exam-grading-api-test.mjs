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
  studentAProfile: randomUUID(),
  studentBProfile: randomUUID(),
  subjectA: randomUUID(),
  subjectB: randomUUID(),
};

function record(area, operation, expected, actual, passed) {
  results.push({ area, operation, expected, actual, passed });
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

function makeQuestionSql(questionId, optionA, optionB, examId, type = 'multiple_choice', points = 1) {
  const options = type === 'essay' ? '' : `
    insert into public.question_options (id, question_id, label, is_correct, sort_order)
    values
      (${sqlValue(optionA)}::uuid, ${sqlValue(questionId)}::uuid, 'A', true, 0),
      (${sqlValue(optionB)}::uuid, ${sqlValue(questionId)}::uuid, 'B', false, 1);
  `;
  return `
    insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
    values (${sqlValue(questionId)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(type)}, ${sqlValue(`Grading ${type} ${questionId}`)}, 'easy', ${points}, '{}'::jsonb);
    ${options}
    insert into public.exam_questions (exam_id, question_id, points, sort_order)
    values (${sqlValue(examId)}::uuid, ${sqlValue(questionId)}::uuid, ${points}, 0);
  `;
}

async function createAttempt(client, examId) {
  const existing = Number(psql(`select count(*) from public.exam_attempts where exam_id = ${sqlValue(examId)}::uuid and student_id = ${sqlValue(ids.studentAProfile)}::uuid;`));
  const { data, error } = await client
    .from('exam_attempts')
    .insert({ exam_id: examId, student_id: ids.studentAProfile, attempt_number: existing + 1, status: 'in_progress' })
    .select('id')
    .single();
  if (error) throw new Error(`createAttempt failed: ${error.message}`);
  return data.id;
}

async function submit(client, attemptId, answers) {
  return client.rpc('submit_exam_attempt', {
    p_attempt_id: attemptId,
    p_answers: answers,
    p_auto: false,
    p_time_remaining_seconds: 120,
  });
}

async function main() {
  const users = {
    studentA: await createUser('grading-student-a'),
    studentB: await createUser('grading-student-b'),
  };
  const clientA = signedClient(users.studentA);
  const clientB = signedClient(users.studentB);

  const exams = {
    correct: randomUUID(),
    wrong: randomUUID(),
    unanswered: randomUUID(),
    multi: randomUUID(),
    manual: randomUUID(),
    trueFalse: randomUUID(),
    otherOwned: randomUUID(),
  };
  const questions = Array.from({ length: 8 }, () => randomUUID());
  const options = Array.from({ length: 16 }, () => randomUUID());

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, ${sqlValue(`Grading API A ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, ${sqlValue(`Grading API B ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.grade_levels (id, institution_id, name, sort_order)
    values (${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Grade ${run}`)}, 1);

    insert into public.classes (id, institution_id, grade_level_id, name, is_active)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.gradeA)}::uuid, ${sqlValue(`Class ${run}`)}, true);

    insert into public.sections (id, class_id, name, is_active)
    values (${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Section ${run}`)}, true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, grade_level_id, is_active, status)
    values
      (${sqlValue(ids.studentAProfile)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`GA-${run}`)}, ${sqlValue(`Grading Student A ${run}`)}, ${sqlValue(ids.gradeA)}::uuid, true, 'active'),
      (${sqlValue(ids.studentBProfile)}::uuid, ${sqlValue(users.studentB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`GB-${run}`)}, ${sqlValue(`Grading Student B ${run}`)}, null, true, 'active');

    insert into public.class_students (class_id, section_id, student_id)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid);

    insert into public.subjects (id, institution_id, name, code, is_active)
    values
      (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Subject A ${run}`)}, ${sqlValue(`GA-${run}`)}, true),
      (${sqlValue(ids.subjectB)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`Subject B ${run}`)}, ${sqlValue(`GB-${run}`)}, true);

    ${Object.values(exams).map((examId) => `
      insert into public.examify_exams (
        id, institution_id, subject_id, class_id, title, total_points,
        passing_score, duration_minutes, max_attempts, show_result_immediately,
        show_correct_answers, status
      )
      values (${sqlValue(examId)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Grading Exam ${examId}`)}, 1, 50, 30, 3, true, true, 'published');
      insert into public.exam_assignments (exam_id, class_id)
      values (${sqlValue(examId)}::uuid, ${sqlValue(ids.classA)}::uuid);
    `).join('\n')}

    ${makeQuestionSql(questions[0], options[0], options[1], exams.correct)}
    ${makeQuestionSql(questions[1], options[2], options[3], exams.wrong)}
    ${makeQuestionSql(questions[2], options[4], options[5], exams.unanswered)}
    update public.examify_exams set total_points = 2, passing_score = 50 where id = ${sqlValue(exams.multi)}::uuid;
    ${makeQuestionSql(questions[3], options[6], options[7], exams.multi)}
    insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
    values (${sqlValue(questions[4])}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'multiple_choice', ${sqlValue(`Grading second ${run}`)}, 'easy', 1, '{}'::jsonb);
    insert into public.question_options (id, question_id, label, is_correct, sort_order)
    values (${sqlValue(options[8])}::uuid, ${sqlValue(questions[4])}::uuid, 'A', true, 0), (${sqlValue(options[9])}::uuid, ${sqlValue(questions[4])}::uuid, 'B', false, 1);
    insert into public.exam_questions (exam_id, question_id, points, sort_order)
    values (${sqlValue(exams.multi)}::uuid, ${sqlValue(questions[4])}::uuid, 1, 1);
    update public.examify_exams set total_points = 3, passing_score = 50 where id = ${sqlValue(exams.manual)}::uuid;
    ${makeQuestionSql(questions[5], options[10], options[11], exams.manual)}
    ${makeQuestionSql(questions[6], options[12], options[13], exams.manual, 'essay', 2)}
    ${makeQuestionSql(questions[7], options[14], options[15], exams.trueFalse, 'true_false')}
    ${makeQuestionSql(randomUUID(), randomUUID(), randomUUID(), exams.otherOwned)}
  `);

  const attemptCorrect = await createAttempt(clientA, exams.correct);
  const correctRes = await submit(clientA, attemptCorrect, [{ question_id: questions[0], option_id: options[0] }]);
  record('MCQ', 'correct answer is approved with full score', 'approved|1|100|true', correctRes.error?.message ?? `${correctRes.data?.status}|${correctRes.data?.score}|${Math.round(correctRes.data?.score_percentage)}|${correctRes.data?.is_passed}`, !correctRes.error && correctRes.data.status === 'approved' && Number(correctRes.data.score) === 1 && Math.round(Number(correctRes.data.score_percentage)) === 100 && correctRes.data.is_passed === true);

  const attemptWrong = await createAttempt(clientA, exams.wrong);
  const wrongRes = await submit(clientA, attemptWrong, [{ question_id: questions[1], option_id: options[3] }]);
  record('MCQ', 'wrong answer is approved with zero score', 'approved|0|0|false', wrongRes.error?.message ?? `${wrongRes.data?.status}|${wrongRes.data?.score}|${Math.round(wrongRes.data?.score_percentage)}|${wrongRes.data?.is_passed}`, !wrongRes.error && wrongRes.data.status === 'approved' && Number(wrongRes.data.score) === 0 && wrongRes.data.is_passed === false);

  const attemptUnanswered = await createAttempt(clientA, exams.unanswered);
  const unansweredRes = await submit(clientA, attemptUnanswered, []);
  const unansweredAnswer = psql(`select is_correct::text || '|' || awarded_points::text from public.answers where attempt_id = ${sqlValue(attemptUnanswered)}::uuid;`);
  record('MCQ', 'unanswered objective question receives zero and answer row', 'false|0.00', unansweredRes.error?.message ?? unansweredAnswer, unansweredAnswer === 'false|0.00' && !unansweredRes.error);

  const attemptMulti = await createAttempt(clientA, exams.multi);
  const multiRes = await submit(clientA, attemptMulti, [
    { question_id: questions[3], option_id: options[6] },
    { question_id: questions[4], option_id: options[9] },
  ]);
  record('Scoring', 'multi-question percentage and pass status are calculated', 'score=1 pct=50 pass=true', multiRes.error?.message ?? `score=${multiRes.data?.score} pct=${Math.round(multiRes.data?.score_percentage)} pass=${multiRes.data?.is_passed}`, !multiRes.error && Number(multiRes.data.score) === 1 && Math.round(Number(multiRes.data.score_percentage)) === 50 && multiRes.data.is_passed === true);

  const attemptManual = await createAttempt(clientA, exams.manual);
  const manualRes = await submit(clientA, attemptManual, [
    { question_id: questions[5], option_id: options[10] },
    { question_id: questions[6], text_answer: 'Essay answer' },
  ]);
  const manualAnswer = psql(`select count(*) from public.answers where attempt_id = ${sqlValue(attemptManual)}::uuid and is_correct is null and awarded_points is null;`);
  record('Manual', 'manual question keeps result pending review', 'submitted|manual=true|unpublished', manualRes.error?.message ?? `${manualRes.data?.status}|manual=${manualRes.data?.needs_manual_grading}|published=${manualRes.data?.is_result_published}`, !manualRes.error && manualRes.data.status === 'submitted' && manualRes.data.needs_manual_grading === true && manualRes.data.is_result_published === false && Number(manualAnswer) === 1);

  const attemptTrueFalse = await createAttempt(clientA, exams.trueFalse);
  const trueFalseRes = await submit(clientA, attemptTrueFalse, [{ question_id: questions[7], option_id: options[14] }]);
  record('TrueFalse', 'true_false answer is auto-graded through options', 'approved|1|100|true', trueFalseRes.error?.message ?? `${trueFalseRes.data?.status}|${trueFalseRes.data?.score}|${Math.round(trueFalseRes.data?.score_percentage)}|${trueFalseRes.data?.is_passed}`, !trueFalseRes.error && trueFalseRes.data.status === 'approved' && Number(trueFalseRes.data.score) === 1 && trueFalseRes.data.is_passed === true);

  const doubleSubmit = await submit(clientA, attemptCorrect, [{ question_id: questions[0], option_id: options[0] }]);
  record('Idempotency', 'second submit is rejected without duplication', 'error', doubleSubmit.error ? doubleSubmit.error.message : 'success', Boolean(doubleSubmit.error));

  const attemptOtherOwned = await createAttempt(clientA, exams.otherOwned);
  const otherStudentSubmit = await submit(clientB, attemptOtherOwned, []);
  record('RLS', 'student cannot submit another student attempt', 'error', otherStudentSubmit.error ? otherStudentSubmit.error.message : 'success', Boolean(otherStudentSubmit.error));

  const crossTenantRead = await clientB.from('exam_attempts').select('id').eq('id', attemptCorrect);
  record('RLS', 'other institution cannot read attempt', 'empty', JSON.stringify(crossTenantRead.data), !crossTenantRead.error && Array.isArray(crossTenantRead.data) && crossTenantRead.data.length === 0);

  const orphanCount = Number(psql(`
    select count(*)
    from public.answers a
    left join public.exam_attempts ea on ea.id = a.attempt_id
    left join public.questions q on q.id = a.question_id
    where ea.id is null or q.id is null;
  `));
  record('Integrity', 'no orphaned answers exist', '0', String(orphanCount), orphanCount === 0);

  const duplicateAnswers = Number(psql(`
    select count(*)
    from (
      select attempt_id, question_id, count(*)
      from public.answers
      group by attempt_id, question_id
      having count(*) > 1
    ) d;
  `));
  record('Integrity', 'no duplicate answer rows exist', '0', String(duplicateAnswers), duplicateAnswers === 0);

  const duplicateScores = Number(psql(`select count(*) from public.exam_attempts where id = ${sqlValue(attemptCorrect)}::uuid and score = 1;`));
  record('Integrity', 'score was not duplicated after rejected second submit', '1 row score=1', String(duplicateScores), duplicateScores === 1);

  psql(`
    delete from public.institutions where id in (${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.instB)}::uuid);
    delete from auth.users where id in (${sqlValue(users.studentA.id)}::uuid, ${sqlValue(users.studentB.id)}::uuid);
  `);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.area} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`EXAM_GRADING_API_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
