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
  subjectA: randomUUID(),
  subjectB: randomUUID(),
  studentAProfile: randomUUID(),
  studentBProfile: randomUUID(),
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

function configFor(type) {
  if (type === 'fill_blank') {
    return {
      partial_credit: true,
      blanks: [
        { id: 'blank_1', accepted_answers: ['القاهرة', 'cairo'], case_sensitive: false, ignore_extra_spaces: true },
        { id: 'blank_2', accepted_answers: ['النيل'], case_sensitive: false, ignore_extra_spaces: true },
      ],
    };
  }
  if (type === 'matching') {
    return {
      partial_credit: true,
      one_to_one: true,
      pairs: [
        { left_id: 'left_1', left: 'مصر', right_id: 'right_1', right: 'القاهرة' },
        { left_id: 'left_2', left: 'السعودية', right_id: 'right_2', right: 'الرياض' },
      ],
    };
  }
  return {
    partial_credit: true,
    items: [
      { id: 'item_1', label: 'افتح الملف' },
      { id: 'item_2', label: 'اقرأ السؤال' },
      { id: 'item_3', label: 'اكتب الإجابة' },
    ],
  };
}

function invalidConfigFor(type) {
  if (type === 'fill_blank') return { blanks: [{ id: 'blank_1', accepted_answers: [''] }] };
  if (type === 'matching') return { pairs: [{ left_id: 'left_1', left: 'أ', right_id: 'right_1', right: '' }] };
  return { items: [{ id: 'item_1', label: 'واحد' }] };
}

function savePayload(type, overrides = {}) {
  return {
    p_question_id: null,
    p_institution_id: ids.instA,
    p_subject_id: ids.subjectA,
    p_type: type,
    p_prompt: `Advanced ${type} ${run}`,
    p_difficulty: 'medium',
    p_points: 2,
    p_unit: null,
    p_lesson: null,
    p_explanation: `${type} explanation`,
    p_metadata: {},
    p_config: configFor(type),
    ...overrides,
  };
}

async function expectOk(area, operation, promise) {
  const { data, error } = await promise;
  record(area, operation, 'success', error ? error.message : 'success', !error);
  return { data, error };
}

async function expectFailOrEmpty(area, operation, promise) {
  const { data, error } = await promise;
  const blocked = Boolean(error) || data === null || (Array.isArray(data) && data.length === 0);
  record(area, operation, 'fail or empty', error ? error.message : JSON.stringify(data), blocked);
  return { data, error };
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
    p_time_remaining_seconds: 300,
  });
}

function seedExam(examId, title, questionIds) {
  psql(`
    insert into public.examify_exams (
      id, institution_id, subject_id, class_id, title, total_points,
      passing_score, duration_minutes, max_attempts, show_result_immediately,
      show_correct_answers, status
    )
    values (${sqlValue(examId)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(title)}, 6, 50, 30, 5, true, true, 'published');

    insert into public.exam_assignments (exam_id, class_id)
    values (${sqlValue(examId)}::uuid, ${sqlValue(ids.classA)}::uuid);

    ${questionIds.map((questionId, index) => `
      insert into public.exam_questions (exam_id, question_id, points, sort_order)
      values (${sqlValue(examId)}::uuid, ${sqlValue(questionId)}::uuid, 2, ${index});
    `).join('\n')}
  `);
}

