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
const password = 'Examify1!';

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
  execFileSync('docker', ['exec', '-i', 'supabase_db_project', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function createUser(label) {
  const email = `${label}-${run}@example.local`;
  const id = randomUUID();
  psql(`
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (${sqlValue(id)}::uuid, 'authenticated', 'authenticated', ${sqlValue(email)}, ${sqlValue(password)}, now(), now(), now());
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

async function main() {
  const users = {
    adminA: await createUser('subjects-admin-a'),
    teacherA: await createUser('subjects-teacher-a'),
    studentA: await createUser('subjects-student-a'),
    parentA: await createUser('subjects-parent-a'),
    adminB: await createUser('subjects-admin-b'),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, 'Subjects School A', 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, 'Subjects School B', 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Admin A', 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Teacher A', 'teacher', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Admin B', 'school_admin', true);

    insert into public.student_profiles (user_id, institution_id, student_code, full_name, is_active, status)
    values (${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`SUB-ST-${run}`)}, 'Student A', true, 'active');

    insert into public.parent_profiles (user_id, institution_id, full_name, phone, is_active)
    values (${sqlValue(users.parentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Parent A', '+100000000', true);

    insert into public.subjects (id, institution_id, name, name_en, code, is_active)
    values
      (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Existing A', 'Existing A', ${sqlValue(`EXA-${run}`)}, true),
      (${sqlValue(ids.subjectB)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Existing B', 'Existing B', ${sqlValue(`EXB-${run}`)}, true);
  `);

  const clients = {
    adminA: signedClient(users.adminA),
    teacherA: signedClient(users.teacherA),
    studentA: signedClient(users.studentA),
    parentA: signedClient(users.parentA),
    adminB: signedClient(users.adminB),
  };

  const selectA = await clients.adminA.from('subjects').select('id, institution_id, code').order('code');
  record(
    'School Admin A',
    'select own tenant subjects only',
    'only institution A rows',
    selectA.error ? selectA.error.message : JSON.stringify((selectA.data ?? []).map((row) => row.institution_id)),
    !selectA.error && (selectA.data ?? []).length > 0 && (selectA.data ?? []).every((row) => row.institution_id === ids.instA),
  );

  await expectOk(
    'School Admin A',
    'insert own subject',
    clients.adminA.from('subjects').insert({
      institution_id: ids.instA,
      name: 'Physics',
      name_en: 'Physics',
      code: `PHY-${run}`,
      is_active: true,
    }).select('id').single(),
  );

  await expectFail(
    'School Admin A',
    'insert forged B subject',
    clients.adminA.from('subjects').insert({
      institution_id: ids.instB,
      name: 'Forged',
      code: `F-${run}`,
      is_active: true,
    }).select('id').single(),
  );

  await expectOk(
    'School Admin A',
    'update own subject',
    clients.adminA.from('subjects').update({ name: 'Physics Updated', is_active: false }).eq('id', ids.subjectA).select('id').single(),
  );

  await expectFail(
    'School Admin A',
    'change subject institution',
    clients.adminA.from('subjects').update({ institution_id: ids.instB }).eq('id', ids.subjectA).select('id').single(),
  );

  await expectFail(
    'School Admin B',
    'update A subject',
    clients.adminB.from('subjects').update({ name: 'Cross tenant' }).eq('id', ids.subjectA).select('id').single(),
  );

  await expectFail(
    'Teacher A',
    'insert subject',
    clients.teacherA.from('subjects').insert({
      institution_id: ids.instA,
      name: 'Teacher subject',
      code: `T-${run}`,
      is_active: true,
    }).select('id').single(),
  );

  await expectFail(
    'Teacher A',
    'update subject',
    clients.teacherA.from('subjects').update({ name: 'Teacher update' }).eq('id', ids.subjectA).select('id').single(),
  );

  await expectFail(
    'Student A',
    'insert subject',
    clients.studentA.from('subjects').insert({
      institution_id: ids.instA,
      name: 'Student subject',
      code: `S-${run}`,
      is_active: true,
    }).select('id').single(),
  );

  await expectFail(
    'Parent A',
    'update subject',
    clients.parentA.from('subjects').update({ name: 'Parent update' }).eq('id', ids.subjectA).select('id').single(),
  );

  await expectFail(
    'anon',
    'insert subject',
    anon.from('subjects').insert({
      institution_id: ids.instA,
      name: 'Anon subject',
      code: `ANON-${run}`,
      is_active: true,
    }).select('id').single(),
  );

  await expectFail(
    'School Admin A',
    'insert duplicate code',
    clients.adminA.from('subjects').insert({
      institution_id: ids.instA,
      name: 'Duplicate Code',
      code: `EXA-${run}`,
      is_active: true,
    }).select('id').single(),
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.account} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`SUBJECTS_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
