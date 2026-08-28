import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

const status = JSON.parse(execFileSync('cmd.exe', ['/c', '.\\node_modules\\.bin\\supabase.cmd', 'status', '-o', 'json'], { encoding: 'utf8' }));
const url = status.API_URL;
const anonKey = status.ANON_KEY;
const jwtSecret = status.JWT_SECRET;
const run = Date.now().toString(36);
const ids = { instA: randomUUID(), instB: randomUUID(), classA: randomUUID(), classB: randomUUID(), sectionA: randomUUID(), subjectA: randomUUID(), subjectB: randomUUID(), question: randomUUID() };
const results = [];

const sqlValue = (value) => `'${String(value).replaceAll("'", "''")}'`;
function psql(sql) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_project', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }).trim();
}
function token(id, email) {
  const b64 = (value) => Buffer.from(value).toString('base64url');
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ iss: 'supabase-demo', aud: 'authenticated', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, sub: id, email, role: 'authenticated' }));
  return `${h}.${p}.${createHmac('sha256', jwtSecret).update(`${h}.${p}`).digest('base64url')}`;
}
function client(user) {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init = {}) => { const headers = new Headers(init.headers); headers.set('authorization', `Bearer ${user.token}`); return fetch(input, { ...init, headers }); } } });
}
function record(account, operation, expected, actual, passed) { results.push({ account, operation, expected, actual, passed }); }
async function user(label) {
  const id = randomUUID();
  const email = `${label}-${run}@example.local`;
  psql(`insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values (${sqlValue(id)}::uuid,'authenticated','authenticated',${sqlValue(email)},'local-test-only',now(),now(),now());`);
  return { id, email, token: token(id, email) };
}
async function expectSuccess(account, operation, promise) {
  const { data, error } = await promise;
  record(account, operation, 'success', error?.message ?? 'success', !error);
  return data;
}
async function expectBlocked(account, operation, promise) {
  const { data, error } = await promise;
  const blocked = Boolean(error) || data === null || (Array.isArray(data) && data.length === 0);
  record(account, operation, 'blocked', error?.message ?? JSON.stringify(data), blocked);
}

const users = {
  teacherA: await user('auth-teacher-a'), teacherB: await user('auth-teacher-b'),
  adminA: await user('auth-admin-a'), adminB: await user('auth-admin-b'), superAdmin: await user('auth-super-admin'),
};
psql(`
insert into public.institutions (id,name,subscription_plan,subscription_status,max_students,max_teachers,max_exams,is_active) values
 (${sqlValue(ids.instA)}::uuid,'Auth School A','enterprise','active',1000,100,100,true),
 (${sqlValue(ids.instB)}::uuid,'Auth School B','enterprise','active',1000,100,100,true);
insert into public.staff_profiles (user_id,institution_id,full_name,role,is_active) values
 (${sqlValue(users.teacherA.id)}::uuid,${sqlValue(ids.instA)}::uuid,'Teacher A','teacher',true),
 (${sqlValue(users.teacherB.id)}::uuid,${sqlValue(ids.instA)}::uuid,'Teacher B','teacher',true),
 (${sqlValue(users.adminA.id)}::uuid,${sqlValue(ids.instA)}::uuid,'Admin A','school_admin',true),
 (${sqlValue(users.adminB.id)}::uuid,${sqlValue(ids.instB)}::uuid,'Admin B','school_admin',true),
 (${sqlValue(users.superAdmin.id)}::uuid,${sqlValue(ids.instA)}::uuid,'Super Admin','super_admin',true);
insert into public.subjects (id,institution_id,name,code,is_active) values
 (${sqlValue(ids.subjectA)}::uuid,${sqlValue(ids.instA)}::uuid,'Authorized Subject','AUTH-${run}',true),
 (${sqlValue(ids.subjectB)}::uuid,${sqlValue(ids.instB)}::uuid,'Foreign Subject','FOR-${run}',true);
insert into public.classes (id,institution_id,name,academic_year,is_active) values
 (${sqlValue(ids.classA)}::uuid,${sqlValue(ids.instA)}::uuid,'Authorized Class','2026-2027',true),
 (${sqlValue(ids.classB)}::uuid,${sqlValue(ids.instB)}::uuid,'Foreign Class','2026-2027',true);
insert into public.sections (id,class_id,name,is_active) values (${sqlValue(ids.sectionA)}::uuid,${sqlValue(ids.classA)}::uuid,'Authorized Section',true);
insert into public.subject_teachers (subject_id,class_id,teacher_id,institution_id,section_id,is_active)
select ${sqlValue(ids.subjectA)}::uuid,${sqlValue(ids.classA)}::uuid,id,${sqlValue(ids.instA)}::uuid,null,true from public.staff_profiles where user_id in (${sqlValue(users.teacherA.id)}::uuid,${sqlValue(users.teacherB.id)}::uuid);
insert into public.questions (id,institution_id,subject_id,type,prompt,difficulty,points) values (${sqlValue(ids.question)}::uuid,${sqlValue(ids.instA)}::uuid,${sqlValue(ids.subjectA)}::uuid,'multiple_choice','Authorization question ${run}','easy',1);
insert into public.question_options (question_id,label,is_correct,sort_order) values (${sqlValue(ids.question)}::uuid,'A',true,0);
`);
const teacherA = client(users.teacherA); const teacherB = client(users.teacherB); const adminA = client(users.adminA); const adminB = client(users.adminB); const superAdmin = client(users.superAdmin);

