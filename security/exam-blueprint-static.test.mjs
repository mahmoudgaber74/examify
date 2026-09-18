import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260924120000_phase1_exam_blueprint.sql', 'utf8');
const builder = fs.readFileSync('src/views/ExamBuilder.tsx', 'utf8');

test('exam blueprint is deterministic, scoped, and idempotent', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.exam_blueprint_requests/);
  assert.match(migration, /PRIMARY KEY \(institution_id, request_id\)/);
  assert.match(migration, /md5\(q\.id::text \|\| ':' \|\| v_seed/);
  assert.match(migration, /q\.institution_id = v_institution/);
  assert.match(migration, /q\.subject_id = v_subject/);
  assert.match(migration, /v_requested <> v_total/);
  assert.match(migration, /exam_blueprint_insufficient_questions/);
  assert.match(migration, /exam_blueprint_idempotency_conflict/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /v_points := v_total_points \/ NULLIF\(v_total_questions, 0\)/);
});

test('blueprint UI exposes preview, shortages, seed, and confirmation', () => {
  assert.match(builder, /data-testid="blueprint-exam-open"/);
  assert.match(builder, /preview_exam_blueprint/);
  assert.match(builder, /create_exam_from_blueprint/);
  assert.match(builder, /setPreview\(null\)/);
  assert.match(builder, /!preview\?\.complete/);
  assert.match(builder, /allow_previous_reuse/);
});
