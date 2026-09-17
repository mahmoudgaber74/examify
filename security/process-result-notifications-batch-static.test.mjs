import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260921170000_bounded_result_notification_processing.sql', import.meta.url), 'utf8');
const processor = readFileSync(new URL('../supabase/functions/process-result-notifications/index.ts', import.meta.url), 'utf8');

test('batch claims are bounded, oldest-first, and concurrency-safe', () => {
  assert.match(migration, /LEAST\(GREATEST\(COALESCE\(p_limit, 1\), 1\), 25\)/);
  assert.match(migration, /ORDER BY e\.created_at ASC, e\.id ASC/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /status = 'pending'/);
  assert.match(migration, /status = 'failed'/);
  assert.match(migration, /processing_started_at < now\(\) - interval '10 minutes'/);
  assert.match(migration, /attempt_count = e\.attempt_count \+ 1/);
});

test('batch requests have a fixed server-owned size and strict body shape', () => {
  assert.match(processor, /Object\.keys\(value\)\.length === 1 && value\.batch === true/);
  assert.match(processor, /p_limit: 25/);
  assert.doesNotMatch(processor, /body.*limit|value\.limit|batchSize/i);
});

test('batch failures are isolated and lease ownership is required', () => {
  assert.match(processor, /for \(const claimed of claimedEvents\)/);
  assert.match(processor, /p_claim_token: claimed\.processing_claim_token/);
  assert.match(migration, /AND processing_claim_token = p_claim_token/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.complete_result_publication_event\(uuid\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.fail_result_publication_event\(uuid, text, integer\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(processor, /if \(failError\) persistenceErrors \+= 1/);
  assert.match(processor, /else if \(!rpcReturnedRow\(failedData\)\) ownershipLost \+= 1/);
  assert.match(processor, /ownershipLost > 0 \? 409/);
});

test('provider delivery remains disabled', () => {
  assert.doesNotMatch(processor, /TWILIO|whatsapp-notification|fetch\s*\(/i);
  assert.match(processor, /provider_disabled/);
  assert.match(processor, /whatsapp_status: 'skipped'/);
});
