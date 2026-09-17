import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const examBuilder = readFileSync(new URL('../src/views/ExamBuilder.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260917110000_quick_exam_atomic_idempotency.sql', import.meta.url), 'utf8');
const quickModal = examBuilder.slice(examBuilder.indexOf('function QuickExamModal'));

test('quick exam uses one server transaction instead of client-side graph writes', () => {
  assert.match(quickModal, /supabase\.rpc\('create_quick_exam_atomic'/);
  assert.match(quickModal, /requestIdRef\.current/);
  assert.doesNotMatch(quickModal, /supabase\.from\(/);
  assert.doesNotMatch(quickModal, /save_single_answer_question/);
  assert.match(quickModal, /disabled=\{saving\}/);
});

test('quick exam RPC is tenant-scoped and idempotent', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.quick_exam_requests/);
  assert.match(migration, /PRIMARY KEY \(institution_id, request_id\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /quick_exam_idempotency_conflict/);
  assert.match(migration, /v_institution <> v_actor_institution/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_quick_exam_atomic\(jsonb\) TO authenticated/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.create_quick_exam_atomic\(jsonb\) TO anon/);
});
