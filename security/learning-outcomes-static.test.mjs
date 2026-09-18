import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260924100000_phase1_learning_outcomes.sql'), 'utf8');
const outcomesView = fs.readFileSync(path.join(root, 'src/views/LearningOutcomes.tsx'), 'utf8');
const questionBank = fs.readFileSync(path.join(root, 'src/views/QuestionBank.tsx'), 'utf8');

test('learning outcomes are institution-scoped and cannot be hard-deleted by clients', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.learning_outcomes/);
  assert.match(migration, /institution_id uuid NOT NULL REFERENCES public\.institutions/);
  assert.match(migration, /ALTER TABLE public\.learning_outcomes ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY learning_outcomes_delete[\s\S]*?USING \(false\)/);
  assert.match(migration, /learning_outcome_link_institution_denied/);
  assert.match(migration, /learning_outcome_link_subject_mismatch/);
});

test('question links are validated server-side and weighted instead of duplicating full credit', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.question_learning_outcomes/);
  assert.match(migration, /set_question_learning_outcomes/);
  assert.match(migration, /1\.0 \/ NULLIF\(requested_count, 0\)/);
  assert.match(migration, /learning_outcome_scope_or_subject_denied/);
});

test('the UI exposes filtered outcomes and optional question mapping', () => {
  assert.match(outcomesView, /data-testid="learning-outcomes-page"/);
  assert.match(outcomesView, /p_subject_id: subjectFilter/);
  assert.match(outcomesView, /question_count/);
  assert.match(questionBank, /data-testid="question-learning-outcomes"/);
  assert.match(questionBank, /set_question_learning_outcomes/);
  assert.match(questionBank, /نواتج التعلم.*اختياري/);
});
