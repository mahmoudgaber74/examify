import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

const status = JSON.parse(execFileSync('cmd.exe', ['/c', '.\\node_modules\\.bin\\supabase.cmd', 'status', '-o', 'json'], { encoding: 'utf8' }));
const url = status.API_URL; const anonKey = status.ANON_KEY; const jwtSecret = status.JWT_SECRET; const run = Date.now().toString(36);
const ids = { inst: randomUUID(), subject: randomUUID(), class: randomUUID(), section: randomUUID(), exam: randomUUID(), question: randomUUID(), option: randomUUID(), studentA: randomUUID(), studentB: randomUUID() };
const results = [];
const sqlValue = (v) => `'${String(v).replaceAll("'", "''")}'`;
const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_project', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }).trim();
const b64 = (v) => Buffer.from(v).toString('base64url');
async function makeUser(label) {
  const id = randomUUID(); const email = `${label}-${run}@example.local`;
  psql(`insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values (${sqlValue(id)}::uuid,'authenticated','authenticated',${sqlValue(email)},'local-test-only',now(),now(),now());`);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })); const p = b64(JSON.stringify({ iss: 'supabase-demo', aud: 'authenticated', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, sub: id, email, role: 'authenticated' }));
  return { id, token: `${h}.${p}.${createHmac('sha256', jwtSecret).update(`${h}.${p}`).digest('base64url')}` };
}
const client = (u) => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init = {}) => { const headers = new Headers(init.headers); headers.set('authorization', `Bearer ${u.token}`); return fetch(input, { ...init, headers }); } } });
const record = (operation, expected, actual, passed) => results.push({ operation, expected, actual, passed });
async function check(operation, promise, shouldSucceed) { const { data, error } = await promise; const passed = shouldSucceed ? !error : Boolean(error) || data === null || (Array.isArray(data) && data.length === 0); record(operation, shouldSucceed ? 'success' : 'blocked', error?.message ?? JSON.stringify(data), passed); return { data, error }; }

const admin = await makeUser('runner-admin'); const studentA = await makeUser('runner-student-a'); const studentB = await makeUser('runner-student-b');
psql(`
insert into public.institutions (id,name,subscription_plan,subscription_status,max_students,max_teachers,max_exams,is_active) values (${sqlValue(ids.inst)}::uuid,'Runner Persistence School','enterprise','active',100,10,20,true);
insert into public.staff_profiles (user_id,institution_id,full_name,role,is_active) values (${sqlValue(admin.id)}::uuid,${sqlValue(ids.inst)}::uuid,'Runner Admin','school_admin',true);
insert into public.subjects (id,institution_id,name,code,is_active) values (${sqlValue(ids.subject)}::uuid,${sqlValue(ids.inst)}::uuid,'Runner Subject','RUN-${run}',true);
insert into public.classes (id,institution_id,name,academic_year,is_active) values (${sqlValue(ids.class)}::uuid,${sqlValue(ids.inst)}::uuid,'Runner Class','2026-2027',true);
insert into public.sections (id,class_id,name,is_active) values (${sqlValue(ids.section)}::uuid,${sqlValue(ids.class)}::uuid,'Runner Section',true);
insert into public.student_profiles (id,user_id,institution_id,student_code,full_name,is_active,status) values
 (${sqlValue(ids.studentA)}::uuid,${sqlValue(studentA.id)}::uuid,${sqlValue(ids.inst)}::uuid,'RA-${run}','Runner Student A',true,'active'),
 (${sqlValue(ids.studentB)}::uuid,${sqlValue(studentB.id)}::uuid,${sqlValue(ids.inst)}::uuid,'RB-${run}','Runner Student B',true,'active');
insert into public.class_students (class_id,section_id,student_id) values (${sqlValue(ids.class)}::uuid,${sqlValue(ids.section)}::uuid,${sqlValue(ids.studentA)}::uuid),(${sqlValue(ids.class)}::uuid,${sqlValue(ids.section)}::uuid,${sqlValue(ids.studentB)}::uuid);
insert into public.questions (id,institution_id,subject_id,type,prompt,difficulty,points) values (${sqlValue(ids.question)}::uuid,${sqlValue(ids.inst)}::uuid,${sqlValue(ids.subject)}::uuid,'multiple_choice','Runner persistence question ${run}','easy',1);
insert into public.question_options (id,question_id,label,is_correct,sort_order) values (${sqlValue(ids.option)}::uuid,${sqlValue(ids.question)}::uuid,'Persisted option',true,0);
insert into public.examify_exams (id,institution_id,subject_id,class_id,title,total_points,passing_score,duration_minutes,max_attempts,status) values (${sqlValue(ids.exam)}::uuid,${sqlValue(ids.inst)}::uuid,${sqlValue(ids.subject)}::uuid,${sqlValue(ids.class)}::uuid,'Runner Persistence Exam ${run}',1,50,60,1,'published');
insert into public.exam_questions (exam_id,question_id,points,sort_order) values (${sqlValue(ids.exam)}::uuid,${sqlValue(ids.question)}::uuid,1,0);
insert into public.exam_assignments (exam_id,class_id,section_id) values (${sqlValue(ids.exam)}::uuid,${sqlValue(ids.class)}::uuid,${sqlValue(ids.section)}::uuid);
`);
const a = client(studentA); const b = client(studentB);
const started = await check('Student A starts Attempt A', a.from('exam_attempts').insert({ exam_id: ids.exam, student_id: ids.studentA, attempt_number: 1, status: 'in_progress' }).select('id,status,started_at').single(), true);
const attemptId = started.data?.id;
const restored = await check('same in_progress attempt is restored by fresh query', a.from('exam_attempts').select('id,status,started_at').eq('id', attemptId).single(), true);
record('restored attempt identity', attemptId, restored.data?.id, restored.data?.id === attemptId);
await check('Student A saves answer', a.from('answers').upsert({ attempt_id: attemptId, question_id: ids.question, option_id: ids.option }, { onConflict: 'attempt_id,question_id' }).select('id').single(), true);
const answerReload = await check('saved answer survives fresh query', a.from('answers').select('option_id').eq('attempt_id', attemptId).eq('question_id', ids.question).single(), true);
record('restored selected option', ids.option, answerReload.data?.option_id, answerReload.data?.option_id === ids.option);
await check('duplicate Attempt B is blocked', a.from('exam_attempts').insert({ exam_id: ids.exam, student_id: ids.studentA, attempt_number: 1, status: 'in_progress' }).select('id').single(), false);
await check('Student B cannot read Student A attempt', b.from('exam_attempts').select('id').eq('id', attemptId).single(), false);
await check('Student A submits Attempt A', a.rpc('submit_exam_attempt', { p_attempt_id: attemptId, p_answers: [{ question_id: ids.question, option_id: ids.option, text_answer: null, numeric_answer: null }], p_auto: false, p_time_remaining_seconds: 300 }), true);
await check('submitted answer cannot be changed', a.from('answers').update({ option_id: null }).eq('attempt_id', attemptId).eq('question_id', ids.question).select('id').single(), false);
const finalAttempt = await check('submitted attempt remains submitted after reload', a.from('exam_attempts').select('status,score').eq('id', attemptId).single(), true);
record('final attempt status', 'approved', finalAttempt.data?.status, finalAttempt.data?.status === 'approved');
const failed = results.filter((r) => !r.passed).length; console.table(results); console.log(`EXAM_RUNNER_PERSISTENCE_TEST_SUMMARY passed=${results.length - failed} failed=${failed}`); if (failed) process.exitCode = 1;
