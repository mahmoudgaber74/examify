import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260922140000_phase_a_4_snapshot_idempotency.sql', 'utf8');
const bubbleSheet = fs.readFileSync('src/views/BubbleSheet.tsx', 'utf8');
const audit = fs.readFileSync('security/phase-a-historical-invariant-audit.sql', 'utf8');

test('snapshot generation has request-scoped, race-safe idempotency', () => {
  assert.match(migration, /generation_request_id uuid/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS bubble_sheets_generation_request_unique/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /OMR_SNAPSHOT_IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /create_exact_bubble_sheet_snapshot\(p_snapshot\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_exact_bubble_sheet_snapshot_idempotent\(jsonb\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_exact_bubble_sheet_snapshot_idempotent\(jsonb\) TO authenticated/);
});

test('Bubble Sheet reuses one generation key for retries and uses the idempotent RPC', () => {
  assert.match(bubbleSheet, /generationRequestIdRef/);
  assert.match(bubbleSheet, /create_variable_bubble_sheet_snapshot_idempotent/);
  assert.match(bubbleSheet, /create_exact_bubble_sheet_snapshot_idempotent/);
  assert.equal((bubbleSheet.match(/create_exact_bubble_sheet_snapshot_idempotent/g) ?? []).length, 1);
  assert.match(bubbleSheet, /select\('id, question_id, sort_order, points'\)/);
  assert.match(bubbleSheet, /exam_question_id: question\.id/);
});

test('historical audit is read-only and classifies invariant versus OMR-only findings', () => {
  assert.match(audit, /INVALID PRODUCT INVARIANT/);
  assert.match(audit, /VALID QUESTION BANK BUT NOT OMR COMPATIBLE/);
  assert.doesNotMatch(audit, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i);
});