const ownExam = await expectSuccess('Teacher A', 'create own assigned exam', teacherA.from('examify_exams').insert({ institution_id: ids.instA, subject_id: ids.subjectA, class_id: ids.classA, title: `Owned exam ${run}`, total_points: 1, passing_score: 50, duration_minutes: 30, max_attempts: 1, status: 'draft' }).select('id,teacher_id').single());
const examId = ownExam?.id;
record('Database', 'new teacher exam has immutable owner', 'Teacher A staff profile id', psql(`select teacher_id from public.examify_exams where id=${sqlValue(examId)}::uuid;`), psql(`select teacher_id from public.examify_exams e join public.staff_profiles sp on sp.id=e.teacher_id where e.id=${sqlValue(examId)}::uuid and sp.user_id=${sqlValue(users.teacherA.id)}::uuid;`) === psql(`select teacher_id from public.examify_exams where id=${sqlValue(examId)}::uuid;`));
await expectSuccess('Teacher A', 'update own assigned exam', teacherA.from('examify_exams').update({ title: `Owned exam updated ${run}` }).eq('id', examId).select('id').single());
await expectSuccess('Teacher A', 'publish own assigned exam', teacherA.from('examify_exams').update({ status: 'published' }).eq('id', examId).select('id').single());
await expectSuccess('Teacher A', 'add question to own exam', teacherA.from('exam_questions').insert({ exam_id: examId, question_id: ids.question, points: 1, sort_order: 0 }).select('id').single());

await expectSuccess('Teacher B', 'read same-institution exam', teacherB.from('examify_exams').select('id').eq('id', examId).single());
await expectBlocked('Teacher B', 'update Teacher A exam', teacherB.from('examify_exams').update({ title: 'forged' }).eq('id', examId).select('id').single());
await expectBlocked('Teacher B', 'delete Teacher A exam', teacherB.from('examify_exams').delete().eq('id', examId).select('id').single());
await expectBlocked('Teacher B', 'add question to Teacher A exam', teacherB.from('exam_questions').insert({ exam_id: examId, question_id: ids.question, points: 1, sort_order: 1 }).select('id').single());
const eqId = psql(`select id from public.exam_questions where exam_id=${sqlValue(examId)}::uuid limit 1;`);
await expectBlocked('Teacher B', 'modify question link in Teacher A exam', teacherB.from('exam_questions').update({ points: 99 }).eq('id', eqId).select('id').single());
await expectBlocked('Teacher B', 'add option to Teacher A question', teacherB.from('question_options').insert({ question_id: ids.question, label: 'forged', is_correct: false, sort_order: 2 }).select('id').single());
await expectBlocked('Teacher B', 'change Teacher A exam subject/class', teacherB.from('examify_exams').update({ subject_id: ids.subjectB, class_id: ids.classB }).eq('id', examId).select('id').single());
await expectBlocked('Teacher A', 'forge institution id', teacherA.from('examify_exams').update({ institution_id: ids.instB }).eq('id', examId).select('id').single());
await expectBlocked('Teacher A', 'forge subject id', teacherA.from('examify_exams').update({ subject_id: ids.subjectB }).eq('id', examId).select('id').single());
await expectBlocked('Teacher A', 'forge class id', teacherA.from('examify_exams').update({ class_id: ids.classB }).eq('id', examId).select('id').single());
await expectBlocked('School Admin B', 'access institution A exam', adminB.from('examify_exams').select('id').eq('id', examId).single());
await expectSuccess('School Admin A', 'manage institution A exam', adminA.from('examify_exams').update({ description: 'admin change' }).eq('id', examId).select('id').single());
await expectSuccess('Super Admin', 'super admin behavior unchanged', superAdmin.from('examify_exams').update({ description: 'super change' }).eq('id', examId).select('id').single());

const failed = results.filter((row) => !row.passed).length;
console.table(results);
console.log(`TEACHER_AUTHORIZATION_TEST_SUMMARY passed=${results.length - failed} failed=${failed}`);
if (failed) process.exitCode = 1;
