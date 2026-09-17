import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/result-notification-processor.yml', import.meta.url), 'utf8');

test('result notification scheduler runs every five minutes and supports manual dispatch', () => {
  assert.match(workflow, /schedule:\s*\r?\n\s*- cron: ['"]\*\/5 \* \* \* \*['"]/);
  assert.match(workflow, /workflow_dispatch:/);
});

test('scheduler uses only the internal token and the fixed batch request', () => {
  assert.match(workflow, /PROCESSOR_INTERNAL_TOKEN:\s*\$\{\{ secrets\.PROCESSOR_INTERNAL_TOKEN \}\}/);
  assert.match(workflow, /Authorization: Bearer \$\{PROCESSOR_INTERNAL_TOKEN\}/);
  assert.match(workflow, /--data '\{"batch":true\}'/);
  assert.match(workflow, /process-result-notifications/);
  assert.match(workflow, /jtwrpynqspafifzjiwyg\.supabase\.co\/functions\/v1\/process-result-notifications/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|database password/i);
  assert.doesNotMatch(workflow, /PROCESSOR_INTERNAL_TOKEN\s*:\s*['"][^$]/);
});

test('scheduler fails on network or non-2xx responses without printing authorization', () => {
  assert.match(workflow, /set -euo pipefail/);
  assert.match(workflow, /curl[\s\\\r\n]+--silent/);
  assert.match(workflow, /--write-out '%\{http_code\}'/);
  assert.match(workflow, /http_code.*-lt 200.*-ge 300/);
  assert.match(workflow, /exit 1/);
  assert.doesNotMatch(workflow, /echo\s+.*PROCESSOR_INTERNAL_TOKEN/);
  assert.doesNotMatch(workflow, /curl.*--trace|set -x/);
});

test('scheduler has least-privilege permissions and prevents unsafe overlap', () => {
  assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
  assert.match(workflow, /concurrency:\s*\r?\n\s+group: result-notification-processor/);
  assert.match(workflow, /cancel-in-progress: false/);
});
