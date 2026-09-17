import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260922110000_phase_a_omr_eligibility_snapshot_contract.sql', 'utf8');
const view = fs.readFileSync('src/views/BubbleSheet.tsx', 'utf8');
const generator = fs.readFileSync('src/lib/bubble-sheet.ts', 'utf8');

test('Phase A derives OMR eligibility on the server', () => {
  assert.match(migration, /omr_exam_question_is_eligible/);
  assert.match(migration, /q\.type IN \('multiple_choice', 'true_false'\)/);
  assert.match(migration, /count\(qo\.id\) BETWEEN 2 AND 8/);
  assert.match(migration, /count\(\*\) FILTER \(WHERE qo\.is_correct = true\) = 1/);
  assert.match(migration, /omr_template_ineligible_question/);
  assert.match(migration, /NO_OMR_ELIGIBLE_QUESTIONS/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_omr_eligible_exam_questions\(uuid\) FROM PUBLIC, anon/);
});

test('mixed snapshots preserve source identity and per-question options', () => {
  for (const field of ['exam_question_id', 'question_type', 'points_snapshot', 'omr_eligible', 'question_ordinal', 'option_count', 'canonical_option_ordinal']) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(view, /get_omr_eligible_exam_questions/);
  assert.match(view, /generator_version: 'phase-a-v2'/);
  assert.match(view, /points_snapshot/);
  assert.match(view, /canonical_option_ordinal/);
  assert.match(generator, /questions\?: BubbleSheetSourceQuestion\[\]/);
  assert.match(generator, /sourceQuestion\?\.options/);
});
