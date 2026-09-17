import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260922090000_phase_a_immutable_omr_template_snapshots.sql', 'utf8');
const exactValidationMigration = fs.readFileSync('supabase/migrations/20260922100000_phase_a_exact_source_validation.sql', 'utf8');
const generator = fs.readFileSync('src/lib/bubble-sheet.ts', 'utf8');
const view = fs.readFileSync('src/views/BubbleSheet.tsx', 'utf8');

test('Phase A defines relational immutable snapshot tables and coordinate constraints', () => {
  for (const table of ['bubble_sheet_sections', 'bubble_sheet_questions', 'bubble_sheet_options']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  }
  assert.match(migration, /UNIQUE \(bubble_sheet_id, global_question_number\)/);
  assert.match(migration, /UNIQUE \(bubble_sheet_id, question_id\)/);
  assert.match(migration, /normalized_x \+ normalized_width <= 1/);
  assert.match(migration, /normalized_y \+ normalized_height <= 1/);
  assert.match(migration, /finalized_bubble_sheet_layout_immutable/);
  assert.match(migration, /bubble_sheet_snapshot_incomplete/);
  assert.match(migration, /FOREIGN KEY \(section_id, bubble_sheet_id\)/);
  assert.match(migration, /FOREIGN KEY \(exam_id, question_id\)/);
  assert.match(migration, /FOREIGN KEY \(bubble_sheet_id, exam_id\)/);
  assert.match(migration, /FOREIGN KEY \(bubble_sheet_question_id, question_id\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
});

test('Phase A persists the exact layout through one authorized transaction', () => {
  assert.match(generator, /export function buildBubbleSheetLayout/);
  assert.match(generator, /layout = config\.layout \?\? buildBubbleSheetLayout\(config\)/);
  assert.match(generator, /normalized_x|NormalizedRect/);
  assert.match(view, /buildBubbleSheetLayout\(layoutConfig\)/);
  assert.match(view, /rpc\('(create_exact_bubble_sheet_snapshot|create_variable_bubble_sheet_snapshot)_idempotent'/);
  assert.match(view, /sections: layout\.sections\.map/);
  assert.match(view, /questions: layout\.questions\.map/);
  assert.doesNotMatch(view, /from\('bubble_sheet_sections'\)\.insert/);
  assert.doesNotMatch(view, /from\('bubble_sheet_questions'\)\.insert/);
  assert.doesNotMatch(view, /from\('bubble_sheet_options'\)\.insert/);
  assert.ok(view.indexOf("rpc('create_variable_bubble_sheet_snapshot_idempotent'") < view.indexOf('downloadBlob(blob'));
});

test('Phase A preserves legacy templates explicitly', () => {
  assert.match(migration, /snapshot_state text NOT NULL DEFAULT 'legacy'/);
  assert.match(migration, /generator_version text NOT NULL DEFAULT 'legacy'/);
});

test('Phase A RPC enforces authorization, relational completeness, and finalization', () => {
  assert.match(migration, /create_exact_bubble_sheet_snapshot\(p_snapshot jsonb\)/);
  assert.match(migration, /SECURITY DEFINER SET search_path = public, pg_temp/);
  assert.match(migration, /auth\.uid\(\) IS NULL/);
  assert.match(migration, /actor_role NOT IN \('super_admin','school_admin','teacher'\)/);
  assert.match(migration, /omr_template_exam_institution_denied/);
  assert.match(migration, /omr_template_mapping_incomplete/);
  assert.match(migration, /bubble_sheet_section_count_mismatch/);
  assert.match(migration, /bubble_sheet_option_layout_invalid/);
  assert.match(migration, /snapshot_state='exact'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_exact_bubble_sheet_snapshot\(jsonb\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_exact_bubble_sheet_snapshot\(jsonb\) TO authenticated/);
});

test('Phase A finalization blocks mutation and deletion of finalized layouts', () => {
  assert.match(migration, /TG_OP = 'DELETE'/);
  assert.match(migration, /finalized_bubble_sheet_delete_denied/);
  assert.match(migration, /IF OLD\.is_finalized THEN/);
  assert.match(migration, /trg_reject_finalized_bubble_sheet_options/);
});

test('Phase A exact-count hardening derives immutable mappings from source data', () => {
  assert.match(exactValidationMigration, /CREATE OR REPLACE FUNCTION public\.create_exact_bubble_sheet_snapshot\(p_snapshot jsonb\)/);
  assert.match(exactValidationMigration, /SELECT count\(\*\) INTO v_source_questions/);
  assert.match(exactValidationMigration, /omr_template_exam_question_count_mismatch/);
  assert.match(exactValidationMigration, /omr_template_exam_question_set_mismatch/);
  assert.match(exactValidationMigration, /omr_template_question_order_mismatch/);
  assert.match(exactValidationMigration, /omr_template_exam_option_count_mixed/);
  assert.match(exactValidationMigration, /omr_template_question_option_set_mismatch/);
  assert.match(exactValidationMigration, /omr_template_choices_count_mismatch/);
  assert.match(exactValidationMigration, /ORDER BY eq\.sort_order, eq\.id/);
  assert.match(exactValidationMigration, /ORDER BY qo\.sort_order, qo\.id/);
  assert.match(exactValidationMigration, /REVOKE ALL ON FUNCTION public\.create_exact_bubble_sheet_snapshot\(jsonb\) FROM PUBLIC, anon/);
});

test('BubbleSheet derives exact counts and does not accept arbitrary template dimensions', () => {
  assert.match(view, /select\('id, question_id, section_id, sort_order'\)/);
  assert.match(view, /setQuestionsCount\(orderedQuestions\.length\)/);
  assert.match(view, /setChoicesCount\(\[\.\.\.distinctOptionCounts\]\[0\]\)/);
  assert.match(view, /readOnly aria-readonly="true"/);
  assert.match(view, /setStructureError\('.*غير موحد/);
  assert.match(view, /questionsCount < 1/);
  assert.match(view, /totalQuestions !== questionsCount/);
});
