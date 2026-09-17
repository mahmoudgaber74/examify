import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260921110000_student_exam_attempt_summary.sql', import.meta.url),
  'utf8',
);
const runner = fs.readFileSync(new URL('../src/views/ExamRunner.tsx', import.meta.url), 'utf8');

test('student attempt summary is authenticated, assigned, active, and metadata-only', () => {
  assert.match(migration, /get_student_exam_attempt_summary\(p_exam_id uuid\)/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = public, pg_temp/);
  assert.match(migration, /auth\.uid\(\) IS NULL OR public\.current_user_role\(\) <> 'student'/);
  assert.match(migration, /user_id = auth\.uid\(\)/);
  assert.match(migration, /is_active = true/);
  assert.match(migration, /institution_id = student_row\.institution_id/);
  assert.match(migration, /is_exam_assigned_to_current_student\(p_exam_id\)/);
  assert.match(migration, /'attempts_used'/);
  assert.match(migration, /'attempts_remaining'/);
  assert.match(migration, /'has_in_progress'/);
  assert.doesNotMatch(migration, /'score'|'score_percentage'|'is_passed'|'answers'|'feedback'/);
});

test('summary uses the same consumed statuses as start_exam_attempt', () => {
  const statuses = "'submitted', 'auto_submitted', 'graded', 'approved'";
  assert.match(migration, new RegExp(statuses.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(runner, /get_student_exam_attempt_summary/);
});

test('runner uses summary metadata for exhausted state and maps max-attempt errors', () => {
  assert.match(runner, /attemptSummaries/);
  assert.match(runner, /const attemptsRemaining = summary\?\.attempts_remaining \?\? 0/);
  assert.match(runner, /const canStart = attemptsRemaining > 0/);
  assert.match(runner, /!canStart/);
  assert.match(runner, /تم استنفاد جميع محاولات هذا الامتحان/);
  assert.match(runner, /const attemptsUsed = summary\?\.attempts_used \?\? 0/);
});
