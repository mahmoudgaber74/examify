import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('test-results/security-local-fixtures.json', 'utf8'));
const required = [
  'SECURITY_TEST_SUPABASE_URL', 'SECURITY_TEST_SUPABASE_ANON_KEY',
  'SECURITY_TEST_USER_A_TOKEN', 'SECURITY_TEST_USER_B_TOKEN',
  'SECURITY_TEST_TEACHER_A_TOKEN', 'SECURITY_TEST_PARENT_A_TOKEN',
  'SECURITY_TEST_STUDENT_A_ID',
];
for (const key of required) if (!manifest[key]) throw new Error(`HARNESS FAILED - missing ${key}`);

const client = (token) => createClient(manifest.SECURITY_TEST_SUPABASE_URL, manifest.SECURITY_TEST_SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const sessions = {
  'Student A': client(manifest.SECURITY_TEST_USER_A_TOKEN),
  'Student B': client(manifest.SECURITY_TEST_USER_B_TOKEN),
  'Teacher A': client(manifest.SECURITY_TEST_TEACHER_A_TOKEN),
  'Parent A': client(manifest.SECURITY_TEST_PARENT_A_TOKEN),
};
for (const [label, supabase] of Object.entries(sessions)) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error(`HARNESS FAILED - ${label} could not authenticate: ${error?.message ?? 'no user'}`);
  console.log(`${label.toUpperCase().replaceAll(' ', '_')} AUTH PASS`);
}
const { data: profile, error: profileError } = await sessions['Student A']
  .from('student_profiles').select('id').eq('id', manifest.SECURITY_TEST_STUDENT_A_ID).single();
if (profileError || profile?.id !== manifest.SECURITY_TEST_STUDENT_A_ID) {
  throw new Error(`HARNESS FAILED - authenticated database call failed: ${profileError?.message ?? 'no profile'}`);
}
console.log('DB READY');
const storageResponse = await fetch(`${manifest.SECURITY_TEST_SUPABASE_URL}/storage/v1/bucket/tutor_attachments`, {
  headers: {
    apikey: manifest.SECURITY_TEST_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${manifest.SECURITY_TEST_USER_A_TOKEN}`,
  },
});
if (storageResponse.status >= 500) throw new Error(`HARNESS FAILED - Storage returned HTTP ${storageResponse.status}`);
console.log(`STORAGE READY (HTTP ${storageResponse.status})`);
console.log('Harness smoke PASS: AUTH, DB, and STORAGE checks completed.');
