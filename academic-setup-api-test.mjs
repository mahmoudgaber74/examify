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

function record(operation, expected, actual, passed) {
  results.push({ operation, expected, actual, passed });
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

async function expectOk(operation, promise) {
  const { data, error } = await promise;
  record(operation, 'success', error ? error.message : 'success', !error);
  if (error) console.error(`[${operation}] ${error.message}`);
  return { data, error };
}

async function expectFail(operation, promise) {
  const { data, error } = await promise;
  const failed = Boolean(error) || data === null || (Array.isArray(data) && data.length === 0);
  record(operation, 'fail', error ? error.message : JSON.stringify(data), failed);
  return { data, error };
}

async function main() {
  const ids = {
    instA: randomUUID(),
    instB: randomUUID(),
    adminUser: randomUUID(),
    teacherUser: randomUUID(),
    adminProfile: randomUUID(),
    teacherProfile: randomUUID(),
    year: randomUUID(),
    otherYear: randomUUID(),
    stage: randomUUID(),
    otherStage: randomUUID(),
    grade: randomUUID(),
    branch: randomUUID(),
    classA: randomUUID(),
    section: randomUUID(),
    subject: randomUUID(),
    student: randomUUID(),
  };

  psql(`
    insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (${sqlValue(ids.adminUser)}::uuid, 'authenticated', 'authenticated', ${sqlValue(`academic-setup-admin-${run}@example.local`)}, 'x', now(), now(), now()),
      (${sqlValue(ids.teacherUser)}::uuid, 'authenticated', 'authenticated', ${sqlValue(`academic-setup-teacher-${run}@example.local`)}, 'x', now(), now(), now());

    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, ${sqlValue(`Academic Setup A ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, ${sqlValue(`Academic Setup B ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (id, user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(ids.adminProfile)}::uuid, ${sqlValue(ids.adminUser)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Academic Admin', 'school_admin', true),
      (${sqlValue(ids.teacherProfile)}::uuid, ${sqlValue(ids.teacherUser)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Academic Teacher', 'teacher', true);

    insert into public.academic_years (id, institution_id, name, start_date, end_date, is_current, is_active)
    values (${sqlValue(ids.otherYear)}::uuid, ${sqlValue(ids.instB)}::uuid, '2026-2027', '2026-09-01', '2027-06-30', true, true);

    insert into public.education_stages (id, institution_id, name, code, sort_order, is_active)
    values (${sqlValue(ids.otherStage)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Other Stage', 'OTHER', 1, true);
  `);

  const admin = signedClient({
    id: ids.adminUser,
    email: `academic-setup-admin-${run}@example.local`,
    token: userToken(ids.adminUser, `academic-setup-admin-${run}@example.local`),
  });
  const teacher = signedClient({
    id: ids.teacherUser,
    email: `academic-setup-teacher-${run}@example.local`,
    token: userToken(ids.teacherUser, `academic-setup-teacher-${run}@example.local`),
  });

  await expectOk('create academic year', admin.from('academic_years').insert({
    id: ids.year,
    institution_id: ids.instA,
    name: `2026-2027-${run}`,
    start_date: '2026-09-01',
    end_date: '2027-06-30',
    is_current: true,
    is_active: true,
  }).select('id').single());

  await expectOk('create education stage', admin.from('education_stages').insert({
    id: ids.stage,
    institution_id: ids.instA,
    name: `Primary ${run}`,
    code: `P-${run}`,
    sort_order: 1,
    is_active: true,
  }).select('id').single());

  await expectOk('create grade under stage', admin.from('grade_levels').insert({
    id: ids.grade,
    institution_id: ids.instA,
    education_stage_id: ids.stage,
    name: `Grade ${run}`,
    code: `G-${run}`,
    sort_order: 1,
    is_active: true,
  }).select('id').single());

  await expectFail('reject grade under stage from another institution', admin.from('grade_levels').insert({
    institution_id: ids.instA,
    education_stage_id: ids.otherStage,
    name: `Bad Grade ${run}`,
  }).select('id').single());

  await expectOk('create branch', admin.from('branches').insert({
    id: ids.branch,
    institution_id: ids.instA,
    name: `Branch ${run}`,
    is_active: true,
  }).select('id').single());

  await expectOk('create class linked to academic year and grade', admin.from('classes').insert({
    id: ids.classA,
    institution_id: ids.instA,
    branch_id: ids.branch,
    grade_level_id: ids.grade,
    academic_year_id: ids.year,
    academic_year: `2026-2027-${run}`,
    name: `Class ${run}`,
    is_active: true,
  }).select('id').single());

  await expectOk('create section', admin.from('sections').insert({
    id: ids.section,
    class_id: ids.classA,
    name: `A-${run}`,
    capacity: 25,
    is_active: true,
  }).select('id').single());

  await expectOk('create subject', admin.from('subjects').insert({
    id: ids.subject,
    institution_id: ids.instA,
    name: `Subject ${run}`,
    code: `SUB-${run}`,
    is_active: true,
  }).select('id').single());

  await expectOk('assign subject to grade for academic year', admin.from('grade_subjects').insert({
    institution_id: ids.instA,
    academic_year_id: ids.year,
    grade_level_id: ids.grade,
    class_id: ids.classA,
    subject_id: ids.subject,
    is_required: true,
    is_active: true,
  }).select('id').single());

  await expectFail('reject grade subject with year from another institution', admin.from('grade_subjects').insert({
    institution_id: ids.instA,
    academic_year_id: ids.otherYear,
    grade_level_id: ids.grade,
    subject_id: ids.subject,
  }).select('id').single());

  await expectOk('assign teacher to subject class section', admin.from('subject_teachers').insert({
    subject_id: ids.subject,
    class_id: ids.classA,
    section_id: ids.section,
    teacher_id: ids.teacherProfile,
    is_active: true,
  }).select('id, institution_id, academic_year_id, grade_level_id').single());

  const teacherAssignments = await teacher.from('subject_teachers').select('subject_id, class_id, section_id').eq('teacher_id', ids.teacherProfile);
  record('teacher can read own academic assignment', 'one assignment', JSON.stringify(teacherAssignments.data ?? []), !teacherAssignments.error && (teacherAssignments.data ?? []).length === 1);

  await expectOk('create student with local name parts', admin.from('student_profiles').insert({
    id: ids.student,
    institution_id: ids.instA,
    first_name: 'Ali',
    father_name: 'Hassan',
    family_name: 'Saleh',
    full_name: 'Ali Hassan Saleh',
    student_code: `ST-${run}`,
    grade_level_id: ids.grade,
    seat_number: `S-${run}`,
    status: 'active',
    is_active: true,
  }).select('id').single());

  const enrollment = await expectOk('enroll student in class section', admin.from('class_students').insert({
    student_id: ids.student,
    class_id: ids.classA,
    section_id: ids.section,
    seat_number: `S-${run}`,
    status: 'active',
  }).select('id, institution_id, academic_year_id, grade_level_id, seat_number, status').single());

  await expectFail('reject duplicate active enrollment in same academic year', admin.from('class_students').insert({
    student_id: ids.student,
    class_id: ids.classA,
    section_id: ids.section,
    status: 'active',
  }).select('id').single());

  await expectOk('close active enrollment without deleting history', admin.from('class_students').update({
    status: 'transferred',
    ended_at: new Date().toISOString(),
  }).eq('id', enrollment.data.id));

  await expectOk('create new active enrollment after transfer history remains', admin.from('class_students').insert({
    student_id: ids.student,
    class_id: ids.classA,
    section_id: ids.section,
    seat_number: `S2-${run}`,
    status: 'active',
  }).select('id').single());

  const failed = results.filter((row) => !row.passed);
  console.table(results);
  console.log(`ACADEMIC_SETUP_TEST_SUMMARY passed=${results.length - failed.length} failed=${failed.length}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
