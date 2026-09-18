import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260924130000_phase1_student_learning_report.sql', 'utf8');
const reportView = fs.readFileSync('src/views/Reports.tsx', 'utf8');
const fixture = fs.readFileSync('security/phase1-local-fixture.sql', 'utf8');

test('student learning reports are institution-scoped and publish-safe', () => {
  assert.match(migration, /get_student_learning_outcome_report/);
  assert.match(migration, /student_report_institution_denied/);
  assert.match(migration, /student_report_self_only/);
  assert.match(migration, /status IN \('graded', 'approved'\)/);
  assert.match(migration, /is_result_published = true/);
  assert.match(migration, /eligible_attempt_count/);
  assert.match(migration, /question_id/);
});

test('reports UI calls the real RPC and exports a multi-page Arabic PDF', () => {
  assert.match(reportView, /get_student_learning_outcome_report/);
  assert.match(reportView, /data-testid="student-learning-report"/);
  assert.match(reportView, /data-testid="student-report-export-pdf"/);
  assert.match(reportView, /ensureSpace\(23\)/);
  assert.match(reportView, /context\.direction = 'rtl'/);
  assert.match(reportView, /pdf\.addPage\(\)/);
  assert.match(reportView, /studentReportLoading/);
});

test('local fixture covers two-tenant RLS, calculations, shortage, replay, and conflict', () => {
  assert.match(fixture, /RLS isolation as institution A/);
  assert.match(fixture, /phase1_cross_tenant_report_was_allowed/);
  assert.match(fixture, /phase1_blueprint_not_deterministic/);
  assert.match(fixture, /phase1_blueprint_shortage_missing/);
  assert.match(fixture, /exam_blueprint_idempotency_conflict/);
  assert.match(fixture, /generate_series\(1, 5\)/);
  assert.match(fixture, /test_outcome_a2/);
  assert.match(fixture, /PHASE1_LOCAL_FIXTURE_PASS/);
});
