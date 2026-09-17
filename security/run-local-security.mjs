import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const fixtureFile = 'test-results/security-local-fixtures.json';
if (fs.existsSync(fixtureFile)) {
  const fixtureEnv = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  for (const [name, value] of Object.entries(fixtureEnv)) {
    if (!process.env[name] && typeof value === 'string') process.env[name] = value;
  }
}

const required = [
  'SECURITY_TEST_SUPABASE_URL',
  'SECURITY_TEST_SUPABASE_ANON_KEY',
  'SECURITY_TEST_USER_A_TOKEN',
  'SECURITY_TEST_INSTITUTION_B_ID',
  'SECURITY_TEST_STUDENT_B_ID',
  'SECURITY_TEST_EXAM_B_ID',
  'SECURITY_TEST_CERTIFICATE_B_ID',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Local security fixtures are required. Missing: ${missing.join(', ')}`);
  console.error('Create disposable local auth/data fixtures, export these variables, then rerun.');
  process.exit(2);
}

const result = spawnSync(process.execPath, ['--test', 'security/idor-authorization.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, REQUIRE_SECURITY_FIXTURES: 'true' },
});
process.exit(result.status ?? 1);
