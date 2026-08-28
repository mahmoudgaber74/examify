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

const results = [];
const run = Date.now().toString(36);
const ids = {
  instA: randomUUID(),
  instB: randomUUID(),
  subjectA: randomUUID(),
  subjectB: randomUUID(),
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

function rpcPayload(overrides = {}) {
  return {
    p_question_id: null,
    p_institution_id: ids.instA,
    p_subject_id: ids.subjectA,
    p_prompt: `QB API ${run}`,
    p_difficulty: 'medium',
    p_points: 2,
    p_unit: null,
    p_lesson: null,
    p_explanation: 'API explanation',
    p_metadata: {},
    p_options: [
      { label: 'Alpha', is_correct: true },
      { label: 'Beta', is_correct: false },
    ],
    ...overrides,
  };
}

async function main() {
  const users = {
    adminA: await createUser('qb-admin-a'),
    adminB: await createUser('qb-admin-b'),
  };
  const clients = {
    adminA: signedClient(users.adminA),
    adminB: signedClient(users.adminB),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, ${sqlValue(`QB API School A ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, ${sqlValue(`QB API School B ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`QB Admin A ${run}`)}, 'school_admin', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`QB Admin B ${run}`)}, 'school_admin', true);

    insert into public.subjects (id, institution_id, name, code, is_active)
    values
      (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`QB Subject A ${run}`)}, ${sqlValue(`QB-A-${run}`)}, true),
      (${sqlValue(ids.subjectB)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`QB Subject B ${run}`)}, ${sqlValue(`QB-B-${run}`)}, true);
  `);

  await expectFailOrEmpty(
    'School Admin A',
    'rejects invalid new MCQ without creating a partial question',
    clients.adminA.rpc('save_multiple_choice_question', rpcPayload({
      p_prompt: `QB invalid create ${run}`,
      p_options: [{ label: 'Only option', is_correct: true }],
    })),
  );

  const invalidCreateCount = Number(psql(`select count(*) from public.questions where prompt = ${sqlValue(`QB invalid create ${run}`)};`));
  record('Database', 'invalid create left no question row', '0', String(invalidCreateCount), invalidCreateCount === 0);

  const createResult = await expectOk(
    'School Admin A',
    'creates valid MCQ through atomic RPC',
    clients.adminA.rpc('save_multiple_choice_question', rpcPayload()),
  );
  const questionId = createResult.data.question.id;

  const optionCount = Number(psql(`select count(*) from public.question_options where question_id = ${sqlValue(questionId)}::uuid;`));
  record('Database', 'valid create stored two options', '2', String(optionCount), optionCount === 2);

  await expectFailOrEmpty(
    'School Admin A',
    'rejects invalid edit without deleting old options',
    clients.adminA.rpc('save_multiple_choice_question', rpcPayload({
      p_question_id: questionId,
      p_prompt: `QB invalid edit ${run}`,
      p_options: [
        { label: ' ', is_correct: false },
        { label: 'Valid label', is_correct: false },
      ],
    })),
  );

  const afterFailedEdit = psql(`
    select prompt || '|' || count(o.id)::text
    from public.questions q
    left join public.question_options o on o.question_id = q.id
    where q.id = ${sqlValue(questionId)}::uuid
    group by q.prompt;
  `);
  record(
    'Database',
    'failed edit preserved prompt and options',
    `QB API ${run}|2`,
    afterFailedEdit,
    afterFailedEdit === `QB API ${run}|2`,
  );

  await expectOk(
    'School Admin A',
    'updates valid MCQ and replaces options',
    clients.adminA.rpc('save_multiple_choice_question', rpcPayload({
      p_question_id: questionId,
      p_prompt: `QB updated ${run}`,
      p_options: [
        { label: 'Gamma', is_correct: false },
        { label: 'Delta', is_correct: true },
        { label: 'Epsilon', is_correct: false },
      ],
    })),
  );

  const updatedOptions = psql(`
    select string_agg(label || ':' || is_correct::text, ',' order by sort_order)
    from public.question_options
    where question_id = ${sqlValue(questionId)}::uuid;
  `);
  record(
    'Database',
    'valid edit replaced options exactly',
    'Gamma:false,Delta:true,Epsilon:false',
    updatedOptions,
    updatedOptions === 'Gamma:false,Delta:true,Epsilon:false',
  );

  const orphanCount = Number(psql(`
    select count(*)
    from public.question_options qo
    left join public.questions q on q.id = qo.question_id
    where q.id is null;
  `));
  record('Database', 'no orphaned question options exist', '0', String(orphanCount), orphanCount === 0);

  await expectFailOrEmpty(
    'School Admin B',
    'cannot read institution A question through RLS',
    clients.adminB.from('questions').select('id').eq('id', questionId),
  );

  await expectFailOrEmpty(
    'School Admin B',
    'cannot edit institution A question through RPC',
    clients.adminB.rpc('save_multiple_choice_question', rpcPayload({
      p_question_id: questionId,
      p_institution_id: ids.instB,
      p_subject_id: ids.subjectB,
      p_prompt: `QB cross tenant edit ${run}`,
    })),
  );

  const afterCrossTenantEdit = psql(`select prompt from public.questions where id = ${sqlValue(questionId)}::uuid;`);
  record(
    'Database',
    'cross-tenant edit did not change question',
    `QB updated ${run}`,
    afterCrossTenantEdit,
    afterCrossTenantEdit === `QB updated ${run}`,
  );

  psql(`delete from public.institutions where id in (${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.instB)}::uuid);`);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.account} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`QUESTIONBANK_API_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
