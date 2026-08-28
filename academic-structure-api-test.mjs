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
const password = 'Examify1!';

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
  const ids = {
    instA: randomUUID(),
    instB: randomUUID(),
    branchA: randomUUID(),
    branchB: randomUUID(),
    gradeA: randomUUID(),
    gradeB: randomUUID(),
    classA: randomUUID(),
    classB: randomUUID(),
    sectionA: randomUUID(),
    sectionB: randomUUID(),
    studentA: randomUUID(),
    studentOutside: randomUUID(),
    subjectA: randomUUID(),
    questionA: randomUUID(),
    optionA: randomUUID(),
    examA: randomUUID(),
  };

  const users = {
    adminA: await createUser('academic-admin-a'),
    teacherA: await createUser('academic-teacher-a'),
    studentA: await createUser('academic-student-a'),
    adminB: await createUser('academic-admin-b'),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, 'Academic School A', 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, 'Academic School B', 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Admin A', 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Teacher A', 'teacher', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Admin B', 'school_admin', true);

    insert into public.branches (id, institution_id, name, is_active)
    values (${sqlValue(ids.branchB)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Branch B', true);

    insert into public.grade_levels (id, institution_id, name, sort_order, is_active)
    values (${sqlValue(ids.gradeB)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Grade B', 1, true);

    insert into public.classes (id, institution_id, branch_id, grade_level_id, name, academic_year, is_active)
    values (${sqlValue(ids.classB)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(ids.branchB)}::uuid, ${sqlValue(ids.gradeB)}::uuid, 'Class B', '2026-2027', true);

    insert into public.sections (id, class_id, name, capacity, is_active)
    values (${sqlValue(ids.sectionB)}::uuid, ${sqlValue(ids.classB)}::uuid, 'Section B', 30, true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, is_active, status)
    values
      (${sqlValue(ids.studentA)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`AC-ST-${run}`)}, 'Student A', true, 'active'),
      (${sqlValue(ids.studentOutside)}::uuid, null, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`AC-OUT-${run}`)}, 'Student Outside', true, 'active');

    insert into public.subjects (id, institution_id, name, code, is_active)
    values (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Academic Subject', ${sqlValue(`AC-${run}`)}, true);

    insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
    values (${sqlValue(ids.questionA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'multiple_choice', 'Academic Q', 'easy', 1, '{}'::jsonb);

    insert into public.question_options (id, question_id, label, is_correct, sort_order)
    values (${sqlValue(ids.optionA)}::uuid, ${sqlValue(ids.questionA)}::uuid, 'A', true, 0);
  `);

  const clients = {
    adminA: signedClient(users.adminA),
    teacherA: signedClient(users.teacherA),
    studentA: signedClient(users.studentA),
    adminB: signedClient(users.adminB),
    anon: createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };

  await expectOk('School Admin A', 'create branch', clients.adminA.from('branches').insert({
    id: ids.branchA,
    institution_id: ids.instA,
    name: `Branch A ${run}`,
    address: 'Main address',
    phone: '+201000000000',
  }).select('id').single());

  await expectOk('School Admin A', 'create grade level', clients.adminA.from('grade_levels').insert({
    id: ids.gradeA,
    institution_id: ids.instA,
    name: `Grade A ${run}`,
    name_en: `Grade A ${run}`,
    sort_order: 1,
    is_active: true,
  }).select('id').single());

  await expectOk('School Admin A', 'create class', clients.adminA.from('classes').insert({
    id: ids.classA,
    institution_id: ids.instA,
    branch_id: ids.branchA,
    grade_level_id: ids.gradeA,
    name: `Class A ${run}`,
    academic_year: '2026-2027',
    is_active: true,
  }).select('id').single());

  await expectOk('School Admin A', 'create section', clients.adminA.from('sections').insert({
    id: ids.sectionA,
    class_id: ids.classA,
    name: `Section A ${run}`,
    capacity: 25,
    is_active: true,
  }).select('id').single());

  await expectOk('School Admin A', 'update all levels', Promise.all([
    clients.adminA.from('branches').update({ address: 'Updated address' }).eq('id', ids.branchA),
    clients.adminA.from('grade_levels').update({ sort_order: 2 }).eq('id', ids.gradeA),
    clients.adminA.from('classes').update({ academic_year: '2027-2028' }).eq('id', ids.classA),
    clients.adminA.from('sections').update({ capacity: 28 }).eq('id', ids.sectionA),
  ]).then((responses) => ({ data: responses, error: responses.find((res) => res.error)?.error ?? null })));

  await expectOk('School Admin A', 'disable and reactivate section', clients.adminA.from('sections').update({ is_active: false }).eq('id', ids.sectionA));
  await expectFail('School Admin A', 'inactive section cannot be used for new enrollment', clients.adminA.from('class_students').insert({
    class_id: ids.classA,
    section_id: ids.sectionA,
    student_id: ids.studentA,
  }).select('id').single());
  await expectOk('School Admin A', 'reactivate section', clients.adminA.from('sections').update({ is_active: true }).eq('id', ids.sectionA));

  await expectOk('School Admin A', 'enroll student in class section', clients.adminA.from('class_students').insert({
    class_id: ids.classA,
    section_id: ids.sectionA,
    student_id: ids.studentA,
  }).select('id').single());

  await expectFail('School Admin A', 'duplicate branch name blocked', clients.adminA.from('branches').insert({
    institution_id: ids.instA,
    name: `Branch A ${run}`,
  }).select('id').single());

  await expectFail('School Admin A', 'class cannot use branch from B', clients.adminA.from('classes').insert({
    institution_id: ids.instA,
    branch_id: ids.branchB,
    grade_level_id: ids.gradeA,
    name: `Forged branch ${run}`,
  }).select('id').single());

  await expectFail('School Admin A', 'class cannot use grade from B', clients.adminA.from('classes').insert({
    institution_id: ids.instA,
    branch_id: ids.branchA,
    grade_level_id: ids.gradeB,
    name: `Forged grade ${run}`,
  }).select('id').single());

  await expectFail('School Admin A', 'student cannot link to class from B', clients.adminA.from('class_students').insert({
    class_id: ids.classB,
    section_id: ids.sectionB,
    student_id: ids.studentA,
  }).select('id').single());

  await expectFail('School Admin A', 'exam cannot be assigned to class from B', clients.adminA.from('examify_exams').insert({
    id: ids.examA,
    institution_id: ids.instA,
    subject_id: ids.subjectA,
    class_id: ids.classA,
    title: `Academic Exam ${run}`,
    total_points: 1,
    passing_score: 50,
    duration_minutes: 30,
    max_attempts: 1,
    status: 'draft',
  }).select('id').single().then(async (examRes) => {
    if (examRes.error) return examRes;
    return clients.adminA.from('exam_assignments').insert({ exam_id: ids.examA, class_id: ids.classB }).select('id').single();
  }));

  await expectOk('School Admin A', 'assign exam to real class section', clients.adminA.from('exam_assignments').insert({
    exam_id: ids.examA,
    class_id: ids.classA,
    section_id: ids.sectionA,
  }).select('id').single());

  const selectA = await clients.adminA.from('classes').select('id, institution_id').order('name');
  record('School Admin A', 'read own hierarchy only', 'only institution A classes', JSON.stringify(selectA.data ?? []), !selectA.error && (selectA.data ?? []).every((row) => row.institution_id === ids.instA));

  await expectFail('School Admin B', 'cannot update A branch', clients.adminB.from('branches').update({ name: 'Cross tenant' }).eq('id', ids.branchA).select('id').single());
  await expectFail('School Admin B', 'cannot use A IDs', clients.adminB.from('classes').insert({
    institution_id: ids.instB,
    branch_id: ids.branchA,
    grade_level_id: ids.gradeB,
    name: `B forged ${run}`,
  }).select('id').single());

  const teacherRead = await clients.teacherA.from('classes').select('id, institution_id');
  record('Teacher A', 'can read permitted structure', 'read A classes only', JSON.stringify(teacherRead.data ?? []), !teacherRead.error && (teacherRead.data ?? []).every((row) => row.institution_id === ids.instA));
  await expectFail('Teacher A', 'cannot create branch', clients.teacherA.from('branches').insert({ institution_id: ids.instA, name: `Teacher Branch ${run}` }).select('id').single());
  await expectFail('Student A', 'cannot create class', clients.studentA.from('classes').insert({ institution_id: ids.instA, name: `Student Class ${run}` }).select('id').single());
  await expectFail('anon', 'cannot read branches', clients.anon.from('branches').select('id').limit(1));

  await clients.adminA.from('examify_exams').update({ status: 'published' }).eq('id', ids.examA);
  const visibleAssigned = await clients.studentA.from('examify_exams').select('id').eq('id', ids.examA);
  record('Student A', 'student inside section sees assigned exam', 'one exam', JSON.stringify(visibleAssigned.data ?? []), !visibleAssigned.error && (visibleAssigned.data ?? []).length === 1);

  const outsideUser = await createUser('academic-student-outside');
  psql(`update public.student_profiles set user_id = ${sqlValue(outsideUser.id)}::uuid where id = ${sqlValue(ids.studentOutside)}::uuid;`);
  const outsideClient = signedClient(outsideUser);
  const visibleOutside = await outsideClient.from('examify_exams').select('id').eq('id', ids.examA);
  record('Student outside section', 'student outside section cannot see assigned exam', 'empty', JSON.stringify(visibleOutside.data ?? []), !visibleOutside.error && (visibleOutside.data ?? []).length === 0);

  const failed = results.filter((row) => !row.passed);
  console.table(results);
  console.log(`ACADEMIC_STRUCTURE_TEST_SUMMARY passed=${results.length - failed.length} failed=${failed.length}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
