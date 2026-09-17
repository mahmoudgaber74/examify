import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260922120000_phase_a_single_answer_invariant.sql', 'utf8');
const mcqRpc = fs.readFileSync('supabase/migrations/20260805090000_atomic_question_bank_mcq_save.sql', 'utf8');
const questionBank = fs.readFileSync('src/views/QuestionBank.tsx', 'utf8');

test('single-answer invariant is enforced server-side', () => {
  assert.match(migration, /multiple_choice', 'true_false/);
  assert.match(migration, /correct_count <> 1/);
  assert.match(migration, /MCQ_REQUIRES_EXACTLY_ONE_CORRECT_OPTION/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(migration, /AFTER INSERT OR UPDATE ON public\.question_options/);
});

test('MCQ authoring uses an atomic server path and UI presents one correct answer', () => {
  assert.match(mcqRpc, /save_multiple_choice_question/);
  assert.match(questionBank, /name="correct-option"|type="radio"/);
});
