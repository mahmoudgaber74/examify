import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260923130000_omr_result_metadata_consistency.sql',
  'utf8',
);
const view = fs.readFileSync('src/views/BubbleSheet.tsx', 'utf8');

test('worker completion persists one consistent result-level review state', () => {
  assert.match(migration, /status = result_status,[\s\S]*needs_review = \(result_status = 'needs_review'\)/);
  assert.match(migration, /WHEN result_status = 'needs_review' THEN result_review_reason[\s\S]*ELSE NULL/);
  assert.match(migration, /COALESCE\(result_review_reason, 'processing_review_required'\)/);
  assert.match(migration, /COALESCE\(p_warnings, '\[\]'::jsonb\)->>0/);
});

test('existing non-approved OpenCV rows receive a narrow metadata-only repair', () => {
  assert.match(migration, /WHERE engine = 'opencv'/);
  assert.match(migration, /status IN \('completed', 'processed', 'needs_review'\)/);
  const backfill = migration.slice(migration.lastIndexOf('UPDATE public.omr_results'));
  assert.doesNotMatch(backfill, /score\s*=/);
  assert.doesNotMatch(backfill, /correct_count\s*=/);
  assert.doesNotMatch(backfill, /wrong_count\s*=/);
  assert.doesNotMatch(backfill, /empty_count\s*=/);
});

test('BubbleSheet displays canonical document confidence with legacy fallback', () => {
  assert.match(view, /function displayedOmrConfidence/);
  assert.match(view, /result\.document_confidence \?\? result\.confidence \?\? 0/);
  assert.ok((view.match(/displayedOmrConfidence\(/g) ?? []).length >= 3);
  assert.doesNotMatch(view, /Math\.round\((?:selected|r)\.confidence \* 100\)/);
});
