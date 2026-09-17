import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260916100000_phase7_1_offline_expiry.sql', 'utf8');
const runner = fs.readFileSync('src/views/ExamRunner.tsx', 'utf8');

test('attempt deadlines are server-issued and stricter of duration/end_at', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS deadline_at timestamptz/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS offline_recovery_token uuid/);
  assert.match(migration, /LEAST\(/);
  assert.match(migration, /make_interval\(mins => exam_row\.duration_minutes\)/);
  assert.match(migration, /COALESCE\(exam_row\.end_at/);
});

test('late automatic submission requires the server-issued recovery token', () => {
  assert.match(migration, /now\(\) > attempt_row\.deadline_at/);
  assert.match(migration, /p_offline_recovery_token IS NULL/);
  assert.match(migration, /p_offline_recovery_token <> attempt_row\.offline_recovery_token/);
  assert.match(migration, /offline_recovery_token = NULL/);
});

test('runner uses the server deadline and persists the recovery token in the queue', () => {
  assert.match(runner, /new Date\(activeAttempt\.deadline_at\)/);
  assert.match(runner, /recoveryToken: activeAttempt\.offline_recovery_token/);
  assert.match(runner, /p_offline_recovery_token: queued\.recoveryToken/);
  assert.match(runner, /p_offline_recovery_token: activeAttempt\.offline_recovery_token/);
});

test('client submission timestamps are not sent as authority', () => {
  assert.doesNotMatch(runner, /p_submitted_at/);
  assert.doesNotMatch(migration, /p_submitted_at/);
});
