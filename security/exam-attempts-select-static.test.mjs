import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260921100000_fix_exam_attempts_select_in_progress.sql', import.meta.url),
  'utf8',
);

test('exam attempts owner policy supports immediate in-progress reads and published results', () => {
  assert.match(migration, /DROP POLICY IF EXISTS exam_attempts_select ON public\.exam_attempts/);
  assert.match(migration, /public\.current_user_role\(\) = 'student'/);
  assert.match(migration, /sp\.user_id = auth\.uid\(\)/);
  assert.match(migration, /sp\.is_active = true/);
  assert.match(migration, /exam_attempts\.status = 'in_progress'/);
  assert.match(migration, /exam_attempts\.is_result_published = true/);
});

test('exam attempts policy preserves staff scope and does not grant other students access', () => {
  assert.match(migration, /public\.current_user_role\(\) = 'super_admin'/);
  assert.match(migration, /public\.teacher_can_access_exam\(exam_attempts\.exam_id\)/);
  assert.match(migration, /public\.current_user_role\(\) IN \('school_admin', 'grader'\)/);
  assert.match(migration, /sp\.id = exam_attempts\.student_id/);
  assert.doesNotMatch(migration, /student_profiles sp[\s\S]*OR\s+sp\.user_id/);
});

test('attempt status vocabulary matches the project lifecycle', () => {
  const schema = fs.readFileSync(
    new URL('../supabase/migrations/20260728232924_20260728080000_create_examify_core_schema.sql.sql', import.meta.url),
    'utf8',
  );
  for (const status of ['in_progress', 'submitted', 'auto_submitted', 'graded', 'approved']) {
    assert.match(schema, new RegExp(status));
  }
});
