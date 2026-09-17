import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260922130000_phase_a_3_atomic_single_answer_writes.sql', 'utf8');
const questionBank = fs.readFileSync('src/views/QuestionBank.tsx', 'utf8');
const examBuilder = fs.readFileSync('src/views/ExamBuilder.tsx', 'utf8');
const aiEngine = fs.readFileSync('src/views/AiEngine.tsx', 'utf8');

test('objective writes have a server-side atomic path and direct option writes are restricted', () => {
  assert.match(migration, /save_single_answer_question/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /count\(\*\).*<> 1/s);
  assert.match(migration, /type NOT IN \('multiple_choice','true_false'\)/);
  assert.match(migration, /DROP POLICY IF EXISTS question_options_(insert|update|delete)/);
});

test('application true/false authoring uses the atomic RPC', () => {
  assert.match(questionBank, /rpc\('save_single_answer_question'/);
  assert.match(examBuilder, /rpc\('save_single_answer_question'/);
  assert.match(aiEngine, /rpc\('save_single_answer_question'/);
});

