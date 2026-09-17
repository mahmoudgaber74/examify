import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260915100000_phase7_exam_lifecycle.sql', 'utf8');
const runner = fs.readFileSync('src/views/ExamRunner.tsx', 'utf8');
const grading = fs.readFileSync('src/views/Grading.tsx', 'utf8');
const results = fs.readFileSync('src/views/ExamResults.tsx', 'utf8');
const builder = fs.readFileSync('src/views/ExamBuilder.tsx', 'utf8');
const executable = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('Phase 7 migration defines authoritative lifecycle RPCs', () => {
  for (const name of ['start_exam_attempt', 'submit_exam_attempt', 'record_manual_exam_grade', 'publish_exam_result', 'unpublish_exam_result', 'publish_exam']) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${name}\\(`));
  }
  assert.match(migration, /result_publication_events/);
  assert.match(migration, /ON CONFLICT \(attempt_id\) DO NOTHING/);
});

test('student runner starts through the server RPC and never inserts attempts', () => {
  assert.match(runner, /rpc\('start_exam_attempt'/);
  assert.doesNotMatch(executable(runner), /from\('exam_attempts'\)\.insert/);
});

test('staff grading and publishing use authorization RPCs', () => {
  assert.match(grading, /rpc\('record_manual_exam_grade'/);
  assert.match(grading, /rpc\('publish_exam_result'/);
  assert.match(grading, /rpc\('unpublish_exam_result'/);
  assert.match(results, /rpc\('publish_exam_result'/);
  assert.match(builder, /rpc\('publish_exam'/);
  assert.doesNotMatch(executable(grading), /\.update\(\{[\s\S]{0,500}is_result_published/);
  assert.doesNotMatch(executable(results), /\.update\(\{[\s\S]{0,300}is_result_published/);
});

test('publication notification is event-based', () => {
  assert.doesNotMatch(grading, /whatsapp-notification|publication_event_id/);
  assert.doesNotMatch(results, /whatsapp-notification|publication_event_id/);
  const fn = fs.readFileSync('supabase/functions/whatsapp-notification/index.ts', 'utf8');
  assert.match(fn, /deliverPublicationEvent/);
  assert.match(fn, /dedupe_key/);
});
