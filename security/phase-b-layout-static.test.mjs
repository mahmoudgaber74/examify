import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('src/views/BubbleSheet.tsx', 'utf8');
const generator = fs.readFileSync('src/lib/bubble-sheet.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260923090000_phase_b_snapshot_layout_rpc.sql', 'utf8');
const variableMigration = fs.readFileSync('supabase/migrations/20260923091000_phase_b_variable_snapshot_generation.sql', 'utf8');
const pageIdentityMigration = fs.readFileSync('supabase/migrations/20260923092000_phase_b_page_identity.sql', 'utf8');

test('Phase B exposes an authorized finalized-snapshot layout contract', () => {
  assert.match(migration, /layout_schema_version integer NOT NULL DEFAULT 1/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_finalized_bubble_sheet_layout\(p_bubble_sheet_id uuid\)/);
  assert.match(migration, /snapshot_state <> 'exact'/);
  assert.match(migration, /bubble_sheet_questions/);
  assert.match(migration, /bubble_sheet_options/);
  assert.doesNotMatch(migration, /'is_correct'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_finalized_bubble_sheet_layout\(uuid\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_finalized_bubble_sheet_layout\(uuid\) TO authenticated/);
  assert.match(variableMigration, /create_variable_bubble_sheet_snapshot_idempotent/);
  assert.match(variableMigration, /create_variable_bubble_sheet_snapshot\(p_snapshot jsonb\)/);
  assert.match(variableMigration, /omr_template_exam_question_duplicate/);
  assert.doesNotMatch(variableMigration, /v_min_choices/);
});

test('v2 rendering uses stored identity, labels, option counts, and geometry', () => {
  assert.match(generator, /finalizedSnapshotToLayout/);
  assert.match(generator, /snapshotOptionId/);
  assert.match(generator, /optionId/);
  assert.match(generator, /canonicalOptionOrdinal/);
  assert.match(generator, /config\.questions\?\.[\[]questions\.length[\]]/);
  assert.match(generator, /sourceQuestion\?\.options/);
  assert.match(generator, /layout\.questions/);
  assert.match(generator, /layout\.sections/);
});

test('BubbleSheet persists first, reloads the finalized layout, then renders PDF', () => {
  const createAt = view.indexOf("rpc('create_variable_bubble_sheet_snapshot_idempotent'");
  const loadAt = view.indexOf("rpc('get_v2_finalized_bubble_sheet_layout'");
  const pdfAt = view.indexOf('generateBubbleSheetPDF({ ...layoutConfig, layout: finalizedLayout })');
  assert.ok(createAt >= 0 && loadAt > createAt && pdfAt > loadAt);
  assert.match(view, /finalizedSnapshotToLayout\(finalizedLayoutData/);
  assert.match(view, /questions: sourceQuestions/);
  assert.match(view, /generator_version: 'phase-a-v2'/);
  assert.match(view, /create_variable_bubble_sheet_snapshot_idempotent/);
});

test('variable option counts and mixed exams remain representable without answer keys', () => {
  assert.match(generator, /const options = sourceOptions\.map/);
  assert.match(generator, /options: question\.options\.map/);
  assert.match(view, /NO_OMR_ELIGIBLE_QUESTIONS/);
  assert.match(view, /eligibleQuestions/);
  assert.doesNotMatch(generator, /is_correct/);
});

test('pagination and repeated layout serialization are deterministic by stored page/visual order', () => {
  assert.match(generator, /pageCount/);
  assert.match(generator, /pageNumber === pageIndex \+ 1/);
  assert.match(generator, /ORDER BY|visualIndex/);
  assert.match(generator, /questions\.push/);
});

test('v2 pages carry independent snapshot/page identity while legacy QR remains compatible', () => {
  assert.match(pageIdentityMigration, /page_identity_region/);
  assert.match(pageIdentityMigration, /layout_schema_version.*= 2/);

  const omrModels = fs.readFileSync('services/omr-service/app/models.py', 'utf8');
  const omrMain = fs.readFileSync('services/omr-service/app/main.py', 'utf8');
  const omrWorker = fs.readFileSync('services/omr-service/app/worker.py', 'utf8');
  assert.match(omrModels, /layout_schema_version: int = Field\(default=1, ge=1\)/);
  assert.match(omrMain, /payload\.template\.layout_schema_version >= 2/);
  assert.match(omrMain, /v2_page_context_required/);
  assert.match(omrMain, /detect_v2_bubbles\(binary, payload\.v2_page_context, settings\)/);
  assert.match(omrMain, /detect_bubbles\(binary, page_template, settings\)/);
  assert.doesNotMatch(omrMain, /unsupported_v2_layout/);
  assert.match(omrWorker, /layout_schema_version/);
  const pageIdentityMigrationV4 = fs.readFileSync('supabase/migrations/20260923100000_phase_b4_trusted_page_identity.sql', 'utf8');
  assert.match(pageIdentityMigrationV4, /CREATE TABLE IF NOT EXISTS public\.bubble_sheet_pages/);
  assert.match(pageIdentityMigrationV4, /resolve_v2_page_identity/);
  assert.match(pageIdentityMigrationV4, /get_v2_finalized_bubble_sheet_layout/);
  assert.match(pageIdentityMigrationV4, /validate_v2_page_set/);
  assert.match(pageIdentityMigrationV4, /omr_page_set_duplicate/);
  assert.match(pageIdentityMigrationV4, /omr_page_set_incomplete/);
  assert.match(pageIdentityMigrationV4, /GRANT EXECUTE ON FUNCTION public\.resolve_v2_page_identity\(uuid\) TO service_role/);
  assert.match(generator, /v2:\$\{pageIdentity\?\.pageToken\}/);
  assert.match(omrWorker, /omr_v2_page_identity_sheet_mismatch/);
  assert.match(generator, /OMR v2 page identity is missing/);
  const qrReader = fs.readFileSync('services/omr-service/app/processing/qr_reader.py', 'utf8');
  assert.match(qrReader, /value\.startswith\("v2:"\)/);
  assert.match(qrReader, /uuid\.UUID\(value\[3:\]\)/);
  assert.match(pageIdentityMigration, /include_qr/);
  assert.match(generator, /isSnapshotV2/);
  assert.match(generator, /pageIndex \+ 1/);
  assert.match(generator, /layout\.snapshotId/);
  assert.match(generator, /layout\.pageCount/);
  assert.match(generator, /pageIdentityRegion/);
  assert.match(generator, /pageIndex === 0 \|\| isSnapshotV2/);
});
