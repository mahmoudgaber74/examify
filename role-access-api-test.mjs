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
  studentOtherAProfile: randomUUID(),
  studentBProfile: randomUUID(),
  parentAProfile: randomUUID(),
  subjectA: randomUUID(),
  subjectB: randomUUID(),
  questionAssigned: randomUUID(),
  questionAdminOnly: randomUUID(),
  questionManual: randomUUID(),
  optionCorrect: randomUUID(),
  optionWrong: randomUUID(),
  examAssigned: randomUUID(),
  examManual: randomUUID(),
  examExpired: randomUUID(),
  examUnassigned: randomUUID(),
  attemptOtherA: randomUUID(),
  attemptSubmitted: randomUUID(),
  attemptExpired: randomUUID(),
  attemptUnassigned: randomUUID(),
  gradeLinked: randomUUID(),
  gradeUnlinked: randomUUID(),
  notificationLinked: randomUUID(),
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

function anonymousClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function expectRows(area, operation, promise, expectedIds) {
  const { data, error } = await promise;
  const actualIds = Array.isArray(data) ? data.map((row) => row.id).sort() : [];
  const expected = [...expectedIds].sort();
  const passed = !error && JSON.stringify(actualIds) === JSON.stringify(expected);
  record(area, operation, JSON.stringify(expected), error ? error.message : JSON.stringify(actualIds), passed);
  return { data, error };
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

async function createAttempt(client, examId, studentId) {
  const existing = Number(psql(`select count(*) from public.exam_attempts where exam_id = ${sqlValue(examId)}::uuid and student_id = ${sqlValue(studentId)}::uuid;`));
  const { data, error } = await client
    .from('exam_attempts')
    .insert({ exam_id: examId, student_id: studentId, attempt_number: existing + 1, status: 'in_progress' })
    .select('id')
    .single();
  if (error) throw new Error(`createAttempt failed: ${error.message}`);
  return data.id;
}

async function submit(client, attemptId, answers = []) {
  return client.rpc('submit_exam_attempt', {
    p_attempt_id: attemptId,
    p_answers: answers,
    p_auto: false,
    p_time_remaining_seconds: 120,
  });
}

function seedUnsafeAttempts() {
  psql(`
    alter table public.exam_attempts disable trigger trg_enforce_exam_attempt_canonical_write;
    insert into public.exam_attempts (id, exam_id, student_id, attempt_number, status, score, score_percentage, is_result_published)
    values
      (${sqlValue(ids.attemptOtherA)}::uuid, ${sqlValue(ids.examAssigned)}::uuid, ${sqlValue(ids.studentOtherAProfile)}::uuid, 1, 'in_progress', null, null, false),
      (${sqlValue(ids.attemptSubmitted)}::uuid, ${sqlValue(ids.examManual)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid, 1, 'submitted', 0, 0, false),
      (${sqlValue(ids.attemptExpired)}::uuid, ${sqlValue(ids.examExpired)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid, 1, 'in_progress', null, null, false),
      (${sqlValue(ids.attemptUnassigned)}::uuid, ${sqlValue(ids.examUnassigned)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid, 1, 'in_progress', null, null, false);
    alter table public.exam_attempts enable trigger trg_enforce_exam_attempt_canonical_write;

    alter table public.answers disable trigger trg_enforce_answer_canonical_write;
    insert into public.answers (attempt_id, question_id, awarded_points, is_correct)
    values (${sqlValue(ids.attemptOtherA)}::uuid, ${sqlValue(ids.questionAssigned)}::uuid, 1, true);
    alter table public.answers enable trigger trg_enforce_answer_canonical_write;
  `);
}

function seedData(users) {
  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, ${sqlValue(`Role API Institution A ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, ${sqlValue(`Role API Institution B ${run}`)}, 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.superAdmin.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Role Super Admin ${run}`)}, 'super_admin', true),
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Role School Admin A ${run}`)}, 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Role Teacher A ${run}`)}, 'teacher', true),
      (${sqlValue(users.graderA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Role Grader A ${run}`)}, 'grader', true),
      (${sqlValue(users.dataEntryA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Role Data Entry A ${run}`)}, 'data_entry', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`Role School Admin B ${run}`)}, 'school_admin', true);

    insert into public.grade_levels (id, institution_id, name, sort_order)
    values (${sqlValue(ids.gradeA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Role Grade ${run}`)}, 1);

    insert into public.classes (id, institution_id, grade_level_id, name, is_active)
    values (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.gradeA)}::uuid, ${sqlValue(`Role Class ${run}`)}, true);

    insert into public.sections (id, class_id, name, is_active)
    values (${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Role Section ${run}`)}, true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, grade_level_id, is_active, status)
    values
      (${sqlValue(ids.studentAProfile)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`RA-${run}`)}, ${sqlValue(`Role Student A ${run}`)}, ${sqlValue(ids.gradeA)}::uuid, true, 'active'),
      (${sqlValue(ids.studentOtherAProfile)}::uuid, ${sqlValue(users.studentOtherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`RO-${run}`)}, ${sqlValue(`Role Student Other A ${run}`)}, ${sqlValue(ids.gradeA)}::uuid, true, 'active'),
      (${sqlValue(ids.studentBProfile)}::uuid, ${sqlValue(users.studentB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`RB-${run}`)}, ${sqlValue(`Role Student B ${run}`)}, null, true, 'active');

    insert into public.class_students (class_id, section_id, student_id)
    values
      (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid),
      (${sqlValue(ids.classA)}::uuid, ${sqlValue(ids.sectionA)}::uuid, ${sqlValue(ids.studentOtherAProfile)}::uuid);

    insert into public.parent_profiles (id, user_id, institution_id, full_name, phone, is_active)
    values (${sqlValue(ids.parentAProfile)}::uuid, ${sqlValue(users.parentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Role Parent A ${run}`)}, '0500000000', true);

    insert into public.parent_student_links (parent_id, student_id, relationship, can_view_grades, can_view_attendance, can_receive_alerts)
    values (${sqlValue(ids.parentAProfile)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid, 'parent', true, true, true);

    insert into public.subjects (id, institution_id, name, code, is_active)
    values
      (${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`Role Subject A ${run}`)}, ${sqlValue(`RA-${run}`)}, true),
      (${sqlValue(ids.subjectB)}::uuid, ${sqlValue(ids.instB)}::uuid, ${sqlValue(`Role Subject B ${run}`)}, ${sqlValue(`RB-${run}`)}, true);

    insert into public.questions (id, institution_id, subject_id, type, prompt, difficulty, points, metadata)
    values
      (${sqlValue(ids.questionAssigned)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'multiple_choice', ${sqlValue(`Assigned question ${run}`)}, 'easy', 1, '{}'::jsonb),
      (${sqlValue(ids.questionAdminOnly)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'multiple_choice', ${sqlValue(`Admin only question ${run}`)}, 'easy', 1, '{}'::jsonb),
      (${sqlValue(ids.questionManual)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, 'essay', ${sqlValue(`Manual question ${run}`)}, 'easy', 1, '{}'::jsonb);

    insert into public.question_options (id, question_id, label, is_correct, sort_order)
    values
      (${sqlValue(ids.optionCorrect)}::uuid, ${sqlValue(ids.questionAssigned)}::uuid, 'A', true, 0),
      (${sqlValue(ids.optionWrong)}::uuid, ${sqlValue(ids.questionAssigned)}::uuid, 'B', false, 1);

    insert into public.examify_exams (
      id, institution_id, subject_id, class_id, title, total_points, passing_score,
      duration_minutes, max_attempts, show_result_immediately, show_correct_answers, status, start_at, end_at
    )
    values
      (${sqlValue(ids.examAssigned)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Assigned exam ${run}`)}, 1, 50, 30, 5, true, true, 'published', null, null),
      (${sqlValue(ids.examManual)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Manual exam ${run}`)}, 1, 50, 30, 5, true, true, 'published', null, null),
      (${sqlValue(ids.examExpired)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Expired exam ${run}`)}, 1, 50, 30, 5, true, true, 'published', now() - interval '2 days', now() - interval '1 day'),
      (${sqlValue(ids.examUnassigned)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(ids.classA)}::uuid, ${sqlValue(`Unassigned exam ${run}`)}, 1, 50, 30, 5, true, true, 'published', null, null);

    insert into public.exam_questions (exam_id, question_id, points, sort_order)
    values
      (${sqlValue(ids.examAssigned)}::uuid, ${sqlValue(ids.questionAssigned)}::uuid, 1, 0),
      (${sqlValue(ids.examManual)}::uuid, ${sqlValue(ids.questionManual)}::uuid, 1, 0),
      (${sqlValue(ids.examExpired)}::uuid, ${sqlValue(ids.questionAssigned)}::uuid, 1, 0),
      (${sqlValue(ids.examUnassigned)}::uuid, ${sqlValue(ids.questionAssigned)}::uuid, 1, 0);

    insert into public.exam_assignments (exam_id, class_id)
    values
      (${sqlValue(ids.examAssigned)}::uuid, ${sqlValue(ids.classA)}::uuid),
      (${sqlValue(ids.examManual)}::uuid, ${sqlValue(ids.classA)}::uuid),
      (${sqlValue(ids.examExpired)}::uuid, ${sqlValue(ids.classA)}::uuid);

    insert into public.grade_book (id, institution_id, student_id, subject_id, assessment_title, score, max_score)
    values
      (${sqlValue(ids.gradeLinked)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(`Linked grade ${run}`)}, 90, 100),
      (${sqlValue(ids.gradeUnlinked)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.studentOtherAProfile)}::uuid, ${sqlValue(ids.subjectA)}::uuid, ${sqlValue(`Unlinked grade ${run}`)}, 70, 100);

    insert into public.parent_notifications (id, institution_id, parent_id, student_id, type, title, body, is_read)
    values (${sqlValue(ids.notificationLinked)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.parentAProfile)}::uuid, ${sqlValue(ids.studentAProfile)}::uuid, 'grade_posted', ${sqlValue(`Notification ${run}`)}, 'Body', false);
  `);
  seedUnsafeAttempts();
}

async function main() {
  const users = {
    superAdmin: await createUser('role-super-admin'),
    adminA: await createUser('role-admin-a'),
    teacherA: await createUser('role-teacher-a'),
    graderA: await createUser('role-grader-a'),
    dataEntryA: await createUser('role-data-entry-a'),
    studentA: await createUser('role-student-a'),
    studentOtherA: await createUser('role-student-other-a'),
    studentB: await createUser('role-student-b'),
    parentA: await createUser('role-parent-a'),
    adminB: await createUser('role-admin-b'),
  };
  seedData(users);

  const clients = Object.fromEntries(Object.entries(users).map(([key, user]) => [key, signedClient(user)]));
  const anon = anonymousClient();

  await expectRows('super_admin', 'reads all institutions', clients.superAdmin.from('institutions').select('id').in('id', [ids.instA, ids.instB]), [ids.instA, ids.instB]);

  await expectRows('school_admin', 'reads own institution only', clients.adminA.from('institutions').select('id').in('id', [ids.instA, ids.instB]), [ids.instA]);
  await expectBlocked('school_admin', 'cannot update institution B', clients.adminA.from('institutions').update({ name: `Blocked B ${run}` }).eq('id', ids.instB).select('id'));
  await expectBlocked('school_admin', 'cannot delete institution B', clients.adminA.from('institutions').delete().eq('id', ids.instB).select('id'));

  const dataEntryStudentId = randomUUID();
  await expectOk('data_entry', 'creates allowed SIS student', clients.dataEntryA.from('student_profiles').insert({
    id: dataEntryStudentId,
    institution_id: ids.instA,
    student_code: `DE-${run}`,
    full_name: `Data Entry Student ${run}`,
    grade_level_id: ids.gradeA,
    status: 'active',
    is_active: true,
  }).select('id').single());
  await expectOk('data_entry', 'updates allowed SIS student', clients.dataEntryA.from('student_profiles').update({ full_name: `Updated Data Entry Student ${run}` }).eq('id', dataEntryStudentId).select('id').single());
  await expectBlocked('data_entry', 'cannot create subject management records', clients.dataEntryA.from('subjects').insert({ institution_id: ids.instA, name: `DE Subject ${run}`, code: `DE-S-${run}`, is_active: true }).select('id'));
  await expectBlocked('data_entry', 'cannot update grades', clients.dataEntryA.from('grade_book').update({ score: 100 }).eq('id', ids.gradeLinked).select('id'));
  await expectBlocked('data_entry', 'cannot publish results', clients.dataEntryA.from('exam_attempts').update({ is_result_published: true }).eq('id', ids.attemptSubmitted).select('id'));
  await expectBlocked('data_entry', 'cannot manage institutions', clients.dataEntryA.from('institutions').insert({ name: `DE Institution ${run}` }).select('id'));

  await expectOk('grader', 'updates grading fields for institution attempt', clients.graderA.from('answers').update({ awarded_points: 0, grader_notes: `Reviewed ${run}` }).eq('attempt_id', ids.attemptOtherA).select('id').single());
  await expectOk('grader', 'updates attempt grading status', clients.graderA.from('exam_attempts').update({ status: 'graded', score: 0, score_percentage: 0 }).eq('id', ids.attemptOtherA).select('id').single());
  await expectBlocked('grader', 'cannot update student profile', clients.graderA.from('student_profiles').update({ full_name: `Blocked Grader ${run}` }).eq('id', ids.studentAProfile).select('id'));
  await expectBlocked('grader', 'cannot update institution', clients.graderA.from('institutions').update({ name: `Blocked Grader ${run}` }).eq('id', ids.instA).select('id'));

  await expectRows('student', 'reads own attempt only', clients.studentA.from('exam_attempts').select('id').in('id', [ids.attemptOtherA, ids.attemptSubmitted]), []);
  await expectRows('student', 'reads own linked profile only', clients.studentA.from('student_profiles').select('id').in('id', [ids.studentAProfile, ids.studentOtherAProfile]), [ids.studentAProfile]);
  await expectRows('student', 'cannot read another student answers', clients.studentA.from('answers').select('id').eq('attempt_id', ids.attemptOtherA), []);
  await expectRows('student', 'cannot read unassigned administrative question directly', clients.studentA.from('questions').select('id').eq('id', ids.questionAdminOnly), []);
  await expectRows('student', 'can read assigned exam question', clients.studentA.from('questions').select('id').eq('id', ids.questionAssigned), [ids.questionAssigned]);
  await expectRows('student', 'cannot read unpublished submitted result', clients.studentA.from('exam_attempts').select('id').eq('id', ids.attemptSubmitted), []);

  await expectRows('parent', 'reads linked child only', clients.parentA.from('student_profiles').select('id').in('id', [ids.studentAProfile, ids.studentOtherAProfile]), [ids.studentAProfile]);
  await expectRows('parent', 'reads linked grade only', clients.parentA.from('grade_book').select('id').in('id', [ids.gradeLinked, ids.gradeUnlinked]), [ids.gradeLinked]);
  await expectRows('parent', 'cannot read unpublished attempts', clients.parentA.from('exam_attempts').select('id').in('id', [ids.attemptSubmitted, ids.attemptOtherA]), []);
  await expectBlocked('parent', 'cannot change grades', clients.parentA.from('grade_book').update({ score: 100 }).eq('id', ids.gradeLinked).select('id'));
  await expectBlocked('parent', 'cannot change attempts', clients.parentA.from('exam_attempts').update({ score: 100 }).eq('id', ids.attemptSubmitted).select('id'));
  await expectOk('parent', 'can mark own notification as read', clients.parentA.from('parent_notifications').update({ is_read: true }).eq('id', ids.notificationLinked).select('id').single());

  const attemptForRpc = await createAttempt(clients.studentA, ids.examAssigned, ids.studentAProfile);
  const anonSubmit = await submit(anon, attemptForRpc, []);
  record('submit_exam_attempt', 'rejects anonymous user', 'error', anonSubmit.error ? anonSubmit.error.message : 'success', Boolean(anonSubmit.error));

  const teacherSubmit = await submit(clients.teacherA, attemptForRpc, []);
  record('submit_exam_attempt', 'rejects teacher submitting student attempt', 'error', teacherSubmit.error ? teacherSubmit.error.message : 'success', Boolean(teacherSubmit.error));

  const studentBSubmit = await submit(clients.studentB, attemptForRpc, []);
  record('submit_exam_attempt', 'rejects institution B student on institution A attempt', 'error', studentBSubmit.error ? studentBSubmit.error.message : 'success', Boolean(studentBSubmit.error));

  const otherStudentSubmit = await submit(clients.studentA, ids.attemptOtherA, []);
  record('submit_exam_attempt', 'rejects another student attempt', 'error', otherStudentSubmit.error ? otherStudentSubmit.error.message : 'success', Boolean(otherStudentSubmit.error));

  const submittedAttemptSubmit = await submit(clients.studentA, ids.attemptSubmitted, []);
  record('submit_exam_attempt', 'rejects attempt not in_progress', 'error', submittedAttemptSubmit.error ? submittedAttemptSubmit.error.message : 'success', Boolean(submittedAttemptSubmit.error));

  const expiredSubmit = await submit(clients.studentA, ids.attemptExpired, []);
  record('submit_exam_attempt', 'rejects unavailable exam', 'error', expiredSubmit.error ? expiredSubmit.error.message : 'success', Boolean(expiredSubmit.error));

  const unassignedSubmit = await submit(clients.studentA, ids.attemptUnassigned, []);
  record('submit_exam_attempt', 'rejects unassigned exam attempt', 'error', unassignedSubmit.error ? unassignedSubmit.error.message : 'success', Boolean(unassignedSubmit.error));

  const duplicateAttempt = await createAttempt(clients.studentA, ids.examAssigned, ids.studentAProfile);
  const firstSubmit = await submit(clients.studentA, duplicateAttempt, [{ question_id: ids.questionAssigned, option_id: ids.optionCorrect }]);
  record('submit_exam_attempt', 'accepts valid student submit before duplicate check', 'success', firstSubmit.error ? firstSubmit.error.message : 'success', !firstSubmit.error);
  const duplicateSubmit = await submit(clients.studentA, duplicateAttempt, [{ question_id: ids.questionAssigned, option_id: ids.optionCorrect }]);
  record('submit_exam_attempt', 'rejects duplicate submit', 'error', duplicateSubmit.error ? duplicateSubmit.error.message : 'success', Boolean(duplicateSubmit.error));

  psql(`
    delete from public.institutions where id in (${sqlValue(ids.instA)}::uuid, ${sqlValue(ids.instB)}::uuid);
    delete from auth.users where id in (${Object.values(users).map((user) => `${sqlValue(user.id)}::uuid`).join(', ')});
  `);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'} | ${r.area} | ${r.operation} | expected=${r.expected} | actual=${r.actual}`);
  }
  console.log(`ROLE_ACCESS_API_TEST_SUMMARY passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
