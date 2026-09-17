import assert from 'node:assert/strict';
import fs from 'node:fs';

const fixture = JSON.parse(fs.readFileSync('test-results/security-local-fixtures.json', 'utf8'));
const base = fixture.SECURITY_TEST_SUPABASE_URL.replace(/\/$/, '');
const anonKey = fixture.SECURITY_TEST_SUPABASE_ANON_KEY;
const teacherToken = fixture.SECURITY_TEST_TEACHER_A_TOKEN;
const examB = fixture.SECURITY_TEST_EXAM_B_ID;
const questionA = '32000000-0000-4000-8000-000000000001';
const optionA = '33000000-0000-4000-8000-000000000001';

async function request(path, token, body, method = 'POST') {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.text() };
}

async function objectiveState() {
  const result = await request(`/rest/v1/question_options?question_id=eq.${questionA}&select=id,is_correct,sort_order&order=sort_order`, teacherToken, undefined, 'GET');
  assert.equal(result.status, 200, `objective state query failed with HTTP ${result.status}`);
  return JSON.parse(result.body);
}

function assertRejected(label, result) {
  assert.ok(result.status >= 400 || result.status === 204, `${label} unexpectedly succeeded with HTTP ${result.status}`);
  console.log(`PASS ${label} (HTTP ${result.status}; no authorized mutation)`);
}

assertRejected('anon OMR eligibility RPC', await request('/rest/v1/rpc/get_omr_eligible_exam_questions', null, { p_exam_id: examB }));
assertRejected('anon exact snapshot RPC', await request('/rest/v1/rpc/create_exact_bubble_sheet_snapshot', null, { p_snapshot: {} }));
assertRejected('teacher cross-tenant eligibility RPC', await request('/rest/v1/rpc/get_omr_eligible_exam_questions', teacherToken, { p_exam_id: examB }));
const before = await objectiveState();
assertRejected('teacher direct objective option delete', await request(`/rest/v1/question_options?id=eq.${optionA}`, teacherToken, undefined, 'DELETE'));
assert.deepEqual(await objectiveState(), before, 'objective DELETE changed authoritative state');
assertRejected('teacher direct objective option update', await request(`/rest/v1/question_options?id=eq.${optionA}`, teacherToken, { is_correct: false }, 'PATCH'));
assert.deepEqual(await objectiveState(), before, 'objective UPDATE changed authoritative state');
assertRejected('teacher direct objective option insert', await request('/rest/v1/question_options', teacherToken, { question_id: questionA, label: 'REST attack', is_correct: true, sort_order: 9 }));
assert.deepEqual(await objectiveState(), before, 'objective INSERT changed authoritative state');
console.log('POSTGREST_PHASE_A4_PASS');
