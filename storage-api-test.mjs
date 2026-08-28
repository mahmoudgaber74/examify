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
  examA: randomUUID(),
  examB: randomUUID(),
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

async function expectOk(account, operation, promise) {
  const { data, error } = await promise;
  record(account, operation, 'success', error ? error.message : 'success', !error);
  return { data, error };
}

async function expectFail(account, operation, promise) {
  const { data, error } = await promise;
  const failed = Boolean(error) || data === null;
  record(account, operation, 'fail', error ? error.message : 'success', failed);
  return { data, error };
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

async function uploadText(client, bucket, path, body = 'ok', type = 'text/plain', upsert = false) {
  return client.storage.from(bucket).upload(path, new Blob([body], { type }), {
    contentType: type,
    upsert,
  });
}

async function main() {
  const users = {
    adminA: await createUser('admin-a'),
    teacherA: await createUser('teacher-a'),
    graderA: await createUser('grader-a'),
    studentA: await createUser('student-a'),
    studentA2: await createUser('student-a2'),
    parentA: await createUser('parent-a'),
    adminB: await createUser('admin-b'),
  };

  const studentProfileA = randomUUID();
  const studentProfileA2 = randomUUID();
  const parentProfileA = randomUUID();

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, 'Storage School A', 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, 'Storage School B', 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Admin A', 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Teacher A', 'teacher', true),
      (${sqlValue(users.graderA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Grader A', 'grader', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Admin B', 'school_admin', true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, is_active, status)
    values
      (${sqlValue(studentProfileA)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`SA-${run}`)}, 'Student A', true, 'active'),
      (${sqlValue(studentProfileA2)}::uuid, ${sqlValue(users.studentA2.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`SA2-${run}`)}, 'Student A2', true, 'active');

    insert into public.parent_profiles (id, user_id, institution_id, full_name, phone, is_active)
    values (${sqlValue(parentProfileA)}::uuid, ${sqlValue(users.parentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Parent A', '+100000000', true);

    insert into public.parent_student_links (parent_id, student_id, relationship)
    values (${sqlValue(parentProfileA)}::uuid, ${sqlValue(studentProfileA)}::uuid, 'father');

    insert into public.examify_exams (id, institution_id, title, status)
    values
      (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.instA)}::uuid, 'Storage Exam A', 'draft'),
      (${sqlValue(ids.examB)}::uuid, ${sqlValue(ids.instB)}::uuid, 'Storage Exam B', 'draft');
  `);

  const clients = {
    adminA: signedClient(users.adminA),
    teacherA: signedClient(users.teacherA),
    graderA: signedClient(users.graderA),
    studentA: signedClient(users.studentA),
    studentA2: signedClient(users.studentA2),
    parentA: signedClient(users.parentA),
    adminB: signedClient(users.adminB),
  };

  const adminStudentPath = `${ids.instA}/student-documents/${users.studentA.id}/admin-file.pdf`;
  const adminBPath = `${ids.instB}/student-documents/${users.studentA.id}/fake-b.pdf`;
  const teacherSheetPath = `${ids.instA}/omr-original/${users.teacherA.id}/${ids.examA}/${run}/sheet.png`;
  const fakeTeacherSheetPath = `${ids.instB}/omr-original/${users.teacherA.id}/${ids.examB}/${run}/fake-sheet.png`;
  const studentAnswerPath = `${ids.instA}/answer-attachments/${users.studentA.id}/answer.pdf`;
  const studentA2Path = `${ids.instA}/answer-attachments/${users.studentA2.id}/answer.pdf`;
  const avatarPath = `${ids.instA}/profile-image/${users.adminA.id}/avatar.png`;

  await expectFail('anon', 'upload private file', uploadText(anon, 'student-files', adminStudentPath, 'x', 'application/pdf'));
  await expectFail('anon', 'download private file', anon.storage.from('student-files').download(adminStudentPath));
  await expectFail('anon', 'update private file', uploadText(anon, 'student-files', adminStudentPath, 'x', 'application/pdf', true));

  await expectOk('School Admin A', 'upload A file', uploadText(clients.adminA, 'student-files', adminStudentPath, 'pdf', 'application/pdf'));
  await expectOk('School Admin A', 'read A file', clients.adminA.storage.from('student-files').download(adminStudentPath));
  const anonListAfterUpload = await anon.storage.from('student-files').list(`${ids.instA}/student-documents/${users.studentA.id}`);
  record(
    'anon',
    'list private files',
    'fail or empty',
    anonListAfterUpload.error ? anonListAfterUpload.error.message : JSON.stringify((anonListAfterUpload.data ?? []).map((item) => item.name)),
    Boolean(anonListAfterUpload.error) || (anonListAfterUpload.data ?? []).length === 0,
  );
  const anonDeleteAfterUpload = await anon.storage.from('student-files').remove([adminStudentPath]);
  const adminReadAfterAnonDelete = await clients.adminA.storage.from('student-files').download(adminStudentPath);
  record(
    'anon',
    'delete private file',
    'fail or no-op',
    anonDeleteAfterUpload.error ? anonDeleteAfterUpload.error.message : (adminReadAfterAnonDelete.error ? 'deleted' : 'no-op'),
    Boolean(anonDeleteAfterUpload.error) || !adminReadAfterAnonDelete.error,
  );
  await expectFail('School Admin A', 'upload forged B path', uploadText(clients.adminA, 'student-files', adminBPath, 'pdf', 'application/pdf'));
  await expectFail('School Admin B', 'read A private file', clients.adminB.storage.from('student-files').download(adminStudentPath));
  const adminBDelete = await clients.adminB.storage.from('student-files').remove([adminStudentPath]);
  const adminReadAfterBDelete = await clients.adminA.storage.from('student-files').download(adminStudentPath);
  record(
    'School Admin B',
    'delete A private file',
    'fail or no-op',
    adminBDelete.error ? adminBDelete.error.message : (adminReadAfterBDelete.error ? 'deleted' : 'no-op'),
    Boolean(adminBDelete.error) || !adminReadAfterBDelete.error,
  );
  await expectOk('School Admin A', 'upsert own-tenant file', uploadText(clients.adminA, 'student-files', adminStudentPath, 'pdf2', 'application/pdf', true));

  await expectOk('Teacher A', 'upload exam sheet A', uploadText(clients.teacherA, 'exam-sheets', teacherSheetPath, 'png', 'image/png'));
  await expectOk('Teacher A', 'read exam sheet A', clients.teacherA.storage.from('exam-sheets').download(teacherSheetPath));
  await expectFail('Teacher A', 'upload forged B exam sheet', uploadText(clients.teacherA, 'exam-sheets', fakeTeacherSheetPath, 'png', 'image/png'));
  await expectFail('School Admin B', 'read A exam sheet', clients.adminB.storage.from('exam-sheets').download(teacherSheetPath));

  await expectOk('Grader A', 'read assigned tenant sheet', clients.graderA.storage.from('exam-sheets').download(teacherSheetPath));
  const graderDelete = await clients.graderA.storage.from('exam-sheets').remove([teacherSheetPath]);
  const teacherReadAfterGraderDelete = await clients.teacherA.storage.from('exam-sheets').download(teacherSheetPath);
  record(
    'Grader A',
    'delete exam sheet',
    'fail or no-op',
    graderDelete.error ? graderDelete.error.message : (teacherReadAfterGraderDelete.error ? 'deleted' : 'no-op'),
    Boolean(graderDelete.error) || !teacherReadAfterGraderDelete.error,
  );

  await expectOk('Student A', 'upload answer attachment', uploadText(clients.studentA, 'student-files', studentAnswerPath, 'pdf', 'application/pdf'));
  await expectOk('Student A', 'read own answer attachment', clients.studentA.storage.from('student-files').download(studentAnswerPath));
  await expectOk('Student A2', 'upload own answer attachment', uploadText(clients.studentA2, 'student-files', studentA2Path, 'pdf', 'application/pdf'));
  await expectFail('Student A', 'read Student A2 file', clients.studentA.storage.from('student-files').download(studentA2Path));

  await expectOk('Parent A', 'read linked child file', clients.parentA.storage.from('student-files').download(studentAnswerPath));
  await expectFail('Parent A', 'read unlinked student file', clients.parentA.storage.from('student-files').download(studentA2Path));

  await expectFail('MIME', 'reject text/plain in student-files', uploadText(clients.adminA, 'student-files', `${ids.instA}/student-documents/${users.studentA.id}/bad.txt`, 'bad', 'text/plain'));
  await expectFail('Size', 'reject avatar larger than limit', clients.adminA.storage.from('avatars').upload(
    avatarPath,
    new Blob([Buffer.alloc(2 * 1024 * 1024 + 1)], { type: 'image/png' }),
    { contentType: 'image/png' },
  ));
  await expectOk('School Admin A', 'upload avatar', clients.adminA.storage.from('avatars').upload(
    avatarPath,
    new Blob([Buffer.from([137, 80, 78, 71])], { type: 'image/png' }),
    { contentType: 'image/png' },
  ));
  await expectFail('School Admin A', 'move avatar to B tenant', clients.adminA.storage.from('avatars').move(
    avatarPath,
    `${ids.instB}/profile-image/${users.adminA.id}/avatar.png`,
  ));

  const signed = await clients.adminA.storage.from('student-files').createSignedUrl(adminStudentPath, 1);
  if (signed.error) {
    record('Signed URL', 'create signed URL', 'success', signed.error.message, false);
  } else {
    const immediate = await fetch(signed.data.signedUrl);
    record('Signed URL', 'signed URL immediate read', 'HTTP 200', `HTTP ${immediate.status}`, immediate.ok);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const expired = await fetch(signed.data.signedUrl);
    record('Signed URL', 'signed URL expires', 'not HTTP 200', `HTTP ${expired.status}`, !expired.ok);
  }

  const list = await clients.adminA.storage.from('student-files').list(`${ids.instA}/answer-attachments/${users.studentA.id}`);
  record('Listing', 'list only authorized folder', 'success and no A2', list.error ? list.error.message : JSON.stringify(list.data?.map((item) => item.name)), !list.error && !JSON.stringify(list.data).includes(users.studentA2.id));

  await expectFail('anon', 'audit_log insert', anon.from('audit_log').insert({
    institution_id: ids.instA,
    actor_id: users.adminA.id,
    actor_role: 'anonymous',
    action: 'storage_test',
    entity_type: 'storage',
    details: { run },
  }));
  await expectOk('School Admin A', 'audit_log insert own institution', clients.adminA.from('audit_log').insert({
    institution_id: ids.instA,
    actor_id: users.adminA.id,
    actor_role: 'school_admin',
    action: 'storage_test',
    entity_type: 'storage',
    details: { run },
  }));
  await expectFail('School Admin B', 'audit_log insert forged institution', clients.adminB.from('audit_log').insert({
    institution_id: ids.instA,
    actor_id: users.adminB.id,
    actor_role: 'school_admin',
    action: 'storage_test',
    entity_type: 'storage',
    details: { run },
  }));

  const failures = results.filter((r) => !r.passed);
  console.table(results);
  console.log(`STORAGE_TEST_SUMMARY passed=${results.length - failures.length} failed=${failures.length}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
