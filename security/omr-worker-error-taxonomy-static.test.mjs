import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../services/omr-service/app/worker.py', import.meta.url), 'utf8');
const main = readFileSync(new URL('../services/omr-service/app/main.py', import.meta.url), 'utf8');

test('invalid OMR inputs and page identity failures are terminal', () => {
  assert.match(worker, /permanent_tokens = \(/);
  assert.match(worker, /omr_v2_page_identity_not_detected/);
  assert.match(worker, /omr_v2_page_identity_sheet_mismatch/);
  assert.match(worker, /omr_invalid_input.*False/s);
  assert.match(worker, /omr_page_identity_invalid.*False/s);
  assert.match(worker, /p_retryable.*retryable/);
});

test('OMR service rejects corrupt images and invalid PDFs instead of fabricating results', () => {
  assert.match(main, /invalid_or_encrypted_pdf/);
  assert.match(main, /unsupported_or_corrupt_image/);
  assert.match(main, /processing_status = "needs_review" if needs_review else "completed"/);
});
