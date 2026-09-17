import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260920110000_fix_teacher_exam_returning_rls.sql', import.meta.url), 'utf8');
const recursionFix = readFileSync(new URL('../supabase/migrations/20260920120000_fix_exam_select_policy_recursion.sql', import.meta.url), 'utf8');
const insertPolicy = readFileSync(new URL('../supabase/migrations/20260822130000_harden_teacher_exam_authorization.sql', import.meta.url), 'utf8');

test('teacher RETURNING policy evaluates the inserted row directly', () => {
  assert.match(migration, /CREATE POLICY examify_exams_select[\s\S]*public\.examify_exams\.subject_id/);
  assert.match(migration, /public\.examify_exams\.class_id/);
  assert.match(migration, /public\.examify_exams\.id/);
  assert.doesNotMatch(migration, /OR public\.teacher_can_access_exam\(id\)/);
});

test('teacher RETURNING authorization preserves institution, subject, class, and active assignment boundaries', () => {
  assert.match(migration, /current_user_role\(\) = 'teacher'/);
  assert.match(migration, /institution_id = public\.current_user_institution_id\(\)/);
  assert.match(migration, /subject_id IS NOT NULL/);
  assert.match(migration, /class_id IS NOT NULL/);
  assert.match(migration, /st\.subject_id = public\.examify_exams\.subject_id/);
  assert.match(migration, /st\.class_id = public\.examify_exams\.class_id/);
  assert.match(migration, /st\.is_active = true/);
  assert.match(migration, /st\.teacher_id = public\.current_staff_profile_id\(\)/);
});

test('teacher SELECT scope breaks the policy recursion without querying examify_exams', () => {
  assert.match(recursionFix, /CREATE OR REPLACE FUNCTION public\.teacher_exam_select_scope/);
  assert.match(recursionFix, /SECURITY DEFINER/);
  assert.match(recursionFix, /FROM public\.subject_teachers st/);
  assert.match(recursionFix, /FROM public\.exam_assignments ea/);
  assert.doesNotMatch(recursionFix, /FROM public\.examify_exams/);
  assert.match(recursionFix, /OR public\.teacher_exam_select_scope\(id, institution_id, subject_id, class_id\)/);
  assert.doesNotMatch(recursionFix, /OR public\.teacher_can_access_exam\(id\)/);
});

test('section scoping and non-teacher SELECT branches remain explicit', () => {
  assert.match(recursionFix, /NOT EXISTS \([\s\S]*ea\.section_id IS NOT NULL/);
  assert.match(recursionFix, /OR st\.section_id IS NULL/);
  assert.match(recursionFix, /ea\.section_id = st\.section_id/);
  assert.match(recursionFix, /current_user_role\(\) = 'super_admin'/);
  assert.match(recursionFix, /current_user_role\(\) IN \('school_admin', 'grader'\)/);
  assert.match(recursionFix, /current_user_role\(\) = 'student'/);
  assert.match(recursionFix, /status = 'published'/);
  assert.match(recursionFix, /is_exam_assigned_to_current_student\(id\)/);
});

test('wrong subject, wrong class, inactive assignment, and wrong institution cannot pass the policy', () => {
  assert.match(migration, /institution_id = public\.current_user_institution_id\(\)/);
  assert.match(migration, /st\.subject_id = public\.examify_exams\.subject_id/);
  assert.match(migration, /st\.class_id = public\.examify_exams\.class_id/);
  assert.match(migration, /st\.is_active = true/);
});

test('insert authorization remains unchanged and admin/student branches remain present', () => {
  assert.match(insertPolicy, /CREATE POLICY examify_exams_insert/);
  assert.match(insertPolicy, /teacher_id = public\.current_staff_profile_id\(\)/);
  assert.match(migration, /current_user_role\(\) = 'super_admin'/);
  assert.match(migration, /current_user_role\(\) IN \('school_admin', 'grader'\)/);
  assert.match(migration, /current_user_role\(\) = 'student'/);
  assert.match(migration, /status = 'published'/);
  assert.match(migration, /is_exam_assigned_to_current_student\(id\)/);
});