async function main() {
  const users = {
    adminA: await createUser('advanced-admin-a'),
    adminB: await createUser('advanced-admin-b'),
    studentA: await createUser('advanced-student-a'),
    studentB: await createUser('advanced-student-b'),
  };
  const clients = {
    adminA: signedClient(users.adminA),
    adminB: signedClient(users.adminB),
    studentA: signedClient(users.studentA),
    studentB: signedClient(users.studentB),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, ${sqlValue(`Advanced A ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, ${sqlValue(`Advanced B ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Advanced Admin A ${run}`)}, 'school_admin', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`Advanced Admin B ${run}`)}, 'school_admin', true);

    insert into public.grade_levels (id, institution_id, name, sort_order)
    values (${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Grade ${run}`)}, 1);

    insert into public.classes (id, institution_id, grade_level_id, name, is_active)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.gradeA)}::uuid, ${sqlValue(`Class ${run}`)}, true);

    insert into public.sections (id, class_id, name, is_active)
    values (${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Section ${run}`)}, true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, grade_level_id, is_active, status)
    values
      (${sqlValue(ids.studentAProfile)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`ASA-${run}`)}, ${sqlValue(`Advanced Student A ${run}`)}, ${sqlValue(ids.gradeA)}::uuid, true, 'active'),
      (${sqlValue(ids.studentBProfile)}::uuid, ${sqlValue(users.studentB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`ASB-${run}`)}, ${sqlValue(`Advanced Student B ${run}`)}, null, true, 'active');

    insert into public.class_students (class_id, section_id, student_id)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid);

    insert into public.subjects (id, institution_id, name, code, is_active)
    values
      (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Advanced Subject A ${run}`)}, ${sqlValue(`ADV-A-${run}`)}, true),
      (${sqlValue(ids.subjectB)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`Advanced Subject B ${run}`)}, ${sqlValue(`ADV-B-${run}`)}, true);
  `);

  const questionIds = {};
  for (const type of ['fill_blank', 'matching', 'ordering']) {
    await expectFailOrEmpty(
      type,
      'invalid create is rejected atomically',
      clients.adminA.rpc('save_advanced_question', savePayload(type, {
        p_prompt: `Invalid advanced ${type} ${run}`,
        p_config: invalidConfigFor(type),
      })),
    );
    const invalidCount = Number(psql(`select count(*) from public.questions where prompt = ${sqlValue(`Invalid advanced ${type} ${run}`)};`));
    record(type, 'invalid create left no question row', '0', String(invalidCount), invalidCount === 0);

    const createResult = await expectOk(type, 'creates advanced question through RPC', clients.adminA.rpc('save_advanced_question', savePayload(type)));
    questionIds[type] = createResult.data.question.id;

    await expectFailOrEmpty(
      type,
      'invalid edit preserves previous data',
      clients.adminA.rpc('save_advanced_question', savePayload(type, {
        p_question_id: questionIds[type],
        p_prompt: `Broken edit ${type} ${run}`,
        p_config: invalidConfigFor(type),
      })),
    );
    const preserved = psql(`select prompt from public.questions where id = ${sqlValue(questionIds[type])}::uuid;`);
    record(type, 'failed edit kept old prompt', `Advanced ${type} ${run}`, preserved, preserved === `Advanced ${type} ${run}`);

    await expectOk(
      type,
      'valid edit updates question and config',
      clients.adminA.rpc('save_advanced_question', savePayload(type, {
        p_question_id: questionIds[type],
        p_prompt: `Advanced edited ${type} ${run}`,
      })),
    );
  }

  const optionRowsForAdvanced = Number(psql(`select count(*) from public.question_options where question_id in (${Object.values(questionIds).map((id) => `${sqlValue(id)}::uuid`).join(',')});`));
  record('Storage', 'advanced questions do not use question_options', '0', String(optionRowsForAdvanced), optionRowsForAdvanced === 0);

  const exams = { full: randomUUID(), partial: randomUUID(), wrong: randomUUID() };
  seedExam(exams.full, `Advanced full ${run}`, Object.values(questionIds));
  seedExam(exams.partial, `Advanced partial ${run}`, Object.values(questionIds));
  seedExam(exams.wrong, `Advanced wrong ${run}`, Object.values(questionIds));

  const fullAttempt = await createAttempt(clients.studentA, exams.full);
  const fullRes = await submit(clients.studentA, fullAttempt, [
    { question_id: questionIds.fill_blank, answer_payload: { blanks: { blank_1: '  القاهرة  ', blank_2: 'النيل' } } },
    { question_id: questionIds.matching, answer_payload: { matches: { left_1: 'right_1', left_2: 'right_2' } } },
    { question_id: questionIds.ordering, answer_payload: { order: ['item_1', 'item_2', 'item_3'] } },
  ]);
  record('Grading', 'full advanced answers are auto-approved with full score', 'approved|6|100|true', fullRes.error?.message ?? `${fullRes.data?.status}|${fullRes.data?.score}|${Math.round(fullRes.data?.score_percentage)}|${fullRes.data?.is_passed}`, !fullRes.error && fullRes.data.status === 'approved' && Number(fullRes.data.score) === 6 && Math.round(Number(fullRes.data.score_percentage)) === 100 && fullRes.data.is_passed === true);

  const partialAttempt = await createAttempt(clients.studentA, exams.partial);
  const partialRes = await submit(clients.studentA, partialAttempt, [
    { question_id: questionIds.fill_blank, answer_payload: { blanks: { blank_1: 'cairo', blank_2: 'خطأ' } } },
    { question_id: questionIds.matching, answer_payload: { matches: { left_1: 'right_1', left_2: 'right_1' } } },
    { question_id: questionIds.ordering, answer_payload: { order: ['item_1', 'item_3', 'item_2'] } },
  ]);
  record('Grading', 'partial advanced answers receive deterministic partial score', 'score=1.67 pct=28', partialRes.error?.message ?? `score=${Number(partialRes.data?.score).toFixed(2)} pct=${Math.round(partialRes.data?.score_percentage)}`, !partialRes.error && Number(partialRes.data.score).toFixed(2) === '1.67' && Math.round(Number(partialRes.data.score_percentage)) === 28);

  const wrongAttempt = await createAttempt(clients.studentA, exams.wrong);
  const wrongRes = await submit(clients.studentA, wrongAttempt, [
    { question_id: questionIds.fill_blank, answer_payload: { blanks: { blank_1: 'خطأ', blank_2: 'خطأ' } } },
    { question_id: questionIds.matching, answer_payload: { matches: { left_1: 'right_2', left_2: 'right_1' } } },
    { question_id: questionIds.ordering, answer_payload: { order: ['item_2', 'item_3', 'item_1'] } },
  ]);
  record('Grading', 'wrong advanced answers are auto-approved with zero score', 'approved|0|false', wrongRes.error?.message ?? `${wrongRes.data?.status}|${wrongRes.data?.score}|${wrongRes.data?.is_passed}`, !wrongRes.error && wrongRes.data.status === 'approved' && Number(wrongRes.data.score) === 0 && wrongRes.data.is_passed === false);

  const payloadStored = Number(psql(`select count(*) from public.answers where attempt_id = ${sqlValue(fullAttempt)}::uuid and answer_payload is not null;`));
  record('Storage', 'student complex answers are stored in answer_payload', '3', String(payloadStored), payloadStored === 3);

  await expectFailOrEmpty(
    'RLS',
    'school admin B cannot read institution A advanced question',
    clients.adminB.from('questions').select('id').eq('id', questionIds.fill_blank),
  );
  await expectFailOrEmpty(
    'RLS',
    'school admin B cannot edit institution A advanced question',
    clients.adminB.rpc('save_advanced_question', savePayload('fill_blank', {
      p_question_id: questionIds.fill_blank,
      p_institution_id: ids.instB,
      p_subject_id: ids.subjectB,
    })),
  );
  const crossTenantSubmit = await submit(clients.studentB, fullAttempt, []);
  record('RLS', 'student B cannot submit student A attempt', 'error', crossTenantSubmit.error ? crossTenantSubmit.error.message : 'success', Boolean(crossTenantSubmit.error));

  const orphanAnswers = Number(psql(`
    select count(*)
    from public.answers a
    left join public.exam_attempts ea on ea.id = a.attempt_id
    left join public.questions q on q.id = a.question_id
    where ea.id is null or q.id is null;
  `));
  record('Integrity', 'no orphaned answers exist', '0', String(orphanAnswers), orphanAnswers === 0);

  psql(`
    delete from public.institutions where id in (${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.instB)}::uuid);
    delete from auth.users where id in (${Object.values(users).map((user) => `${sqlValue(user.id)}::uuid`).join(',')});
  `);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.area} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`ADVANCED_QUESTION_TYPES_API_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
