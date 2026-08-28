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
  studentA: randomUUID(),
  studentB: randomUUID(),
  parentA: randomUUID(),
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

async function main() {
  const users = {
    adminA: await createUser('students-admin-a'),
    teacherA: await createUser('students-teacher-a'),
    studentA: await createUser('students-student-a'),
    parentA: await createUser('students-parent-a'),
    adminB: await createUser('students-admin-b'),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, 'Students School A', 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, 'Students School B', 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Admin A', 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Teacher A', 'teacher', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Admin B', 'school_admin', true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, full_name_en, is_active, status)
    values
      (${sqlValue(ids.studentA)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`STA-${run}`)}, 'Student Alpha', null, true, 'active'),
      (${sqlValue(ids.studentB)}::uuid, null, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`STB-${run}`)}, 'Student Beta', null, true, 'active');

    insert into public.parent_profiles (id, user_id, institution_id, full_name, phone, is_active)
    values (${sqlValue(ids.parentA)}::uuid, ${sqlValue(users.parentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Parent A', '+100000000', true);

    insert into public.parent_student_links (parent_id, student_id, relationship)
    values (${sqlValue(ids.parentA)}::uuid, ${sqlValue(ids.studentA)}::uuid, 'father');
  `);

  const clients = {
    adminA: signedClient(users.adminA),
    teacherA: signedClient(users.teacherA),
    studentA: signedClient(users.studentA),
    parentA: signedClient(users.parentA),
    adminB: signedClient(users.adminB),
  };

  const pageSelect = 'id, institution_id, full_name, full_name_en, student_code, phone, avatar_url, grade_level_id, is_active';

  const adminA = await clients.adminA.from('student_profiles').select(pageSelect).eq('institution_id', ids.instA).order('full_name');
  record(
    'School Admin A',
    'open student list with full_name source',
    'Student Alpha only',
    adminA.error ? adminA.error.message : JSON.stringify(adminA.data),
    !adminA.error && adminA.data.length === 1 && adminA.data[0].full_name === 'Student Alpha' && adminA.data[0].institution_id === ids.instA,
  );

  const teacherA = await clients.teacherA.from('student_profiles').select(pageSelect).eq('institution_id', ids.instA).order('full_name');
  record(
    'Teacher A',
    'select institution A students',
    'Student Alpha only',
    teacherA.error ? teacherA.error.message : JSON.stringify(teacherA.data),
    !teacherA.error && teacherA.data.length === 1 && teacherA.data[0].institution_id === ids.instA,
  );

  const adminACross = await clients.adminA.from('student_profiles').select(pageSelect).eq('institution_id', ids.instB);
  record(
    'School Admin A',
    'cannot see institution B students',
    'empty',
    adminACross.error ? adminACross.error.message : JSON.stringify(adminACross.data),
    !adminACross.error && adminACross.data.length === 0,
  );

  const studentList = await clients.studentA.from('student_profiles').select(pageSelect).neq('id', ids.studentA);
  record(
    'Student A',
    'cannot read other students',
    'empty',
    studentList.error ? studentList.error.message : JSON.stringify(studentList.data),
    !studentList.error && studentList.data.length === 0,
  );

  const parentList = await clients.parentA.from('student_profiles').select(pageSelect);
  record(
    'Parent A',
    'can only read linked child',
    'Student Alpha only',
    parentList.error ? parentList.error.message : JSON.stringify(parentList.data),
    !parentList.error && parentList.data.length === 1 && parentList.data[0].id === ids.studentA,
  );

  const adminB = await clients.adminB.from('student_profiles').select(pageSelect).eq('institution_id', ids.instB);
  record(
    'School Admin B',
    'can see B without A',
    'Student Beta only',
    adminB.error ? adminB.error.message : JSON.stringify(adminB.data),
    !adminB.error && adminB.data.length === 1 && adminB.data[0].id === ids.studentB,
  );

  const anonRead = await anon.from('student_profiles').select(pageSelect);
  record(
    'anon',
    'cannot read student profiles',
    'fail or empty',
    anonRead.error ? anonRead.error.message : JSON.stringify(anonRead.data),
    Boolean(anonRead.error) || anonRead.data.length === 0,
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.account} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`STUDENTS_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
