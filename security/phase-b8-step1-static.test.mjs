import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260923120000_phase_b8_v2_page_processing_context.sql',
  'utf8',
);
const models = fs.readFileSync('services/omr-service/app/models.py', 'utf8');
const worker = fs.readFileSync('services/omr-service/app/worker.py', 'utf8');

test('v2 page context is service-only and snapshot-derived', () => {
  assert.match(migration, /get_v2_finalized_page_processing_context\(\s*p_page_token uuid/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /snapshot_state <> 'exact'/);
  assert.match(migration, /layout_schema_version, 1\) <> 2/);
  assert.match(migration, /omr_v2_page_identity_sheet_mismatch/);
  assert.match(migration, /source_option_id', o\.option_id/);
  assert.match(migration, /normalized_x/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_v2_finalized_page_processing_context\(uuid, uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_v2_finalized_page_processing_context\(uuid, uuid\) TO service_role/);
  for (const forbidden of ['is_correct', 'answer_key', 'correct_option', 'score']) assert.doesNotMatch(migration, new RegExp(`['\\"]${forbidden}`));
});

test('typed v2 context models exist and the worker can call the trusted route', () => {
  assert.match(models, /class V2PageProcessingContext\(BaseModel\)/);
  assert.match(models, /class V2PageProcessingQuestion\(BaseModel\)/);
  assert.match(models, /class V2PageProcessingOption\(BaseModel\)/);
  assert.match(models, /class NormalizedRegion\(BaseModel\)/);
  assert.match(worker, /get_v2_finalized_page_processing_context/);
});
