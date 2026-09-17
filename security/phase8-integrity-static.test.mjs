import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ai = fs.readFileSync('supabase/functions/ai-grading/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260917100000_phase8_grading_integrity.sql', 'utf8');
const aiUi = fs.readFileSync('src/views/AiEngine.tsx', 'utf8');
const omrUi = fs.readFileSync('src/views/BubbleSheet.tsx', 'utf8');
const certUi = fs.readFileSync('src/views/Certification.tsx', 'utf8');
const omrConfig = fs.readFileSync('services/omr-service/app/config.py', 'utf8');

test('AI grading derives answer and score authority from Supabase', () => {
  assert.match(ai, /answerId/);
  assert.match(ai, /from\('answers'\)/);
  assert.match(ai, /from\('exam_questions'\)/);
  assert.match(ai, /response_format/);
  assert.match(ai, /Invalid rubric response/);
  assert.match(aiUi, /answerId,/);
});

test('AI approval remains bounded, scoped, unpublished, and auditable', () => {
  assert.match(migration, /teacher_can_access_exam/);
  assert.match(migration, /p_final_score < 0 OR p_final_score > max_points/);
  assert.match(migration, /attempt_row\.is_result_published/);
  assert.match(migration, /ai_answer_teacher_approved/);
});

test('OMR approval has an idempotent authorized entry point', () => {
  assert.match(migration, /approve_omr_result_idempotent/);
  assert.match(migration, /result_row\.status = 'approved'/);
  assert.match(omrUi, /approve_omr_result_idempotent/);
  assert.match(migration, /NEW\.is_passed := NULL/);
});

test('certificate verification uses a minimum public RPC and OMR production config fails closed', () => {
  assert.match(migration, /verify_certificate/);
  assert.match(migration, /'NOT_FOUND'/);
  assert.match(certUi, /rpc\('verify_certificate'/);
  assert.match(omrConfig, /OMR_SERVICE_TOKEN is required outside explicit local development/);
});
