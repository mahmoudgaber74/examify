import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260921130000_canonical_exam_scoring_model_a.sql', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../src/views/ExamBuilder.tsx', import.meta.url), 'utf8');
const submit = readFileSync(new URL('../supabase/migrations/20260916100000_phase7_1_offline_expiry.sql', import.meta.url), 'utf8');
const omr = readFileSync(new URL('../supabase/migrations/20260804050000_complete_omr_modern_workflow.sql', import.meta.url), 'utf8');

test('publication requires positive question points and exact canonical total', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.publish_exam\(p_exam_id uuid\)/);
  assert.match(migration, /question_points_total <> exam_row\.total_points/);
  assert.match(migration, /question_count = 0/);
  assert.match(migration, /eq\.points <= 0/);
  assert.match(migration, /exam_question_points_mismatch/);
  assert.match(migration, /exam_row\.passing_score > 100/);
});

test('historical rows are not backfilled and drafts remain incrementally editable', () => {
  assert.doesNotMatch(migration, /UPDATE public\.examify_exams[\s\S]*SET total_points/);
  assert.doesNotMatch(migration, /UPDATE public\.exam_attempts\s+SET total_points/);
  assert.match(builder, /status === 'published'/);
  assert.match(builder, /questionPointsTotal/);
  assert.match(builder, /pointsRemaining/);
});

test('builder uses percentage semantics for passing_score independently of total_points', () => {
  assert.match(builder, /passingScore\) > 100/);
  assert.match(builder, /passingScore} \(%\)/);
  assert.doesNotMatch(builder, /passingScore\) > Number\(totalPoints\)/);
});

test('online grading uses exam total as percentage denominator and bounded score trigger covers all paths', () => {
  assert.match(submit, /pct := CASE WHEN exam_row\.total_points > 0 THEN round\(\(objective_score \/ exam_row\.total_points\) \* 100, 2\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enforce_exam_attempt_score_bounds/);
  assert.match(migration, /NEW\.score > exam_total/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF score ON public\.exam_attempts/);
});

test('AI approval uses exam total rather than question sum', () => {
  const aiSection = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.approve_ai_answer_score'));
  assert.match(aiSection, /percentage := CASE WHEN exam_row\.total_points > 0 THEN round\(\(total_score \/ exam_row\.total_points\) \* 100, 2\)/);
  assert.match(aiSection, /total_score > exam_row\.total_points/);
  assert.doesNotMatch(aiSection, /COALESCE\(sum\(eq\.points\)/);
});

test('OMR keeps exam total as denominator and score bounds are enforced centrally', () => {
  const omrSection = omr.slice(omr.indexOf('CREATE OR REPLACE FUNCTION public.approve_omr_result'));
  assert.match(omrSection, /SELECT e\.total_points, e\.passing_score/);
  assert.match(omrSection, /percentage := round\(\(awarded_total \/ exam_total\) \* 100, 2\)/);
  assert.match(migration, /enforce_exam_attempt_score_bounds/);
});
