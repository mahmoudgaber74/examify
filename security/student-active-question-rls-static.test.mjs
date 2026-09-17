import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260921120000_student_active_exam_question_rls.sql', import.meta.url), 'utf8');

test('student question access requires an active in-progress owned attempt', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.student_can_read_active_exam_question\(p_question_id uuid\)/);
  assert.match(migration, /auth\.uid\(\) IS NOT NULL/);
  assert.match(migration, /current_user_role\(\) = 'student'/);
  assert.match(migration, /sp\.user_id = auth\.uid\(\)/);
  assert.match(migration, /sp\.is_active = true/);
  assert.match(migration, /ea\.status = 'in_progress'/);
  assert.match(migration, /eq\.question_id = p_question_id/);
  assert.match(migration, /ea\.student_id = sp\.id/);
});

test('active-question helper preserves tenant isolation and avoids policy recursion', () => {
  assert.match(migration, /SET search_path = public, pg_temp/);
  assert.match(migration, /e\.institution_id = sp\.institution_id/);
  assert.match(migration, /q\.institution_id = e\.institution_id/);
  assert.doesNotMatch(migration, /FROM public\.examify_exams[\s\S]*WHERE[\s\S]*public\.student_can_read_active_exam_question/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.student_can_read_active_exam_question\(uuid\) FROM PUBLIC/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.student_can_read_active_exam_question\(uuid\) TO authenticated/);
});

test('questions policy keeps existing staff/public branches and adds only narrow student access', () => {
  assert.match(migration, /current_user_role\(\) = 'super_admin'/);
  assert.match(migration, /is_public = true/);
  assert.match(migration, /current_user_role\(\) IN \('school_admin', 'grader', 'data_entry'\)/);
  assert.match(migration, /current_user_role\(\) = 'teacher'/);
  assert.match(migration, /teacher_has_subject_scope\(subject_id\)/);
  assert.match(migration, /OR public\.student_can_read_active_exam_question\(id\)/);
});
