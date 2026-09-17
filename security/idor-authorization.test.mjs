import test from 'node:test';
import assert from 'node:assert/strict';

const baseUrl = process.env.SECURITY_TEST_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const restUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/rest/v1` : null;
const anonKey = process.env.SECURITY_TEST_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const studentAToken = process.env.SECURITY_TEST_USER_A_TOKEN;
const studentBInstitutionId = process.env.SECURITY_TEST_INSTITUTION_B_ID;
const studentBId = process.env.SECURITY_TEST_STUDENT_B_ID;
const examBId = process.env.SECURITY_TEST_EXAM_B_ID;
const certificateBId = process.env.SECURITY_TEST_CERTIFICATE_B_ID;
const requireFixtures = process.env.REQUIRE_SECURITY_FIXTURES === 'true';

function fixtureFailureMessage(missing) {
  return `Security fixtures unavailable: ${missing.join(', ')}. Set isolated staging fixtures or unset REQUIRE_SECURITY_FIXTURES for an explicitly skipped local run.`;
}

function requiredCredentials(t, names) {
  const missing = names.filter((name) => !process.env[name]);
  if (!restUrl || !anonKey) missing.push('SECURITY_TEST_SUPABASE_URL/ANON_KEY');
  if (missing.length) {
    const message = fixtureFailureMessage(missing);
    if (requireFixtures) { assert.fail(message); }
    t.skip(`SKIPPED — ${message}`);
    return false;
  }
  return true;
}

async function rest(path, options = {}) {
  const response = await fetch(`${restUrl}${path}`, { ...options, headers: { apikey: anonKey, Authorization: `Bearer ${studentAToken}`, Accept: 'application/json', ...(options.headers ?? {}) } });
  return { response, body: await response.text() };
}

test('tenant A cannot read tenant B exams by guessed object scope', async (t) => {
  if (!requiredCredentials(t, ['SECURITY_TEST_USER_A_TOKEN', 'SECURITY_TEST_INSTITUTION_B_ID'])) return;
  const { response, body } = await rest(`/examify_exams?select=id&institution_id=eq.${encodeURIComponent(studentBInstitutionId)}`);
  assert.ok(response.ok, `RLS query failed unexpectedly: ${response.status} ${body}`);
  assert.deepEqual(JSON.parse(body), [], 'cross-tenant exam rows were returned');
});

test('tenant A cannot read tenant B student by direct object id', async (t) => {
  if (!requiredCredentials(t, ['SECURITY_TEST_USER_A_TOKEN', 'SECURITY_TEST_STUDENT_B_ID'])) return;
  const { response, body } = await rest(`/student_profiles?id=eq.${encodeURIComponent(studentBId)}&select=id`);
  assert.ok(response.ok, `RLS query failed unexpectedly: ${response.status} ${body}`);
  assert.deepEqual(JSON.parse(body), [], 'cross-tenant student row was returned');
});

test('tenant A cannot invoke certificate revocation for tenant B', async (t) => {
  if (!requiredCredentials(t, ['SECURITY_TEST_USER_A_TOKEN', 'SECURITY_TEST_CERTIFICATE_B_ID'])) return;
  const { response, body } = await rest('/rpc/revoke_certificate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_certificate_id: certificateBId }) });
  assert.ok(!response.ok, `cross-tenant revocation unexpectedly succeeded: ${response.status} ${body}`);
});

test('tenant A cannot mutate tenant B exam records', async (t) => {
  if (!requiredCredentials(t, ['SECURITY_TEST_USER_A_TOKEN', 'SECURITY_TEST_EXAM_B_ID'])) return;
  const { response, body } = await rest(`/examify_exams?id=eq.${encodeURIComponent(examBId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ title: 'unauthorized-security-test-write' }) });
  assert.ok(!response.ok || JSON.parse(body).length === 0, `cross-tenant exam mutation unexpectedly returned data: ${response.status} ${body}`);
});
