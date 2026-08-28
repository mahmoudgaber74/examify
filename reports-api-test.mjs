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
  examA: randomUUID(),
  examB: randomUUID(),
  examOther: randomUUID(),
  studentA: randomUUID(),
  studentOtherA: randomUUID(),
  studentB: randomUUID(),
  parentA: randomUUID(),
  attemptPublishedPass: randomUUID(),
  attemptPublishedFail: randomUUID(),
  attemptUnpublished: randomUUID(),
  attemptInstitutionB: randomUUID(),
  gradeLinked: randomUUID(),
  gradeUnlinked: randomUUID(),
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

async function expectCount(area, operation, promise, expectedCount) {
  const { data, error } = await promise;
  const actual = Array.isArray(data) ? data.length : -1;
  record(area, operation, String(expectedCount), error ? error.message : String(actual), !error && actual === expectedCount);
  return data ?? [];
}

async function main() {
  const users = {
    adminA: await createUser('reports-admin-a'),
    adminB: await createUser('reports-admin-b'),
    teacherA: await createUser('reports-teacher-a'),
    graderA: await createUser('reports-grader-a'),
    studentA: await createUser('reports-student-a'),
    parentA: await createUser('reports-parent-a'),
  };

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, ${sqlValue(`Reports API A ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, ${sqlValue(`Reports API B ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Reports Admin A ${run}`)}, 'school_admin', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`Reports Admin B ${run}`)}, 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Reports Teacher A ${run}`)}, 'teacher', true),
      (${sqlValue(users.graderA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Reports Grader A ${run}`)}, 'grader', true);

    insert into public.grade_levels (id, institution_id, name, sort_order)
    values (${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Reports Grade ${run}`)}, 1);
    insert into public.classes (id, institution_id, grade_level_id, name, is_active)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.gradeA)}::uuid, ${sqlValue(`Reports Class ${run}`)}, true);
    insert into public.sections (id, class_id, name, is_active)
    values (${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Reports Section ${run}`)}, true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, grade_level_id, is_active, status)
    values
      (${sqlValue(ids.studentA)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`RPA-${run}`)}, ${sqlValue(`Reports Student A ${run}`)}, ${sqlValue(ids.gradeA)}::uuid, true, 'active'),
      (${sqlValue(ids.studentOtherA)}::uuid, null, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`RPO-${run}`)}, ${sqlValue(`Reports Other A ${run}`)}, ${sqlValue(ids.gradeA)}::uuid, true, 'active'),
      (${sqlValue(ids.studentB)}::uuid, null, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`RPB-${run}`)}, ${sqlValue(`Reports Student B ${run}`)}, null, true, 'active');
    insert into public.class_students (class_id, section_id, student_id)
    values
      (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentA)}::uuid),
      (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentOtherA)}::uuid);

    insert into public.parent_profiles (id, user_id, institution_id, full_name, phone, is_active)
    values (${sqlValue(ids.parentA)}::uuid, ${sqlValue(users.parentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Reports Parent ${run}`)}, '0500000000', true);
    insert into public.parent_student_links (parent_id, student_id, relationship, can_view_grades, can_view_attendance, can_receive_alerts)
    values (${sqlValue(ids.parentA)}::uuid, ${sqlValue(ids.studentA)}::uuid, 'parent', true, true, true);

    insert into public.subjects (id, institution_id, name, code, is_active)
    values
      (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Reports Subject A ${run}`)}, ${sqlValue(`RSA-${run}`)}, true),
      (${sqlValue(ids.subjectB)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`Reports Subject B ${run}`)}, ${sqlValue(`RSB-${run}`)}, true);

    insert into public.examify_exams (id, institution_id, subject_id, class_id, title, total_points, passing_score, duration_minutes, status)
    values
      (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Reports Exam A ${run}`)}, 100, 50, 30, 'published'),
      (${sqlValue(ids.examOther)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Reports Exam Other ${run}`)}, 100, 50, 30, 'published'),
      (${sqlValue(ids.examB)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(ids.subjectB)}::uuid, null, ${sqlValue(`Reports Exam B ${run}`)}, 100, 50, 30, 'published');

    alter table public.exam_attempts disable trigger trg_enforce_exam_attempt_canonical_write;
    insert into public.exam_attempts (id, exam_id, student_id, attempt_number, status, submitted_at, score, score_percentage, is_passed, is_result_published)
    values
      (${sqlValue(ids.attemptPublishedPass)}::uuid, ${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.studentA)}::uuid, 1, 'approved', '2026-08-05T10:00:00Z', 80, 80, true, true),
      (${sqlValue(ids.attemptPublishedFail)}::uuid, ${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.studentOtherA)}::uuid, 1, 'approved', '2026-08-05T11:00:00Z', 40, 40, false, true),
      (${sqlValue(ids.attemptUnpublished)}::uuid, ${sqlValue(ids.examOther)}::uuid, ${sqlValue(ids.studentA)}::uuid, 1, 'graded', '2026-08-04T10:00:00Z', 90, 90, true, false),
      (${sqlValue(ids.attemptInstitutionB)}::uuid, ${sqlValue(ids.examB)}::uuid, ${sqlValue(ids.studentB)}::uuid, 1, 'approved', '2026-08-05T12:00:00Z', 100, 100, true, true);
    alter table public.exam_attempts enable trigger trg_enforce_exam_attempt_canonical_write;

    insert into public.grade_book (id, institution_id, student_id, subject_id, assessment_title, score, max_score)
    values
      (${sqlValue(ids.gradeLinked)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.studentA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'Published linked grade', 80, 100),
      (${sqlValue(ids.gradeUnlinked)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.studentOtherA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'Unlinked grade', 40, 100);
  `);

  const adminA = signedClient(users.adminA);
  const adminB = signedClient(users.adminB);
  const teacherA = signedClient(users.teacherA);
  const graderA = signedClient(users.graderA);
  const studentA = signedClient(users.studentA);
  const parentA = signedClient(users.parentA);

  const baseSelect = 'id, score_percentage, is_result_published, status, submitted_at, examify_exams!inner(id, title, subject_id, institution_id)';
  const adminRows = await expectCount('reports', 'admin sees institution A report attempts including unpublished staff result', adminA.from('exam_attempts').select(baseSelect).eq('examify_exams.institution_id', ids.instA).in('status', ['submitted', 'auto_submitted', 'graded', 'approved']), 3);
  const avg = adminRows.reduce((sum, row) => sum + Number(row.score_percentage ?? 0), 0) / adminRows.length;
  record('reports', 'admin average score is computed from real rows', '70', String(Math.round(avg)), Math.round(avg) === 70);
  await expectCount('reports', 'exam filter returns only selected exam attempts', adminA.from('exam_attempts').select(baseSelect).eq('examify_exams.institution_id', ids.instA).eq('exam_id', ids.examA), 2);
  await expectCount('reports', 'status filter returns only graded unpublished attempt', adminA.from('exam_attempts').select(baseSelect).eq('examify_exams.institution_id', ids.instA).eq('status', 'graded'), 1);
  await expectCount('reports', 'date filter returns attempts submitted on 2026-08-05', adminA.from('exam_attempts').select(baseSelect).eq('examify_exams.institution_id', ids.instA).gte('submitted_at', '2026-08-05T00:00:00Z').lte('submitted_at', '2026-08-05T23:59:59Z'), 2);
  await expectCount('reports', 'admin B cannot read institution A attempts', adminB.from('exam_attempts').select(baseSelect).eq('examify_exams.institution_id', ids.instA), 0);
  await expectCount('reports', 'teacher reads institution report scope', teacherA.from('exam_attempts').select(baseSelect).eq('examify_exams.institution_id', ids.instA), 3);
  await expectCount('reports', 'grader reads institution grading report scope', graderA.from('exam_attempts').select(baseSelect).eq('examify_exams.institution_id', ids.instA), 3);
  await expectCount('reports', 'student sees only own published attempt', studentA.from('exam_attempts').select('id').in('id', [ids.attemptPublishedPass, ids.attemptPublishedFail, ids.attemptUnpublished]), 1);
  await expectCount('reports', 'parent cannot read exam attempts directly', parentA.from('exam_attempts').select('id').in('id', [ids.attemptPublishedPass, ids.attemptPublishedFail, ids.attemptUnpublished]), 0);
  await expectCount('reports', 'parent reads linked grade only through parent report source', parentA.from('grade_book').select('id').in('id', [ids.gradeLinked, ids.gradeUnlinked]), 1);

  psql(`
    delete from public.institutions where id in (${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.instB)}::uuid);
    delete from auth.users where id in (${Object.values(users).map((user) => `${sqlValue(user.id)}::uuid`).join(', ')});
  `);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.area} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`REPORTS_API_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
