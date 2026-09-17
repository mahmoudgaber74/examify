import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('services/omr-service/app/worker.py', 'utf8');
const models = fs.readFileSync('services/omr-service/app/models.py', 'utf8');
const main = fs.readFileSync('services/omr-service/app/main.py', 'utf8');

test('worker resolves QR identity before loading trusted v2 context', () => {
  assert.match(worker, /decode_v2_page_token/);
  assert.match(worker, /resolve_v2_page\(page_token\)/);
  assert.match(worker, /get_v2_finalized_page_processing_context/);
  assert.match(worker, /load_v2_page_context/);
  assert.match(worker, /V2PageProcessingContext\.model_validate/);
  assert.match(worker, /omr_v2_page_context_identity_mismatch/);
  assert.match(worker, /v2_page_context/);
  assert.match(worker, /omr_job_template_scan_mismatch/);
});

test('FastAPI requires a typed v2 context and keeps legacy requests compatible', () => {
  assert.match(models, /v2_page_context: V2PageProcessingContext \| None = None/);
  assert.match(main, /v2_page_context_required/);
  assert.match(main, /v2_page_context_invalid/);
  assert.match(main, /v2_page_context_not_allowed_for_legacy/);
  assert.match(main, /detect_v2_bubbles\(binary, payload\.v2_page_context, settings\)/);
  assert.match(main, /detect_bubbles\(binary, page_template, settings\)/);
  assert.doesNotMatch(main, /unsupported_v2_layout/);
  assert.doesNotMatch(main, /detect_bubbles\(binary, payload\.v2_page_context/);
});
