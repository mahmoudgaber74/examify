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

const run = Date.now().toString(36);
const results = [];
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

function sqlValue(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(sql) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_project', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function countSql(sql) {
  const output = psql(sql);
  const matches = output.match(/\d+/g);
  return matches ? Number(matches.at(-1)) : NaN;
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

function pngBlob(bytes = [137, 80, 78, 71]) {
  return new Blob([Buffer.from(bytes)], { type: 'image/png' });
}

async function uploadImage(client, path, blob = pngBlob(), upsert = false) {
  return client.storage.from('exam-sheets').upload(path, blob, {
    contentType: blob.type,
    upsert,
  });
}

async function main() {
  const users = {
    adminA: await createUser('omr-admin-a'),
    teacherA: await createUser('omr-teacher-a'),
    graderA: await createUser('omr-grader-a'),
    studentA: await createUser('omr-student-a'),
    adminB: await createUser('omr-admin-b'),
  };

  const studentProfileA = randomUUID();

  psql(`
    insert into public.institutions (id, name, subscription_plan, subscription_status, max_students, max_teachers, max_exams, is_active)
    values
      (${sqlValue(ids.instA)}::uuid, 'OMR School A', 'enterprise', 'active', 1000, 100, 100, true),
      (${sqlValue(ids.instB)}::uuid, 'OMR School B', 'enterprise', 'active', 1000, 100, 100, true);

    insert into public.staff_profiles (user_id, institution_id, full_name, role, is_active)
    values
      (${sqlValue(users.adminA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR Admin A', 'school_admin', true),
      (${sqlValue(users.teacherA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR Teacher A', 'teacher', true),
      (${sqlValue(users.graderA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR Grader A', 'grader', true),
      (${sqlValue(users.adminB.id)}::uuid, ${sqlValue(ids.instB)}::uuid, 'OMR Admin B', 'school_admin', true);

    insert into public.student_profiles (id, user_id, institution_id, student_code, full_name, is_active, status)
    values (${sqlValue(studentProfileA)}::uuid, ${sqlValue(users.studentA.id)}::uuid, ${sqlValue(ids.instA)}::uuid, ${sqlValue(`OMR-${run}`)}, 'OMR Student A', true, 'active');

    insert into public.examify_exams (id, institution_id, title, status)
    values
      (${sqlValue(ids.examA)}::uuid, ${sqlValue(ids.instA)}::uuid, 'OMR Exam A', 'draft'),
      (${sqlValue(ids.examB)}::uuid, ${sqlValue(ids.instB)}::uuid, 'OMR Exam B', 'draft');
  `);

  const clients = {
    adminA: signedClient(users.adminA),
    teacherA: signedClient(users.teacherA),
    graderA: signedClient(users.graderA),
    studentA: signedClient(users.studentA),
    adminB: signedClient(users.adminB),
  };

  const teacherPath = `${ids.instA}/omr-original/${users.teacherA.id}/${ids.examA}/${run}/scan.png`;
  const forgedInstPath = `${ids.instB}/omr-original/${users.teacherA.id}/${ids.examB}/${run}/scan.png`;
  const forgedExamPath = `${ids.instA}/omr-original/${users.teacherA.id}/${ids.examB}/${run}/scan.png`;
  const traversalPath = `${ids.instA}/omr-original/${users.teacherA.id}/${ids.examA}/${run}/../scan.png`;
  const studentPath = `${ids.instA}/omr-original/${users.studentA.id}/${ids.examA}/${run}/scan.png`;
  const textPath = `${ids.instA}/omr-original/${users.teacherA.id}/${ids.examA}/${run}/bad.txt`;
  const largePath = `${ids.instA}/omr-original/${users.teacherA.id}/${ids.examA}/${run}/large.png`;

  await expectFail('anon', 'upload OMR scan', uploadImage(anon, teacherPath));
  await expectOk('Teacher A', 'upload OMR scan', uploadImage(clients.teacherA, teacherPath));
  await expectOk('Teacher A', 'upsert own OMR scan', uploadImage(clients.teacherA, teacherPath, pngBlob([137, 80, 78, 71, 1]), true));
  await expectOk('Teacher A', 'download OMR scan', clients.teacherA.storage.from('exam-sheets').download(teacherPath));

  const signed = await clients.teacherA.storage.from('exam-sheets').createSignedUrl(teacherPath, 60);
  record('Teacher A', 'create signed OMR URL', 'success', signed.error ? signed.error.message : 'success', !signed.error);
  if (signed.data?.signedUrl) {
    const response = await fetch(signed.data.signedUrl);
    record('Teacher A', 'read signed OMR URL', 'HTTP 200', `HTTP ${response.status}`, response.ok);
  }

  await expectOk('Grader A', 'read same-institution OMR scan', clients.graderA.storage.from('exam-sheets').download(teacherPath));
  const graderDelete = await clients.graderA.storage.from('exam-sheets').remove([teacherPath]);
  const teacherReadAfterGraderDelete = await clients.teacherA.storage.from('exam-sheets').download(teacherPath);
  record(
    'Grader A',
    'delete teacher OMR scan',
    'fail or no-op',
    graderDelete.error ? graderDelete.error.message : (teacherReadAfterGraderDelete.error ? 'deleted' : 'no-op'),
    Boolean(graderDelete.error) || !teacherReadAfterGraderDelete.error,
  );

  await expectFail('Student A', 'upload OMR scan', uploadImage(clients.studentA, studentPath));
  await expectFail('Student A', 'read staff OMR scan', clients.studentA.storage.from('exam-sheets').download(teacherPath));
  await expectFail('Teacher A', 'upload forged institution OMR path', uploadImage(clients.teacherA, forgedInstPath));
  await expectFail('Teacher A', 'upload forged exam OMR path', uploadImage(clients.teacherA, forgedExamPath));
  await expectFail('Teacher A', 'move OMR scan to forged exam path', clients.teacherA.storage.from('exam-sheets').move(teacherPath, forgedExamPath));
  await expectFail('Teacher A', 'upload traversal OMR path', uploadImage(clients.teacherA, traversalPath));
  await expectFail('Teacher A', 'upload text/plain OMR scan', clients.teacherA.storage.from('exam-sheets').upload(
    textPath,
    new Blob(['bad'], { type: 'text/plain' }),
    { contentType: 'text/plain' },
  ));
  await expectFail('Teacher A', 'upload OMR scan larger than bucket limit', clients.teacherA.storage.from('exam-sheets').upload(
    largePath,
    new Blob([Buffer.alloc(20 * 1024 * 1024 + 1)], { type: 'image/png' }),
    { contentType: 'image/png' },
  ));

  const beforeSubmissions = countSql(`select count(*) from public.exam_attempts;`);
  const beforeExams = countSql(`select count(*) from public.examify_exams;`);

  const inserted = await expectOk('Teacher A', 'insert omr_results with storage path', clients.teacherA.from('omr_results').insert({
    institution_id: ids.instA,
    exam_id: ids.examA,
    original_storage_path: teacherPath,
    image_mime_type: 'image/png',
    image_size_bytes: 4,
    uploaded_by: users.teacherA.id,
    model_label: 'A',
    status: 'pending',
    score: 0,
    total_questions: 1,
    correct_count: 0,
    wrong_count: 0,
    empty_count: 1,
    confidence: 0,
  }).select('id, original_storage_path').single());
  const omrResultId = inserted.data?.id;

  await expectFail('Teacher A', 'insert omr_results with blob URL', clients.teacherA.from('omr_results').insert({
    institution_id: ids.instA,
    exam_id: ids.examA,
    image_url: 'blob:http://localhost/fake',
    model_label: 'A',
  }));
  await expectFail('Teacher A', 'insert omr_results with forged storage path', clients.teacherA.from('omr_results').insert({
    institution_id: ids.instA,
    exam_id: ids.examA,
    original_storage_path: forgedExamPath,
    image_mime_type: 'image/png',
    image_size_bytes: 4,
    uploaded_by: users.teacherA.id,
    model_label: 'A',
  }));

  const freshTeacher = signedClient(users.teacherA);
  await expectOk('Teacher A fresh session', 'read persisted omr_results path', freshTeacher.from('omr_results').select('id, original_storage_path').eq('id', omrResultId).single());
  await expectFail('Student A', 'read persisted omr_results row', clients.studentA.from('omr_results').select('id').eq('id', omrResultId).single());
  await expectFail('Admin B', 'read foreign OMR scan', clients.adminB.storage.from('exam-sheets').download(teacherPath));

  const afterSubmissions = countSql(`select count(*) from public.exam_attempts;`);
  const afterExams = countSql(`select count(*) from public.examify_exams;`);
  record('Regression', 'OMR storage did not create submissions', 'delta 0', `delta ${afterSubmissions - beforeSubmissions}`, afterSubmissions === beforeSubmissions);
  record('Regression', 'OMR storage did not create exams', 'delta 0', `delta ${afterExams - beforeExams}`, afterExams === beforeExams);

  await expectOk('Teacher A', 'delete own persisted OMR result', clients.teacherA.from('omr_results').delete().eq('id', omrResultId));
  await expectOk('Teacher A', 'delete own OMR scan from storage', clients.teacherA.storage.from('exam-sheets').remove([teacherPath]));

  const failures = results.filter((r) => !r.passed);
  console.table(results);
  console.log(`OMR_STORAGE_TEST_SUMMARY passed=${results.length - failures.length} failed=${failures.length}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
