import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260921140000_per_answer_manual_grading.sql', import.meta.url), 'utf8');
const grading = readFileSync(new URL('../src/views/Grading.tsx', import.meta.url), 'utf8');

test('per-answer manual grading is scoped, bounded, and recalculates from answers', () => {
  assert.match(migration, /record_manual_answer_grade\(/);
  assert.match(migration, /auth\.uid\(\) IS NULL/);
  assert.match(migration, /current_user_role\(\) NOT IN \('super_admin', 'school_admin', 'teacher', 'grader'\)/);
  assert.match(migration, /teacher_can_access_exam\(exam_row\.id\)/);
  assert.match(migration, /question_type IN \('multiple_choice', 'true_false', 'fill_blank', 'matching', 'ordering'\)/);
  assert.match(migration, /p_awarded_points < 0 OR p_awarded_points > max_points/);
  assert.match(migration, /SUM\(COALESCE\(a\.awarded_points, 0\)\)/);
  assert.match(migration, /p_awarded_points = max_points THEN true/);
  assert.match(migration, /p_awarded_points = 0 THEN false/);
  assert.match(migration, /ELSE NULL/);
  assert.match(migration, /pending_manual/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_manual_answer_grade/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_manual_answer_grade[^\n]+authenticated/);
});

test('legacy whole-attempt grading remains admin-only and UI uses answer-level grading', () => {
  assert.match(migration, /current_user_role\(\) NOT IN \('super_admin', 'school_admin'\)/);
  assert.match(grading, /record_manual_answer_grade/);
  assert.match(grading, /manual-answer-score-/);
  assert.match(grading, /manual-answer-notes-/);
  assert.match(grading, /pendingManualCount/);
  assert.match(grading, /canUseAttemptOverride/);
  assert.match(grading, /تعديل الدرجة النهائية استثنائيًا/);
  assert.match(grading, /selected\.status !== 'graded' \|\| pendingManualCount > 0/);
});

test('manual answer review badge is based on awarded points, not is_correct', () => {
  assert.match(grading, /isManualAnswer\(answer\)/);
  assert.match(grading, /answer\.awarded_points === null/);
  assert.match(grading, /درجة جزئية/);
  assert.match(grading, /answer\.awarded_points === answer\.questions\.points/);
  assert.match(grading, /answer\.awarded_points === 0/);
});
