import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('src/views/BubbleSheet.tsx', 'utf8');
const rpcMigration = fs.readFileSync('supabase/migrations/20260922110000_phase_a_omr_eligibility_snapshot_contract.sql', 'utf8');

test('BubbleSheet loads generation options through the authorized RPC', () => {
  assert.match(view, /async function loadExamQuestionOptions\(examId: string\)/);
  assert.match(view, /supabase\.rpc\('get_omr_eligible_exam_questions', \{ p_exam_id: examId \}\)/);
  assert.ok((view.match(/loadExamQuestionOptions\(examId\)/g) ?? []).length >= 1);
  assert.doesNotMatch(view, /\.from\('question_options'\)\s*\n\s*\.select\('question_id'\)/);
});

test('the option RPC returns layout metadata without the answer key', () => {
  assert.match(rpcMigration, /get_omr_eligible_exam_questions/);
  assert.match(rpcMigration, /question_type text/);
  assert.match(rpcMigration, /option_ordinal integer/);
  assert.doesNotMatch(rpcMigration, /RETURNS TABLE[\s\S]{0,300}is_correct/);
  assert.match(rpcMigration, /GRANT EXECUTE ON FUNCTION public\.get_omr_eligible_exam_questions\(uuid\) TO authenticated/);
});

test('generation still blocks invalid or inconsistent option structures', () => {
  assert.match(view, /NO_OMR_ELIGIBLE_QUESTIONS/);
  assert.match(view, /Math\.max\(\.\.\.eligibleQuestions\.map/);
  assert.match(view, /choicesCount < 2/);
  assert.match(view, /rows\.length > choicesCount/);
});

test('successful structure loading re-enables generation and disabled state is visible', () => {
  assert.ok((view.match(/setStructureLoading\(false\)/g) ?? []).length >= 3);
  assert.match(view, /disabled=\{generating \|\| structureLoading\}/);
  assert.match(view, /disabled:cursor-not-allowed disabled:opacity-50/);
});
