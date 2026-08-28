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
  branchA: randomUUID(),
  gradeA: randomUUID(),
  classA: randomUUID(),
  sectionA: randomUUID(),
  subjectA: randomUUID(),
  subjectB: randomUUID(),
  studentA: randomUUID(),
  studentB: randomUUID(),
  parentA: randomUUID(),
  gradeBookA: randomUUID(),
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
    adminA: await createUser('sis-admin-a'),
    adminB: await createUser('sis-admin-b'),
    dataEntryA: await createUser('sis-data-entry-a'),
    teacherA: await createUser('sis-teacher-a'),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, ${sqlValue(`SIS API A ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, ${sqlValue(`SIS API B ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`SIS Admin A ${run}`)}, 'school_admin', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`SIS Admin B ${run}`)}, 'school_admin', true),
      (${sqlValue(users.dataEntryA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`SIS Data Entry A ${run}`)}, 'data_entry', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`SIS Teacher A ${run}`)}, 'teacher', true);

    insert into public.subjects (id, institution_id, name, code, is_active)
    values
      (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`SIS Subject A ${run}`)}, ${sqlValue(`SISA-${run}`)}, true),
      (${sqlValue(ids.subjectB)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`SIS Subject B ${run}`)}, ${sqlValue(`SISB-${run}`)}, true);

    insert into public.student_profiles (id, institution_id, student_code, full_name, is_active, status)
    values (${sqlValue(ids.studentB)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`SISB-ST-${run}`)}, ${sqlValue(`SIS Student B ${run}`)}, true, 'active');
  `);

  const adminA = signedClient(users.adminA);
  const adminB = signedClient(users.adminB);
  const dataEntryA = signedClient(users.dataEntryA);
  const teacherA = signedClient(users.teacherA);

  await expectOk('school_admin', 'creates branch', adminA.from('branches').insert({ id: ids.branchA, institution_id: ids.instA, name: `SIS Branch ${run}`, is_active: true }).select('id').single());
  await expectOk('school_admin', 'creates grade level', adminA.from('grade_levels').insert({ id: ids.gradeA, institution_id: ids.instA, name: `SIS Grade ${run}`, sort_order: 1, is_active: true }).select('id').single());
  await expectOk('school_admin', 'creates class linked to grade and branch', adminA.from('classes').insert({ id: ids.classA, institution_id: ids.instA, name: `SIS Class ${run}`, grade_level_id: ids.gradeA, branch_id: ids.branchA, academic_year: '2026-2027', is_active: true }).select('id').single());
  await expectOk('school_admin', 'creates section linked to class', adminA.from('sections').insert({ id: ids.sectionA, class_id: ids.classA, name: `SIS Section ${run}`, capacity: 30, is_active: true }).select('id').single());

  await expectOk('data_entry', 'creates student', dataEntryA.from('student_profiles').insert({ id: ids.studentA, institution_id: ids.instA, student_code: `SISA-ST-${run}`, full_name: `SIS Student A ${run}`, grade_level_id: ids.gradeA, is_active: true, status: 'active' }).select('id').single());
  await expectOk('data_entry', 'updates student', dataEntryA.from('student_profiles').update({ seat_number: `SEAT-${run}` }).eq('id', ids.studentA).select('id').single());
  await expectOk('data_entry', 'links student to class and section', dataEntryA.from('class_students').insert({ class_id: ids.classA, section_id: ids.sectionA, student_id: ids.studentA }).select('id').single());
  await expectOk('data_entry', 'creates parent', dataEntryA.from('parent_profiles').insert({ id: ids.parentA, institution_id: ids.instA, full_name: `SIS Parent ${run}`, phone: '0500000000', is_active: true }).select('id').single());
  await expectOk('data_entry', 'links parent to student', dataEntryA.from('parent_student_links').insert({ parent_id: ids.parentA, student_id: ids.studentA, relationship: 'parent' }).select('id').single());
  await expectBlocked('data_entry', 'prevents duplicate parent-student relation', dataEntryA.from('parent_student_links').insert({ parent_id: ids.parentA, student_id: ids.studentA, relationship: 'parent' }).select('id'));
  await expectBlocked('data_entry', 'cannot link parent to another institution student', dataEntryA.from('parent_student_links').insert({ parent_id: ids.parentA, student_id: ids.studentB, relationship: 'parent' }).select('id'));
  await expectBlocked('data_entry', 'cannot manage subjects', dataEntryA.from('subjects').insert({ institution_id: ids.instA, name: `Blocked Subject ${run}`, code: `BLOCK-${run}` }).select('id'));
  await expectBlocked('data_entry', 'cannot create grades', dataEntryA.from('grade_book').insert({ id: ids.gradeBookA, institution_id: ids.instA, student_id: ids.studentA, subject_id: ids.subjectA, assessment_title: 'Blocked', score: 10, max_score: 100 }).select('id'));

  await expectIds('teacher', 'can read institution students', teacherA.from('student_profiles').select('id').in('id', [ids.studentA, ids.studentB]), [ids.studentA]);
  await expectBlocked('teacher', 'cannot create student', teacherA.from('student_profiles').insert({ institution_id: ids.instA, full_name: `Teacher Student ${run}`, student_code: `T-${run}` }).select('id'));
  await expectBlocked('teacher', 'cannot update student', teacherA.from('student_profiles').update({ full_name: `Blocked Teacher ${run}` }).eq('id', ids.studentA).select('id'));
  await expectBlocked('teacher', 'cannot create grades from SIS API', teacherA.from('grade_book').insert({ institution_id: ids.instA, student_id: ids.studentA, subject_id: ids.subjectA, assessment_title: 'Teacher Grade', score: 10, max_score: 100 }).select('id'));
  await expectBlocked('teacher', 'cannot write attendance from SIS API', teacherA.from('attendance').insert({ institution_id: ids.instA, student_id: ids.studentA, class_id: ids.classA, date: '2026-08-05', status: 'present' }).select('id'));

  await expectIds('institution isolation', 'admin A cannot read institution B students', adminA.from('student_profiles').select('id').eq('id', ids.studentB), []);
  await expectBlocked('institution isolation', 'admin B cannot update institution A student', adminB.from('student_profiles').update({ full_name: `Blocked Admin B ${run}` }).eq('id', ids.studentA).select('id'));
  await expectBlocked('integrity', 'prevents class from another institution grade', adminB.from('classes').insert({ institution_id: ids.instB, grade_level_id: ids.gradeA, name: `Bad Class ${run}`, academic_year: '2026-2027' }).select('id'));

  const orphanClassLinks = Number(psql(`
    select count(*)
    from public.class_students cs
    left join public.student_profiles sp on sp.id = cs.student_id
    left join public.classes c on c.id = cs.class_id
    where sp.id is null or c.id is null;
  `));
  record('integrity', 'no orphan class-student links exist', '0', String(orphanClassLinks), orphanClassLinks === 0);

  psql(`
    delete from public.institutions where id in (${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.instB)}::uuid);
    delete from auth.users where id in (${Object.values(users).map((user) => `${sqlValue(user.id)}::uuid`).join(', ')});
  `);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.area} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`SIS_API_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
