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
  createdInst: randomUUID(),
  branchA: randomUUID(),
  createdBranch: randomUUID(),
  linkedStudent: randomUUID(),
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

async function expectOk(area, operation, promise) {
  const { data, error } = await promise;
  record(area, operation, 'success', error ? error.message : 'success', !error);
  return { data, error };
}

async function expectBlocked(area, operation, promise) {
  const { data, error } = await promise;
  const blocked = Boolean(error) || data === null || (Array.isArray(data) && data.length === 0);
  record(area, operation, 'blocked or empty', error ? error.message : JSON.stringify(data), blocked);
  return { data, error };
}

async function expectIds(area, operation, promise, expectedIds) {
  const { data, error } = await promise;
  const actual = Array.isArray(data) ? data.map((row) => row.id).sort() : [];
  const expected = [...expectedIds].sort();
  record(area, operation, JSON.stringify(expected), error ? error.message : JSON.stringify(actual), !error && JSON.stringify(actual) === JSON.stringify(expected));
}

async function main() {
  const users = {
    superAdmin: await createUser('institutions-super-admin'),
    adminA: await createUser('institutions-admin-a'),
    teacherA: await createUser('institutions-teacher-a'),
    dataEntryA: await createUser('institutions-data-entry-a'),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, ${sqlValue(`Institutions API A ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, ${sqlValue(`Institutions API B ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.superAdmin.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Institutions Super ${run}`)}, 'super_admin', true),
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Institutions Admin A ${run}`)}, 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Institutions Teacher A ${run}`)}, 'teacher', true),
      (${sqlValue(users.dataEntryA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Institutions Data Entry A ${run}`)}, 'data_entry', true);

    insert into public.branches (id, institution_id, name, address, phone, is_active)
    values (${sqlValue(ids.branchA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Branch A ${run}`)}, 'Address', '0500000000', true);

    insert into public.student_profiles (id, institution_id, student_code, full_name, is_active, status)
    values (${sqlValue(ids.linkedStudent)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`IA-${run}`)}, ${sqlValue(`Linked Student ${run}`)}, true, 'active');
  `);

  const superAdmin = signedClient(users.superAdmin);
  const adminA = signedClient(users.adminA);
  const teacherA = signedClient(users.teacherA);
  const dataEntryA = signedClient(users.dataEntryA);

  await expectIds('super_admin', 'reads institution list across tenants', superAdmin.from('institutions').select('id').in('id', [ids.instA, ids.instB]), [ids.instA, ids.instB]);
  await expectOk('super_admin', 'creates institution', superAdmin.from('institutions').insert({
    id: ids.createdInst,
    name: `Created Institution ${run}`,
    subscription_plan: 'pro',
    subscription_status: 'active',
    max_students: 200,
    max_teachers: 20,
    max_exams: 50,
    is_active: true,
  }).select('id').single());
  await expectOk('super_admin', 'updates institution', superAdmin.from('institutions').update({ city: 'Riyadh', max_students: 250 }).eq('id', ids.createdInst).select('id').single());
  await expectOk('super_admin', 'creates branch for created institution', superAdmin.from('branches').insert({
    id: ids.createdBranch,
    institution_id: ids.createdInst,
    name: `Created Branch ${run}`,
    address: 'North',
    phone: '0500000001',
    is_active: true,
  }).select('id').single());
  await expectOk('super_admin', 'updates branch', superAdmin.from('branches').update({ name: `Updated Branch ${run}` }).eq('id', ids.createdBranch).select('id').single());
  await expectOk('super_admin', 'disables linked institution instead of destructive delete', superAdmin.from('institutions').update({ is_active: false }).eq('id', ids.instA).select('id').single());

  await expectIds('school_admin', 'reads own institution only', adminA.from('institutions').select('id').in('id', [ids.instA, ids.instB, ids.createdInst]), [ids.instA]);
  await expectBlocked('school_admin', 'cannot create institution', adminA.from('institutions').insert({ name: `Blocked School ${run}` }).select('id'));
  await expectBlocked('school_admin', 'cannot update another institution', adminA.from('institutions').update({ name: `Blocked ${run}` }).eq('id', ids.instB).select('id'));
  await expectOk('school_admin', 'can create branch inside own institution', adminA.from('branches').insert({ institution_id: ids.instA, name: `Admin Branch ${run}` }).select('id').single());
  await expectBlocked('school_admin', 'cannot create branch in another institution', adminA.from('branches').insert({ institution_id: ids.instB, name: `Cross Branch ${run}` }).select('id'));

  await expectBlocked('teacher', 'cannot create institution through API', teacherA.from('institutions').insert({ name: `Blocked Teacher ${run}` }).select('id'));
  await expectBlocked('teacher', 'cannot update institution through API', teacherA.from('institutions').update({ name: `Blocked Teacher ${run}` }).eq('id', ids.instA).select('id'));
  await expectBlocked('data_entry', 'cannot create institution through API', dataEntryA.from('institutions').insert({ name: `Blocked Data Entry ${run}` }).select('id'));
  await expectBlocked('data_entry', 'cannot create branch through API', dataEntryA.from('branches').insert({ institution_id: ids.instA, name: `Blocked DE Branch ${run}` }).select('id'));

  psql(`
    delete from public.institutions where id in (${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(ids.createdInst)}::uuid);
    delete from auth.users where id in (${Object.values(users).map((user) => `${sqlValue(user.id)}::uuid`).join(', ')});
  `);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.area} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`INSTITUTIONS_API_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
