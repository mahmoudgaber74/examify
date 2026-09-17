import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const historical = fs.readFileSync('supabase/migrations/20260907100000_phase4_teacher_approved_ai_grading.sql', 'utf8');

test('historical Phase 4 migration has a valid scalar return', () => {
  assert.doesNotMatch(historical, /RETURN QUERY SELECT \* FROM public\.answers/);
  assert.match(historical, /RETURN answer_row;/);
});

test('the historical repair is minimal and retains Phase 4 server-side checks', () => {
  assert.match(historical, /current_user_institution_id/);
  assert.match(historical, /p_suggested_score > max_points/);
});
