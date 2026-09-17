import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const idempotency = fs.readFileSync('supabase/migrations/20260922140000_phase_a_4_snapshot_idempotency.sql', 'utf8');
const sourceEdit = fs.readFileSync('supabase/migrations/20260922150000_phase_a_6_source_edit_compatibility.sql', 'utf8');
const runtime = fs.readFileSync('security/phase-a-6-runtime.mjs', 'utf8');

test('Phase A.6 idempotency is source-aware and reports explicit conflicts', () => {
  assert.match(idempotency, /v_source_semantic/);
  assert.match(idempotency, /v_request_semantic/);
  assert.match(idempotency, /'source', v_source_semantic/);
  assert.match(idempotency, /'request', v_request_semantic/);
  assert.match(idempotency, /OMR_SNAPSHOT_IDEMPOTENCY_CONFLICT/);
  assert.doesNotMatch(idempotency, /p_snapshot\s*-\s*'qr_token'/);
});

test('Phase A.6 source edit path preserves snapshot immutability', () => {
  assert.match(sourceEdit, /DROP CONSTRAINT IF EXISTS bubble_sheet_options_option_id_question_id_fkey/);
  assert.match(sourceEdit, /ON DELETE RESTRICT/);
  assert.match(sourceEdit, /CREATE OR REPLACE FUNCTION public\.update_single_answer_question_options/);
  assert.match(sourceEdit, /SECURITY DEFINER/);
  assert.match(sourceEdit, /GRANT EXECUTE ON FUNCTION public\.update_single_answer_question_options\(uuid,jsonb\) TO authenticated/);
  assert.match(runtime, /Promise\.all\(\[/);
  assert.match(runtime, /generation_request_id/);
  assert.match(runtime, /V1 immutable V2 regenerated/);
});
