import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260923160000_omr_fail_closed_result_state.sql',
  'utf8',
);
const view = readFileSync('src/views/BubbleSheet.tsx', 'utf8');

test('OMR result state cannot hide unresolved or missing answer rows', () => {
  assert.match(migration, /has_pending_review boolean/);
  assert.match(migration, /needs_manual_review = true/);
  assert.match(migration, /NEW\.status = 'completed' AND NOT has_answers/);
  assert.match(migration, /NEW\.status := 'needs_review'/);
  assert.match(migration, /trg_enforce_omr_result_review_state/);
});

test('OMR manual review accepts the real option labels from the question', () => {
  assert.match(migration, /upper\(btrim\(qo\.label\)\) = upper\(btrim\(p_manual_answer\)\)/);
  assert.doesNotMatch(migration, /NOT IN \('a', 'b', 'c', 'd'\)/);
});

test('OMR review UI is not hard-coded to four choices', () => {
  assert.match(view, /OMR_OVERRIDE_LABELS = \['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'\]/);
  assert.match(view, /selected\.bubble_sheet_id/);
  assert.match(view, /overrideLabels\.map/);
  assert.doesNotMatch(view, /اختر A أو B أو C أو D لكل سؤال/);
});
